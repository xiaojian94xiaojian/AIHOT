// 每日一张卡：一条推荐选题 + 为什么 + 两个数字 + 一条现在能接的帖（可选：带上你自己的诊断）。
//
// 一张卡只回答一个问题：「今天写什么」。其他页面继续负责「看大盘」。
import { sql } from "@aihot/backend/db";
import { notWithdrawn } from "./visibility.ts";
import { cached, cachedByKey } from "@aihot/backend/lib/cache";
import { replyOpportunity } from "./insight.ts";
import { sourceIdsOfHandle } from "./followers.ts";
import { ownStructure, structureMedians, structureVerdict } from "./structure.ts";
import { todaysTopics } from "./today.ts";
import type { XCommentable, XDailyCard, XTodayTopic } from "../types.ts";

export type DailyCard = XDailyCard;

const medianCache = cached(structureMedians, { freshMs: 600_000, maxStaleMs: 3_600_000 });

/** 回复机会分：窗口 12 小时，回复少、还在涨的分高。 */
function opportunity(post: XCommentable, now: number) {
  const age = (now - new Date(post.at).getTime()) / 3_600_000;
  return replyOpportunity({ views: post.views, age, replies: post.replies, windowHours: 12 });
}

/** 你最近 120 天的互动结构（轻量版，只为了给一句诊断）；和全站中位用同一池（原创、不含回复）。 */
async function myStructure(handle: string) {
  // 源 id 不一定是 x-account-<handle>：历史源会把下划线换成连字符，必须查表。
  const ids = (await sourceIdsOfHandle(handle)).filter((id) => id.startsWith("x-account-"));
  if (ids.length === 0) return null;
  const [structure, rows] = await Promise.all([
    ownStructure(ids),
    sql<{ followers: string | null }[]>`
      SELECT followers::text AS followers
      FROM x_follower_snapshots WHERE handle = ${handle}
      ORDER BY captured_on DESC LIMIT 1`,
  ]);
  const row = rows[0];
  if (!row) return null;
  return { perK: structure.perK, posts: structure.posts, views: structure.views, followers: row.followers === null ? null : Number(row.followers) };
}

function pickCommentable(topic: XTodayTopic, now: number) {
  const scored = topic.commentables
    .map((post) => ({ post, opp: opportunity(post, now) }))
    .filter((item) => item.opp !== null)
    .sort((a, b) => (b.opp?.score ?? 0) - (a.opp?.score ?? 0));
  const best = scored[0];
  if (!best?.opp) return null;
  return { ...best.post, hoursLeft: best.opp.hoursLeft, remainingViews: best.opp.remainingViews };
}

export async function loadDailyCard(handle?: string | null): Promise<DailyCard | null> {
  const data = await todaysTopics(6);
  const topic = data.topics[0];
  if (!topic) return null;
  const now = Date.now();

  const clean = handle?.trim().replace(/^@/, "").toLowerCase() || null;
  const [median, mine] = clean
    ? await Promise.all([medianCache.get(undefined), myStructure(clean)])
    : [null, null];

  // 样本太少时不下诊断：既要 20 条原创帖，也要累计曝光过万（和全站中位同一门槛），
  // 否则 4 粉账号「3 个回复 / 442 浏览」也能算出「偏讨论型 13 倍」。
  const enough = (mine?.posts ?? 0) >= 20 && (mine?.views ?? 0) >= 10_000;
  const verdict = mine && median && enough ? structureVerdict(mine.perK, median) : null;
  // 「怎么写」保持简短；你账号的诊断单独一行，避免两处重复。
  const angle = topic.angle;

  const commentable = pickCommentable(topic, now);
  const replyText = commentable ? `@${commentable.handle} ` : "";
  const intent = (text: string) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;

  return {
    generatedAt: data.generatedAt,
    topic,
    angle,
    numbers: [
      { label: "48 小时 X 帖", value: `${topic.posts} 条` },
      { label: "每千曝光回复", value: topic.repliesPerK > 0 ? topic.repliesPerK.toFixed(1) : "—" },
    ],
    commentable: commentable
      ? {
          ...commentable,
          // 12 小时窗口的剩余浏览已在 pickCommentable 里算好，别再覆盖成 24 小时预测。
        }
      : null,
    me: clean
      ? { handle: clean, followers: mine?.followers ?? null, verdict: verdict ?? ((mine?.posts ?? 0) < 20 || (mine?.views ?? 0) < 10_000 ? "样本还少（不到 20 条原创帖或累计曝光不到 1 万），先不做结构诊断。" : "还没有足够数据做诊断。") }
      : null,
    links: {
      post: intent(`${topic.title}\n\n`),
      reply: commentable ? intent(replyText) : null,
      story: topic.url,
    },
  };
}

/** 首页卡片附带的数据来源说明用（避免页面自己写死阈值）。 */
export const CARD_RULES = {
  windowHours: 12,
  smoothing: 8,
  decayHalfLifeHours: 8,
} as const;

/** /card 每次带不同 handle 都会算一遍今日选题和画像：按 handle 进程缓存 5 分钟，随机串打不穿。 */
const dailyCards = cachedByKey<string, DailyCard | null>((key) => key, (key) => loadDailyCard(key || null), { freshMs: 300_000, maxStaleMs: 3_600_000, maxKeys: 50 });

export const loadDailyCardCached = (handle: string): Promise<DailyCard | null> => dailyCards(handle.toLowerCase());
