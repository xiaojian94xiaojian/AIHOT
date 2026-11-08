// 飞书提醒：读者在自己的飞书群里建一个「自定义机器人」，把 webhook 贴进来，
// 我们每天发一张卡、有回复机会时发一条。不需要账号系统，退订靠消息底部的链接。
//
// 边界：
// - 只接受 open.feishu.cn 的自定义机器人地址（SSRF 防护），发送时也只连这个域名；
// - webhook 加密存库，接口永不回显；
// - 每人每天最多 5 条，绑定每人每天最多 5 次。
import { sql } from "@aihot/backend/db";
import { beijingDate, beijingDay } from "@aihot/contracts/time";
import { lookupAccount, RequestRejected } from "./requests.ts";
import { credential } from "@aihot/backend/config";
import { literal } from "@aihot/backend/notify/selected-content";
import { hashIp, SECRET_MIN, webhookHashOf } from "./hash.ts";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { loadDailyCard } from "./card.ts";
import { replyOpportunity } from "./insight.ts";
import type { XDailyCard } from "../types.ts";

const WEBHOOK_HOST = "open.feishu.cn";
const WEBHOOK_PREFIX = "/open-apis/bot/v2/hook/";
const MAX_PER_IP_PER_DAY = 5;
const MAX_PER_DAY_PER_SUB = 5;

export class AlertRejected extends Error {
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

/** 只认 https://open.feishu.cn/open-apis/bot/v2/hook/<token>，其它一律拒绝（防 SSRF）。 */
export function parseWebhook(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== WEBHOOK_HOST) return null;
  if (!url.pathname.startsWith(WEBHOOK_PREFIX)) return null;
  const token = url.pathname.slice(WEBHOOK_PREFIX.length);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(token)) return null;
  return `https://${WEBHOOK_HOST}${WEBHOOK_PREFIX}${token}`;
}

/** 加密密钥：由 SESSION_SECRET 派生，避免再引入一个必须运维的密钥。 */
function keyOf(): Buffer | null {
  const secret = credential("auth", "SESSION_SECRET");
  if (!secret || secret.length < SECRET_MIN) return null;
  return createHash("sha256").update(`x-alert-webhook|${secret}`).digest();
}

export function encryptWebhook(url: string): string | null {
  const key = keyOf();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptWebhook(stored: string): string | null {
  const key = keyOf();
  if (!key) return null;
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: { title: { tag: "plain_text"; content: string }; template?: string };
  elements: Array<Record<string, unknown>>;
}

const button = (text: string, url: string, type: "primary" | "default" = "default") => ({
  tag: "button",
  text: { tag: "plain_text", content: text },
  url,
  type,
});

/** 每天一张卡：选择题、怎么写、两个数字、现在能接一句的帖。 */
export function dailyCard(card: XDailyCard, unsubscribeUrl: string, siteUrl: string): FeishuCard {
  // 选题链接是站内相对路径，飞书按钮和 markdown 只认绝对地址。
  const absolute = (value: string) => (/^https?:\/\//.test(value) ? value : `${siteUrl}${value.startsWith("/") ? "" : "/"}${value}`);
  const elements: Array<Record<string, unknown>> = [
    { tag: "div", text: { tag: "lark_md", content: `**[${literal(card.topic.title)}](${absolute(card.topic.url)})**` } },
    { tag: "div", text: { tag: "lark_md", content: `**怎么写**　${literal(card.angle)}` } },
    {
      tag: "div",
      text: { tag: "lark_md", content: card.numbers.map((n) => `${n.label} **${n.value}**`).join("　·　") },
    },
  ];
  if (card.commentable) {
    const c = card.commentable;
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**现在能接一句** · @${c.handle}\n${literal(c.text.slice(0, 160))}\n浏览 ${c.views} · 回复 ${c.replies}`,
      },
    });
  }
  if (card.me) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**你的账号** @${card.me.handle} · ${card.me.followers ?? "—"} 粉 · ${card.me.verdict}` },
    });
  }
  elements.push({
    tag: "action",
    actions: [
      button("去发", absolute(card.links.post), "primary"),
      ...(card.links.reply ? [button("去回", absolute(card.links.reply))] : []),
      button("看事件", absolute(card.links.story)),
    ],
  });
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: `退订：${unsubscribeUrl}` }] });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: `今天写这条 · ${beijingDay(card.generatedAt)}` }, template: "blue" },
    elements,
  };
}

