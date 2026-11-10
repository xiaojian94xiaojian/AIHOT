// 公开的账号收录：查一个 X 账号是否已被本站收录，以及「申请收录」的提交与后台审核。
//
// 申请只写本模块自己的表（x_account_requests）；审核通过才按后台建源的同一路径（createSource）建
// hot_signal 源，审计与去重都留在那一处。查询只读本地的 sources，不调任何付费接口。
import { sql } from "@aihot/backend/db";
import { createSource } from "@aihot/backend/admin/sources";
import { config } from "@aihot/backend/config";
import { feishuInternalEnabled, sendAlert } from "@aihot/backend/notify/feishu";
import { hashIp } from "./hash.ts";
import type { XAccountLookup, XAccountRequest, XAccountRequestList } from "../types.ts";

/** X 的 handle：字母、数字、下划线，最长 30。 */
export const HANDLE = /^[A-Za-z0-9_]{1,30}$/;
/** 同一个 IP 一天最多提交几次申请。 */
const MAX_PER_IP_PER_DAY = 5;
/** 待审队列的上限：再多就说明被刷了，先让人工处理。 */
const MAX_PENDING = 500;
/** 被拒绝后隔多久允许重新提交。 */
const REAPPLY_AFTER_MS = 30 * 86_400_000;

export class RequestRejected extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** 用户输入 → 规范化 handle（去掉 @ 与空白），不合法就 400。 */
export function normalizeHandle(raw: string): string {
  // X 的 handle 不分大小写：统一小写再去比对（页面上的大小写写法来自帖子本身）。
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(handle)) throw new RequestRejected(400, "invalid_request", "账号只能包含字母、数字和下划线，最长 30 个字符。");
  return handle;
}

