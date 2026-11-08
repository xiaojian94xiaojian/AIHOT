// 飞书提醒：读者在自己的飞书群里建一个「自定义机器人」，把 webhook 贴进来，
// 我们每天发一张卡、有回复机会时发一条。不需要账号系统，退订靠消息底部的链接。
//
// 边界：
// - 只接受 open.feishu.cn 的自定义机器人地址（SSRF 防护），发送时也只连这个域名；
// - webhook 加密存库，接口永不回显；
// - 每人每天最多 5 条，绑定每人每天最多 5 次。
import { sql } from "@aihot/backend/db";
import { credential } from "@aihot/backend/config";
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
  if (!secret || secret.length < 16) return null;
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
export function dailyCard(card: XDailyCard, unsubscribeUrl: string): FeishuCard {
  const elements: Array<Record<string, unknown>> = [
    { tag: "div", text: { tag: "lark_md", content: `**[${card.topic.title}](${card.topic.url})**` } },
    { tag: "div", text: { tag: "lark_md", content: `**怎么写**　${card.angle}` } },
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
        content: `**现在能接一句** · @${c.handle}\n${c.text.slice(0, 160)}\n浏览 ${c.views} · 回复 ${c.replies}`,
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
      button("去发", card.links.post, "primary"),
      ...(card.links.reply ? [button("去回", card.links.reply)] : []),
      button("看事件", card.links.story),
    ],
  });
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: `退订：${unsubscribeUrl}` }] });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: `今天写这条 · ${card.generatedAt.slice(5, 10)}` }, template: "blue" },
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
      { tag: "div", text: { tag: "lark_md", content: item.text.slice(0, 200) } },
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
            ? `已绑定 **@${handle}**。每天 08:30 发一张「今天写这条」，有值得回的帖时会单独推。`
            : "群版已绑定：每天 08:30 发一张「今天写什么」，不绑定账号。",
        },
      },
      { tag: "note", elements: [{ tag: "plain_text", content: `退订：${unsubscribeUrl}` }] },
    ],
  };
}

