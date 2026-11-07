// 今天发什么：把站内的热点榜和 X 上的讨论量合到一起，按「今天能不能写」排序。
//
// 规则来自 X 公开的 For You 算法（2026-11 版）：帖子 48 小时后不再进推荐；回复/引用的权重是点赞的
// 七倍多；外链的权重很低。所以这里不算「算法分」，只给三件事：话题热度、讨论量、怎么写。
import { sql } from "@aihot/backend/db";
import { latestHotRanking } from "@aihot/backend/publication/hot";
import type { XCommentable, XPost, XTodayResponse, XTodayTopic } from "../types.ts";

/** 讨论量的窗口：和官方 48 小时的推荐窗口对齐。 */
const WINDOW_HOURS = 48;

interface Row {
  story_id: number;
  posts: number;
  reports: number;
  sources: number;
  latest_at: Date;
  replies_per_k: string | null;
  quotes_per_k: string | null;
}

interface RefRow {
  story_id: number;
  id: string;
  text: string | null;
  tweet_id: string | null;
  handle: string | null;
  published_at: Date;
  views: string;
  likes: string;
  retweets: string;
  replies: string;
  quotes: string;
}

/** 48 小时里每条事件的讨论量与互动结构：只数已入库的帖子，不额外抓取。 */
async function discussionOf(storyIds: number[]): Promise<Map<number, Row>> {
  if (storyIds.length === 0) return new Map();
  const rows = await sql<Row[]>`
    SELECT ss.story_id,
           count(*) FILTER (WHERE s.kind = 'x_search')::int AS posts,
           count(*) FILTER (WHERE s.kind <> 'x_search')::int AS reports,
           count(DISTINCT ss.source_id)::int AS sources,
           max(ss.observed_at) AS latest_at,
           round(1000.0 * sum((a.raw->>'reply')::numeric) FILTER (WHERE s.kind = 'x_search')
                 / nullif(sum((a.raw->>'views')::numeric) FILTER (WHERE s.kind = 'x_search'), 0), 1) AS replies_per_k,
           round(1000.0 * sum((a.raw->>'quote')::numeric) FILTER (WHERE s.kind = 'x_search')
                 / nullif(sum((a.raw->>'views')::numeric) FILTER (WHERE s.kind = 'x_search'), 0), 1) AS quotes_per_k
    FROM story_signals ss
    JOIN sources s ON s.id = ss.source_id
    JOIN articles a ON a.id = ss.article_id
    WHERE ss.story_id IN ${sql(storyIds.map(Number))}
      AND ss.observed_at > now() - make_interval(hours => ${WINDOW_HOURS}::int)
    GROUP BY ss.story_id`;
  return new Map(rows.map((row) => [row.story_id, row]));
}

/** 每条事件在窗口内最值得参考的两条 X 帖：回复和引用按官方权重放大。 */
async function referencesOf(storyIds: number[]): Promise<Map<number, XPost[]>> {
  if (storyIds.length === 0) return new Map();
  const rows = await sql<RefRow[]>`
    SELECT story_id, id, text, tweet_id, handle, published_at, views, likes, retweets, replies, quotes FROM (
      SELECT ss.story_id, a.id,
             a.x_post->>'text' AS text, a.x_post->>'tweetId' AS tweet_id, a.x_post->>'handle' AS handle, a.published_at,
             coalesce((a.raw->>'views')::bigint, 0)::text AS views,
             coalesce((a.raw->>'favorite')::bigint, 0)::text AS likes,
             coalesce((a.raw->>'retweet')::bigint, 0)::text AS retweets,
             coalesce((a.raw->>'reply')::bigint, 0)::text AS replies,
             coalesce((a.raw->>'quote')::bigint, 0)::text AS quotes,
             row_number() OVER (
               PARTITION BY ss.story_id
               ORDER BY coalesce((a.raw->>'favorite')::bigint, 0)
                        + 5 * coalesce((a.raw->>'reply')::bigint, 0)
                        + 5 * coalesce((a.raw->>'quote')::bigint, 0) DESC
             ) AS rn
      FROM story_signals ss
      JOIN articles a ON a.id = ss.article_id
      JOIN sources s ON s.id = ss.source_id
      WHERE ss.story_id IN ${sql(storyIds.map(Number))}
        AND ss.observed_at > now() - make_interval(hours => ${WINDOW_HOURS}::int)
        AND s.kind = 'x_search'
    ) ranked WHERE rn <= 2`;
  const out = new Map<number, XPost[]>();
  for (const row of rows) {
    const list = out.get(row.story_id) ?? [];
    list.push({
      id: row.id,
      text: row.text ?? "",
      url: row.tweet_id && row.handle ? `https://x.com/${row.handle}/status/${row.tweet_id}` : "https://x.com",
      at: new Date(row.published_at).toISOString(),
      views: Number(row.views),
      likes: Number(row.likes),
      retweets: Number(row.retweets),
      replies: Number(row.replies),
      quotes: Number(row.quotes),
      mediaKind: "",
      language: null,
      isReply: false,
    });
    out.set(row.story_id, list);
  }
  return out;
}