/** 这个 handle 现在是否被收录（启用的 x_search 源）。 */
async function trackedSource(handle: string) {
  const [row] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM sources
    WHERE kind = 'x_search' AND enabled
      AND lower(substring(config->>'query' from '^from:([A-Za-z0-9_]+)')) = ${handle}
    LIMIT 1`;
  return row ?? null;
}

export async function lookupAccount(raw: string): Promise<XAccountLookup> {
  const handle = normalizeHandle(raw);
  const source = await trackedSource(handle);
  const [request] = await sql<{ status: string }[]>`SELECT status FROM x_account_requests WHERE handle = ${handle}`;
  return {
    handle,
    tracked: source !== null,
    path: source ? `/x-people/${handle}` : null,
    request: (request?.status as XAccountLookup["request"]) ?? null,
  };
}

/** 访客输入进飞书纯文本前：折叠换行、去掉能伪造链接和 @ 的字符，再截断。 */
function oneLine(text: string, max = 120): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/[<>[\]`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * 一条申请发到运营机器人。先占位再发：提交路径和补发任务并发时只有一方能发出去；
 * 发送失败或通道关着就把占位退回，留给下一轮。
 */
async function notifyRequest(row: { handle: string; note: string | null; contact: string | null }): Promise<boolean> {
  const claimed = await sql<{ handle: string }[]>`
    UPDATE x_account_requests SET notified_at = now()
    WHERE handle = ${row.handle} AND notified_at IS NULL RETURNING handle`;
  if (claimed.length === 0) return false;

  const lines = [`@${row.handle}`];
  if (row.note) lines.push(`备注：${oneLine(row.note)}`);
  if (row.contact) lines.push(`联系：${oneLine(row.contact)}`);
  lines.push(`待审：${config.siteUrl}/admin/x-people`);
  try {
    const result = await sendAlert("新的收录申请", lines);
    if (result === "sent") return true;
    await sql`UPDATE x_account_requests SET notified_at = NULL WHERE handle = ${row.handle}`;
    return false;
  } catch (error) {
    await sql`UPDATE x_account_requests SET notified_at = NULL WHERE handle = ${row.handle}`.catch(() => {});
    console.error(JSON.stringify({ level: "warn", msg: "x-account-request alert failed", handle: row.handle, error: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

/** 提交后立刻试一次。发送失败/通道关着会退回 notified_at，由定时任务补发；进程在发送途中被杀的那一条可能丢（接受 at-most-once）。 */
export function notifyRequestSoon(row: { handle: string; note: string | null; contact: string | null }): void {
  void notifyRequest(row).catch((error) => {
    console.error(JSON.stringify({ level: "warn", msg: "x-account-request notify failed", handle: row.handle, error: error instanceof Error ? error.message : String(error) }));
  });
}

/** 补发：关着的时候没发出去的申请，打开后每五分钟补一批（7 天内的，和反馈转发同口径）。 */
export async function forwardRequestNotifications(limit = 20): Promise<{ sent: number; pending: number; disabled: boolean }> {
  if (!feishuInternalEnabled()) return { sent: 0, pending: 0, disabled: true };
  const rows = await sql<{ handle: string; note: string | null; contact: string | null }[]>`
    SELECT handle, note, contact FROM x_account_requests
    WHERE status = 'pending' AND notified_at IS NULL AND created_at > now() - interval '7 days'
    ORDER BY created_at LIMIT ${limit}`;
  let sent = 0;
  for (const row of rows) {
    if (await notifyRequest(row)) sent += 1;
  }
  return { sent, pending: rows.length - sent, disabled: false };
}

export interface SubmitRequestInput {
  handle: string;
  note?: string | null;
  contact?: string | null;
  ip?: string | null;
}

/** 提交一条收录申请：已被收录直接说；重复提交只更新这一行；被拒 30 天后可以重来。 */
export async function submitRequest(input: SubmitRequestInput): Promise<{ status: XAccountRequest["status"] | "tracked" }> {
  const handle = normalizeHandle(input.handle);
  if (await trackedSource(handle)) return { status: "tracked" };

  const note = input.note?.trim().slice(0, 200) || null;
  const contact = input.contact?.trim().slice(0, 200) || null;
  if (contact && !/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/\S+|@[A-Za-z0-9_]{1,30})$/.test(contact)) {
    throw new RequestRejected(400, "invalid_request", "联系方式填邮箱、链接或 X 账号都可以。");
  }

  const [existing] = await sql<{ status: XAccountRequest["status"]; created_at: Date }[]>`
    SELECT status, created_at FROM x_account_requests WHERE handle = ${handle}`;
  if (existing && existing.status !== "rejected") return { status: existing.status };
  if (existing && Date.now() - existing.created_at.getTime() < REAPPLY_AFTER_MS) return { status: "rejected" };

  const ipHash = input.ip ? hashIp(input.ip, "x-account-request") : null;
  if (ipHash) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM x_account_requests
      WHERE ip_hash = ${ipHash} AND created_at > now() - interval '24 hours'`;
    if (n >= MAX_PER_IP_PER_DAY) throw new RequestRejected(429, "rate_limited", "提交太频繁了，过一会儿再试。", 3600);
  }
  const [{ pending }] = await sql<{ pending: number }[]>`
    SELECT count(*)::int AS pending FROM x_account_requests WHERE status = 'pending'`;
  if (pending >= MAX_PENDING) throw new RequestRejected(503, "temporarily_unavailable", "待审的申请有点多，过几天再来。", 86_400);

  await sql`
    INSERT INTO x_account_requests (handle, note, contact, status, reason, ip_hash, created_at, reviewed_at, reviewed_by)
    VALUES (${handle}, ${note}, ${contact}, 'pending', NULL, ${ipHash}, now(), NULL, NULL)
    ON CONFLICT (handle) DO UPDATE SET note = EXCLUDED.note, contact = EXCLUDED.contact, status = 'pending',
      reason = NULL, ip_hash = EXCLUDED.ip_hash, created_at = now(), reviewed_at = NULL, reviewed_by = NULL,
      notified_at = CASE WHEN x_account_requests.status = 'rejected' THEN NULL ELSE x_account_requests.notified_at END`;
  notifyRequestSoon({ handle, note, contact });
  return { status: "pending" };
}

export async function listRequests(status = "pending", limit = 100): Promise<XAccountRequestList> {
  const rows = await sql<Array<{
    handle: string; note: string | null; contact: string | null; status: XAccountRequest["status"];
    reason: string | null; created_at: Date; reviewed_at: Date | null; reviewed_by: string | null;
  }>>`
    SELECT handle, note, contact, status, reason, created_at, reviewed_at, reviewed_by
    FROM x_account_requests WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`;
  return {
    items: rows.map((r) => ({
      handle: r.handle,
      note: r.note,
      contact: r.contact,
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      reviewedAt: r.reviewed_at?.toISOString() ?? null,
      reviewedBy: r.reviewed_by,
    })),
  };
}

/** 审核：驳回直接记状态；通过则在建源成功后才标记为已收录（建源失败就保持待审，可重试）。 */
export async function reviewRequest(
  rawHandle: string,
  action: "approve" | "reject",
  reason: string | null,
  actor: string,
): Promise<{ handle: string; status: XAccountRequest["status"]; source?: string; duplicate?: boolean }> {
  const handle = normalizeHandle(rawHandle);
  const [request] = await sql<{ status: XAccountRequest["status"] }[]>`
    SELECT status FROM x_account_requests WHERE handle = ${handle}`;
  if (!request) throw new RequestRejected(404, "not_found", "没有这条申请。");
  if (request.status !== "pending") throw new RequestRejected(409, "conflict", "这条申请已经处理过了。");

  if (action === "reject") {
    await sql`UPDATE x_account_requests SET status = 'rejected', reason = ${reason}, reviewed_at = now(), reviewed_by = ${actor}
      WHERE handle = ${handle}`;
    return { handle, status: "rejected" };
  }

  // 和后台手工建源同一条路：schema 校验、查重、审计都在 createSource 里。
  let duplicate = false;
  try {
    await createSource({
      id: `x-account-${handle.toLowerCase().replace(/_/g, "-")}`,
      name: `@${handle}`,
      kind: "x_search",
      config: { query: `from:${handle} -filter:replies` },
      tier: "T2",
      selection_class: null,
      participation_mode: "hot_signal",
      interval_minutes: 120,
      uses: [],
      first_party: false,
      tags: [],
      site_fulltext: true,
      syndicate_fulltext: false,
    }, actor);
  } catch (error) {
    // 已经有这个账号的源（比如先手工加过）：不算失败，照样标成已收录。
    const message = error instanceof Error ? error.message : String(error);
    if (!/已有|重复|duplicate/i.test(message)) throw error;
    duplicate = true;
  }
  await sql`UPDATE x_account_requests SET status = 'approved', reason = ${duplicate ? "已有同账号的信源" : reason}, reviewed_at = now(), reviewed_by = ${actor}
    WHERE handle = ${handle}`;
  return { handle, status: "approved", duplicate };
}