export interface Opportunity {
  id: string;
  handle: string;
  text: string;
  url: string;
  views: number;
  replies: number;
  ageHours: number;
  median: number;
}

/** 回复机会：3 小时内、浏览超过自身中位 2 倍、回复还不到 30 的帖。 */
export function opportunityCard(item: Opportunity, unsubscribeUrl: string): FeishuCard {
  const score = replyOpportunity({ views: item.views, age: item.ageHours, replies: item.replies });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: `现在能接一句 · @${item.handle}` }, template: "orange" },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: literal(item.text.slice(0, 200)) } },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `发布 ${item.ageHours.toFixed(1)} 小时 · 浏览 **${item.views}**（中位 ${item.median}）· 回复 **${item.replies}**${
            score ? ` · 12 小时内预计还能涨约 ${score.remainingViews}` : ""
          }`,
        },
      },
      { tag: "action", actions: [button("去回", item.url, "primary")] },
      { tag: "note", elements: [{ tag: "plain_text", content: `退订：${unsubscribeUrl}` }] },
    ],
  };
}

export function testCard(handle: string | null, unsubscribeUrl: string): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "绑定成功" }, template: "green" },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: handle
            ? `已绑定 **@${handle}**。每天早上发一张「今天写这条」，有值得回的帖时会单独推。`
            : "群版已绑定：每天早上发一张「今天写什么」，不绑定账号。",
        },
      },
      { tag: "note", elements: [{ tag: "plain_text", content: `退订：${unsubscribeUrl}` }] },
    ],
  };
}