/**
 * 可评帖：选题下 2–3 条「现在接一句」的候选。口径是按本站数据校准过的（2026-11-06）——
 * 中文区、1–12 小时前发布、浏览 ≥50、回复 <50、排除官方团队账号；不足就返回空数组，页面明示。
 * 原方案的 2–6 小时 / ≥500 浏览在真实数据里一条都选不出来：48 小时内 311 条中文帖，只有 17 条在 6 小时内，
 * 其中浏览过 500 的只有 5 条；放到 12 小时、浏览 50，10 个事件里 9 个都有 2 条以上。
 */
async function commentablesOf(storyIds: number[]): Promise<Map<number, XCommentable[]>> {
  if (storyIds.length === 0) return new Map();
  const rows = await sql<{ story_id: number; id: string; handle: string | null; author: string | null; text: string | null; tweet_id: string | null; published_at: Date; views: string; replies: string; likes: string }[]>`
    SELECT story_id, id, handle, author, text, tweet_id, published_at, views, replies, likes FROM (
      SELECT ss.story_id, a.id,
             a.x_post->>'handle' AS handle,
             a.x_post->>'authorName' AS author,
             a.x_post->>'text' AS text,
             a.x_post->>'tweetId' AS tweet_id,
             a.published_at,
             coalesce((a.raw->>'views')::bigint, 0)::text AS views,
             coalesce((a.raw->>'reply')::bigint, 0)::text AS replies,
             coalesce((a.raw->>'favorite')::bigint, 0)::text AS likes,
             row_number() OVER (
               PARTITION BY ss.story_id
               ORDER BY coalesce((a.raw->>'views')::bigint, 0) DESC
             ) AS rn
      FROM story_signals ss
      JOIN articles a ON a.id = ss.article_id
      LEFT JOIN x_account_meta m ON m.handle = lower(a.x_post->>'handle')
      WHERE ss.story_id IN ${sql(storyIds.map(Number))}
        AND ss.observed_at > now() - make_interval(hours => ${WINDOW_HOURS}::int)
        AND coalesce(a.language, a.x_post->>'lang', '') LIKE 'zh%'
        AND a.published_at BETWEEN now() - interval '12 hours' AND now() - interval '1 hour'
        AND coalesce((a.raw->>'views')::bigint, 0) >= 50
        AND coalesce((a.raw->>'reply')::bigint, 0) < 50
        AND coalesce(m.kind, '') <> 'official'
    ) ranked WHERE rn <= 3`;
  const out = new Map<number, XCommentable[]>();
  const now = Date.now();
  for (const row of rows) {
    const handle = row.handle ?? "";
    const minutesAgo = Math.max(1, Math.round((now - new Date(row.published_at).getTime()) / 60_000));
    const replies = Number(row.replies);
    const list = out.get(row.story_id) ?? [];
    list.push({
      id: row.id,
      handle,
      author: row.author ?? handle,
      text: row.text ?? "",
      url: row.tweet_id && handle ? `https://x.com/${handle}/status/${row.tweet_id}` : `https://x.com/${handle}`,
      at: new Date(row.published_at).toISOString(),
      views: Number(row.views),
      replies,
      likes: Number(row.likes),
      minutesAgo,
      reason: commentReason({ minutesAgo, views: Number(row.views), replies }),
    });
    out.set(row.story_id, list);
  }
  return out;
}