async function send(webhook: string, card: FeishuCard): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "interactive", card }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { code?: number; msg?: string; StatusCode?: number } | null;
    const code = body?.code ?? body?.StatusCode ?? -1;
    if (code === 0) return { ok: true };
    return { ok: false, error: body?.msg ?? `HTTP ${res.status}` };
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
  if (!secret) throw new AlertRejected(503, "not_configured", "服务端还没配置密钥，暂时不能用。");

  const handle = input.handle?.trim().replace(/^@/, "").toLowerCase() || null;
  if (handle && !/^[a-z0-9_]{1,30}$/.test(handle)) throw new AlertRejected(400, "bad_handle", "账号格式不对。");

  if (handle) {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${`x-account-${handle}`} LIMIT 1`;
    if (!row || row.n === 0) throw new AlertRejected(400, "not_tracked", "这个账号还没有进我们的采集，先去「提交收录申请」。");
  }

  const ipHash = input.ip ? createHash("sha256").update(`${input.ip}|x-alert`).digest("hex") : null;
  if (ipHash) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM x_alert_subscriptions
      WHERE ip_hash = ${ipHash} AND created_at > now() - interval '24 hours'`;
    if (row && row.n >= MAX_PER_IP_PER_DAY) throw new AlertRejected(429, "rate_limited", "绑定太频繁了，明天再试。", 3600);
  }

  const kinds = (input.kinds?.length ? input.kinds : ["card"]).filter((kind) => ["card", "reply"].includes(kind));
  const token = randomBytes(16).toString("base64url");
  const unsubscribeUrl = `${input.siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(token)}`;

  const test = await send(webhook, testCard(handle, unsubscribeUrl));
  if (!test.ok) throw new AlertRejected(400, "webhook_failed", `测试消息没发出去：${test.error ?? "未知原因"}`);

  // 同一个账号再绑一次，替换旧地址（旧订阅标记为退订，保留记录）。
  if (handle) {
    await sql`UPDATE x_alert_subscriptions SET status = 'unsubscribed' WHERE handle = ${handle} AND status = 'active'`;
  }
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO x_alert_subscriptions (handle, webhook, kinds, token, ip_hash)
    VALUES (${handle}, ${secret}, ${kinds}, ${token}, ${ipHash})
    RETURNING id`;
  return { id: Number(row!.id), status: "active" };
}

export async function unsubscribe(token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const rows = await sql<{ id: string }[]>`
    UPDATE x_alert_subscriptions SET status = 'unsubscribed'
    WHERE token = ${token} AND status = 'active' RETURNING id`;
  return rows.length > 0;
}

export async function statusOf(handle: string): Promise<{ active: boolean; kinds: string[] } | null> {
  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  const [row] = await sql<{ kinds: string[] }[]>`
    SELECT kinds FROM x_alert_subscriptions WHERE handle = ${clean} AND status = 'active' LIMIT 1`;
  return row ? { active: true, kinds: row.kinds } : null;
}

/** 每日一张卡：给每个绑了账号的订阅发一条，发过就跳过（同一订阅同一天只发一次）。 */
export async function runDailyAlerts(siteUrl: string, now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const subs = await sql<{ id: string; handle: string | null; webhook: string; token: string }[]>`
    SELECT id, handle, webhook, token FROM x_alert_subscriptions
    WHERE status = 'active' AND 'card' = ANY(kinds) LIMIT 500`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const sub of subs) {
    const key = `card:${day}`;
    const [already] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM x_alert_sent WHERE subscription_id = ${Number(sub.id)} AND key = ${key}`;
    if (already && already.n > 0) { skipped += 1; continue; }
    const webhook = decryptWebhook(sub.webhook);
    if (!webhook) { failed += 1; continue; }
    const card = await loadDailyCard(sub.handle);
    if (!card) { skipped += 1; continue; }
    const unsubscribeUrl = `${siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`;
    const result = await send(webhook, dailyCard(card, unsubscribeUrl));
    if (result.ok) {
      sent += 1;
      await sql`INSERT INTO x_alert_sent (subscription_id, key) VALUES (${Number(sub.id)}, ${key}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE x_alert_subscriptions SET last_sent_at = now(), sent_on = ${day}::date, sent_count = CASE WHEN sent_on = ${day}::date THEN sent_count + 1 ELSE 1 END WHERE id = ${Number(sub.id)}`;
    } else {
      failed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { sent, skipped, failed };
}

/** 回复机会：每半小时扫一次最近 3 小时的帖，给订阅了 reply 的人各发一条（每人每天最多 5 条）。 */
export async function runReplyAlerts(siteUrl: string, now = new Date()): Promise<{ sent: number; failed: number }> {
  const items = await findOpportunities();
  if (items.length === 0) return { sent: 0, failed: 0 };
  const subs = await sql<{ id: string; handle: string | null; webhook: string; token: string; sent_on: string | null; sent_count: number }[]>`
    SELECT id, handle, webhook, token, to_char(sent_on, 'YYYY-MM-DD') AS sent_on, sent_count
    FROM x_alert_subscriptions WHERE status = 'active' AND 'reply' = ANY(kinds) LIMIT 500`;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    if (sub.sent_on === day && sub.sent_count >= MAX_PER_DAY_PER_SUB) continue;
    const webhook = decryptWebhook(sub.webhook);
    if (!webhook) { failed += 1; continue; }
    const unsubscribeUrl = `${siteUrl}/api/site/x-people/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`;
    for (const item of items.slice(0, 3)) {
      const key = `reply:${item.id}`;
      const [already] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM x_alert_sent WHERE subscription_id = ${Number(sub.id)} AND key = ${key}`;
      if (already && already.n > 0) continue;
      const result = await send(webhook, opportunityCard(item, unsubscribeUrl));
      if (!result.ok) { failed += 1; break; }
      sent += 1;
      await sql`INSERT INTO x_alert_sent (subscription_id, key) VALUES (${Number(sub.id)}, ${key}) ON CONFLICT DO NOTHING`;
      await sql`UPDATE x_alert_subscriptions SET last_sent_at = now(), sent_on = ${day}::date, sent_count = CASE WHEN sent_on = ${day}::date THEN sent_count + 1 ELSE 1 END WHERE id = ${Number(sub.id)}`;
      await new Promise((resolve) => setTimeout(resolve, 200));
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