async function send(webhook: string, card: FeishuCard): Promise<{ ok: boolean; error?: string }> {
  // 发送前再校验一次：库里的地址也不全信（防篡改、防历史脏数据）。
  const url = parseWebhook(webhook);
  if (!url) return { ok: false, error: "webhook 地址不合法" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "interactive", card }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { code?: number; msg?: string; StatusCode?: number } | null;
    if (!body) return { ok: false, error: `HTTP ${res.status}，返回不是 JSON（可能被代理拦了）` };
    const code = body.code ?? body.StatusCode ?? -1;
    if (code === 0) return { ok: true };
    return { ok: false, error: body.msg ?? `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 绑定时先发一条测试消息，发不出去就不落库。 */
export async function subscribe(input: {
  webhook: string;
  handle?: string | null;
  kinds?: string[];
  ip?: string | null;
  siteUrl: string;
}): Promise<{ id: number; status: "active" }> {
  const webhook = parseWebhook(input.webhook);
  if (!webhook) throw new AlertRejected(400, "bad_webhook", "只支持飞书自定义机器人的 webhook（https://open.feishu.cn/open-apis/bot/v2/hook/…）。");
  const secret = encryptWebhook(webhook);
  if (!secret) throw new AlertRejected(503, "not_configured", "服务端密钥没配置或长度不足，暂时不能用。");

  const handle = input.handle?.trim().replace(/^@/, "").toLowerCase() || null;
  if (handle && !/^[a-z0-9_]{1,30}$/.test(handle)) throw new AlertRejected(400, "bad_handle", "账号格式不对。");

  if (handle) {
    // 用收录申请同一个判定（sources 表 + id 归一化），不要自己拼 source_id：
    // 有的账号 id 把下划线换成了连字符，直接拼会误拒。
    let tracked = false;
    try {
      tracked = (await lookupAccount(handle)).tracked;
    } catch (error) {
      // 只把「handle 不合法」翻成 400；数据库故障要照常抛成 503。
      if (error instanceof RequestRejected) throw new AlertRejected(400, "bad_handle", "账号格式不对。");
      throw error;
    }
    if (!tracked) throw new AlertRejected(400, "not_tracked", "这个账号还没有进我们的采集，先去「提交收录申请」。");
  }

  // 先校验参数，再占额度：漏勾提醒不该烧掉今天的绑定次数。
  const kinds = (input.kinds ?? []).filter((kind) => ["card", "reply"].includes(kind));
  if (kinds.length === 0) throw new AlertRejected(400, "no_kinds", "至少选一种提醒。");

  const ipHash = input.ip ? hashIp(input.ip, "x-alert") : null;
  // 先占额度再发测试消息：失败、重复绑定都算一次，否则这个开关只是个文案。
  if (ipHash) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM x_alert_attempts
      WHERE ip_hash = ${ipHash} AND created_at > now() - interval '24 hours'`;
    if (row && row.n >= MAX_PER_IP_PER_DAY) throw new AlertRejected(429, "rate_limited", "绑定太频繁了，明天再试。", 3600);
    await sql`INSERT INTO x_alert_attempts (ip_hash) VALUES (${ipHash})`;
  }

  const webhookHash = webhookHashOf(webhook);

  // 先判占用再发消息：否则群里会先收到一张「绑定成功」，而调用方拿到 409。
  await assertHandleClaimable(handle, webhookHash);

  // 还在生效的订阅沿用旧 token：重绑时测试卡里的退订链接必须真的能用。
  // 同一 webhook 并发重绑时后写者保留先写者的 token，前者的测试卡链接可能失效（双击级，可接受）。
  const token = (await activeTokenFor(webhookHash)) ?? randomBytes(16).toString("base64url");
  const unsubscribeUrl = `${input.siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(token)}`;

  const test = await send(webhook, testCard(handle, unsubscribeUrl));
  if (!test.ok) throw new AlertRejected(400, "webhook_failed", `测试消息没发出去：${test.error ?? "未知原因"}`);
  return claimSubscription({ handle, secret, webhookHash, kinds, token });
}

/**
 * 落库：身份是 webhook 指纹（同一个机器人再绑就更新那一行），账号只是附属。
 * 账号已经被别的机器人占了就 409，绝不改写别人的订阅。
 */
export async function assertHandleClaimable(handle: string | null, webhookHash: string): Promise<void> {
  if (!handle) return;
  const [owner] = await sql<{ webhook_hash: string | null }[]>`
    SELECT webhook_hash FROM x_alert_subscriptions WHERE handle = ${handle} AND status = 'active' LIMIT 1`;
  if (owner && owner.webhook_hash !== webhookHash) {
    throw new AlertRejected(409, "handle_taken", "这个账号已经绑定了别的飞书群；先让那边退订，或者换一个账号。");
  }
}