/** 「接一句」的理由：为什么这一条现在接得上（浏览和回复数已经显示在上一行，这里不重复）。 */
export function commentReason(input: { minutesAgo: number; views: number; replies: number }): string {
  const hours = (input.minutesAgo / 60).toFixed(1).replace(/\.0$/, "");
  if (input.replies < 5) return `${hours} 小时前发的，刚起步——接一句就是最早的一批`;
  return `${hours} 小时前发的，回复还没过 50——接得上`;
}

/**
 * 写法建议：只按「X 上已经聊到什么程度」和「回复密度」给一句，不预测流量。
 * 阈值按本站 10 月的数据分布定（热点事件 48 小时里 0–130 条帖子）：50 条以上算聊开、20 条以上算起量。
 */
export function adviceOf(input: { posts: number; repliesPerK: number; hoursSinceLatest: number }): { angle: string; why: string } {
  const { posts, repliesPerK, hoursSinceLatest } = input;
  if (posts >= 50) {
    return {
      angle: repliesPerK >= 2
        ? "已经聊开了，回复密度也高：直接抛你的判断，接得住讨论。"
        : "已经聊开了：转述没人看，配一个实测或反直觉的结论才有人接。",
      why: `48 小时里已有 ${posts} 条相关帖子，讨论正热`,
    };
  }
  if (posts >= 20) {
    return {
      angle: "刚起量：做对比、清单或「我试了一遍」的实测，别只转述。",
      why: `48 小时里 ${posts} 条帖子，还在扩散`,
    };
  }
  if (hoursSinceLatest > 24) {
    return {
      angle: "热度在退：除非你有独家信息，否则加一个自己的结论再发。",
      why: `最近一条已经 ${Math.round(hoursSinceLatest)} 小时前`,
    };
  }
  return {
    angle: "站内热、X 上还没展开：首发窗口，48 小时内写最容易吃到推荐。",
    why: "讨论刚出现，抢的是时效",
  };
}

export async function todaysTopics(limit = 6): Promise<XTodayResponse> {
  const ranking = await latestHotRanking();
  const entries = (ranking?.entries ?? []).slice(0, 12);
  const ids = entries.map((entry) => entry.storyId);
  const [discussion, refs, commentables] = await Promise.all([discussionOf(ids), referencesOf(ids), commentablesOf(ids)]);
  const now = Date.now();
  const topics: XTodayTopic[] = entries.map((entry) => {
    const row = discussion.get(entry.storyId);
    const latestAt = row?.latest_at ? new Date(row.latest_at) : new Date(entry.latestAt);
    const posts = row?.posts ?? 0;
    const { angle, why } = adviceOf({
      posts,
      repliesPerK: Number(row?.replies_per_k ?? 0),
      hoursSinceLatest: Math.max(0, (now - latestAt.getTime()) / 3_600_000),
    });
    return {
      storyId: entry.storyId,
      publicId: entry.storyPublicId,
      title: entry.title,
      url: `/story/${entry.storyPublicId}`,
      rank: entry.rank,
      heat: entry.heat,
      posts,
      reports: row?.reports ?? 0,
      sources: row?.sources ?? entry.sourceCount,
      latestAt: latestAt.toISOString(),
      repliesPerK: Number(row?.replies_per_k ?? 0),
      quotesPerK: Number(row?.quotes_per_k ?? 0),
      angle,
      why,
      refs: refs.get(entry.storyId) ?? [],
      commentables: commentables.get(entry.storyId) ?? [],
    };
  });
  // 可写性：热度 + 讨论量（官方权重口径的粗略代理），同分按榜单名次。
  const score = (t: XTodayTopic) => Math.log10(1 + Math.max(0, t.heat)) * 10 + Math.min(t.posts, 20) + Math.min(t.reports, 5) * 0.5;
  topics.sort((a, b) => score(b) - score(a) || a.rank - b.rank);
  return { windowHours: WINDOW_HOURS, generatedAt: new Date().toISOString(), topics: topics.slice(0, limit) };
}