export async function claimSubscription(input: {
  handle: string | null;
  secret: string;
  webhookHash: string;
  kinds: string[];
  token: string;
}): Promise<{ id: number; status: "active" }> {
  const { handle, secret, webhookHash, kinds, token } = input;
  await assertHandleClaimable(handle, webhookHash);
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO x_alert_subscriptions (handle, webhook, webhook_hash, kinds, token)
      VALUES (${handle}, ${secret}, ${webhookHash}, ${kinds}, ${token})
      ON CONFLICT (webhook_hash) WHERE webhook_hash IS NOT NULL DO UPDATE
        SET handle = EXCLUDED.handle,
            webhook = EXCLUDED.webhook,
            kinds = EXCLUDED.kinds,
            -- 活跃订阅保留旧 token（重绑卡里的链接才不会失效）；退订过的换新 token，旧链接永久作废。
            token = CASE WHEN x_alert_subscriptions.status = 'active' THEN x_alert_subscriptions.token ELSE EXCLUDED.token END,
            status = 'active'
      RETURNING id`;
    return { id: Number(row!.id), status: "active" };
  } catch (error) {
    // 并发下 handle 唯一索引仍可能被另一个请求先占：翻成人话。
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      throw new AlertRejected(409, "handle_taken", "这个账号刚刚被绑定了；先让那边退订，或者换一个账号。");
    }
    throw error;
  }
}
export async function unsubscribe(token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  // 退订：释放 handle、清掉群凭证、换新 token（用过的链接永久失效）。
  const rows = await sql<{ id: string }[]>`
    UPDATE x_alert_subscriptions
    SET status = 'unsubscribed', handle = NULL, webhook = '', token = ${randomBytes(16).toString("base64url")}
    WHERE token = ${token} AND status = 'active' RETURNING id`;
  return rows.length > 0;
}

/** 每日一张卡：给每个绑了账号的订阅发一条，发过就跳过（同一订阅同一天只发一次）。 */
export async function runDailyAlerts(siteUrl: string, now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const day = beijingDate(now);
  // 顺手清掉 30 天前的去重记录：它只用来防重发，不需要长期留着。
  await sql`DELETE FROM x_alert_sent WHERE created_at IS NULL OR created_at < now() - interval '30 days'`;
  await sql`DELETE FROM x_alert_attempts WHERE created_at < now() - interval '2 days'`;
  const subs = await sql<{ id: string; handle: string | null; webhook: string; token: string }[]>`
    SELECT id, handle, webhook, token FROM x_alert_subscriptions
    WHERE status = 'active' AND 'card' = ANY(kinds) ORDER BY id LIMIT 500`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // 同一个选题/账号的卡片只算一次：群里绑同一个 handle 的人多时不用重复查库。
  const cards = new Map<string, Awaited<ReturnType<typeof loadDailyCard>>>();
  const cardFor = async (handle: string | null) => {
    const key = handle ?? "";
    if (!cards.has(key)) cards.set(key, await loadDailyCard(handle));
    return cards.get(key) ?? null;
  };
  for (const sub of subs) {
    const key = `card:${day}`;
    const [already] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM x_alert_sent WHERE subscription_id = ${Number(sub.id)} AND key = ${key}`;
    if (already && already.n > 0) { skipped += 1; continue; }
    const webhook = decryptWebhook(sub.webhook);
    if (!webhook) { failed += 1; continue; }
    const card = await cardFor(sub.handle);
    if (!card) { skipped += 1; continue; }
    const unsubscribeUrl = `${siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`;
    const result = await send(webhook, dailyCard(card, unsubscribeUrl, siteUrl));
    if (result.ok) {
      sent += 1;
      await sql`INSERT INTO x_alert_sent (subscription_id, key, created_at) VALUES (${Number(sub.id)}, ${key}, now()) ON CONFLICT DO NOTHING`;
      await sql`UPDATE x_alert_subscriptions SET sent_on = ${day}::date, sent_count = CASE WHEN sent_on = ${day}::date THEN sent_count + 1 ELSE 1 END WHERE id = ${Number(sub.id)}`;
    } else {
      failed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { sent, skipped, failed };
}

/** 回复机会：每半小时扫一次最近 3 小时的帖，给订阅了 reply 的人各发一条（每人每天最多 5 条）。 */
export async function runReplyAlerts(siteUrl: string, now = new Date()): Promise<{ sent: number; failed: number }> {
  // 没人订阅回复机会时，连「找机会」的查询都不跑（它每半小时一次，扫的是全站帖）。
  const [wanted] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM x_alert_subscriptions WHERE status = 'active' AND 'reply' = ANY(kinds)`;
  if (!wanted || wanted.n === 0) return { sent: 0, failed: 0 };
  const items = await findOpportunities();
  if (items.length === 0) return { sent: 0, failed: 0 };
  const subs = await sql<{ id: string; webhook: string; token: string; sent_on: string | null; sent_count: number }[]>`
    SELECT id, webhook, token, to_char(sent_on, 'YYYY-MM-DD') AS sent_on, sent_count
    FROM x_alert_subscriptions WHERE status = 'active' AND 'reply' = ANY(kinds) ORDER BY id LIMIT 500`;
  const day = beijingDate(now);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    // 上限按条计：每发一条前复查一次，避免「进来时 4 条、一次再发 3 条」冲到 7 条。
    let count = sub.sent_on === day ? sub.sent_count : 0;
    if (count >= MAX_PER_DAY_PER_SUB) continue;
    const webhook = decryptWebhook(sub.webhook);
    if (!webhook) { failed += 1; continue; }
    const unsubscribeUrl = `${siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`;
    for (const item of items.slice(0, 3)) {
      if (count >= MAX_PER_DAY_PER_SUB) break;
      const key = `reply:${item.id}`;
      const [already] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM x_alert_sent WHERE subscription_id = ${Number(sub.id)} AND key = ${key}`;
      if (already && already.n > 0) continue;
      const result = await send(webhook, opportunityCard(item, unsubscribeUrl));
      if (!result.ok) { failed += 1; break; }
      sent += 1;
      count += 1;
      await sql`INSERT INTO x_alert_sent (subscription_id, key, created_at) VALUES (${Number(sub.id)}, ${key}, now()) ON CONFLICT DO NOTHING`;
      await sql`UPDATE x_alert_subscriptions SET sent_on = ${day}::date, sent_count = CASE WHEN sent_on = ${day}::date THEN sent_count + 1 ELSE 1 END WHERE id = ${Number(sub.id)}`;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  return { sent, failed };
}

async function findOpportunities(): Promise<Opportunity[]> {
  const rows = await sql<{
    id: string; handle: string | null; text: string | null; tweet_id: string | null;
    published_at: Date; views: string; replies: string; median: string;
  }[]>`
    SELECT a.id, a.x_post->>'handle' AS handle, a.x_post->>'text' AS text, a.x_post->>'tweetId' AS tweet_id,
           a.published_at, (a.raw->>'views')::bigint::text AS views, (a.raw->>'reply')::bigint::text AS replies,
           m.median::text AS median
    FROM articles a
    JOIN LATERAL (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (b.raw->>'views')::numeric) AS median
      FROM articles b WHERE b.source_id = a.source_id AND b.published_at > now() - interval '120 days'
    ) m ON true
    WHERE a.source_id LIKE 'x-account-%'
      AND a.published_at BETWEEN now() - interval '3 hours' AND now() - interval '30 minutes'
      AND (a.raw->>'views')::bigint >= GREATEST(m.median * 2, 500)
      AND (a.raw->>'reply')::bigint < 30
    ORDER BY (a.raw->>'views')::bigint DESC
    LIMIT 8`;
  const now = Date.now();
  return rows
    .filter((row) => row.handle && row.tweet_id)
    .map((row) => ({
      id: row.id,
      handle: row.handle!,
      text: row.text ?? "",
      url: `https://x.com/${row.handle}/status/${row.tweet_id}`,
      views: Number(row.views),
      replies: Number(row.replies),
      ageHours: (now - new Date(row.published_at).getTime()) / 3_600_000,
      median: Math.round(Number(row.median)),
    }));
}

/** 这个机器人还在生效的退订 token；没有就返回 null。 */
export async function activeTokenFor(webhookHash: string): Promise<string | null> {
  const [row] = await sql<{ token: string }[]>`
    SELECT token FROM x_alert_subscriptions WHERE webhook_hash = ${webhookHash} AND status = 'active' LIMIT 1`;
  return row?.token ?? null;
}