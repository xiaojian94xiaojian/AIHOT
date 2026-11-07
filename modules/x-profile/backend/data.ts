// X 博主画像的聚合查询：只读 articles / publications / analyses，不调模型。
//
// 互动的三个数（点赞、转发、浏览）是在采集那一刻记下的快照（articles.raw），不是帖子的最终值；
// 所以它适合横向比较，不适合当“这条最终有多少赞”。时间一律按北京时间切分。
import { sql } from "@aihot/backend/db";
import { cached } from "@aihot/backend/lib/cache";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { personKind, regionOf } from "./classify.ts";
import { accountMeta } from "./meta.ts";
import { structureMedians, structureVerdict } from "./structure.ts";
import type { XPeopleResponse, XPersonResponse, XPersonSummary, XPost, XSeriesPoint } from "../types.ts";
import { ageHours, breakoutRatio, projected24hViews } from "./insight.ts";

/** 只看最近这些天：更早的帖子留作历史，不进画像。 */
const WINDOW_DAYS = 120;

/** 每个账号的原始帖子行；列表与详情共用。 */
export const posts = () => sql`
  SELECT a.source_id, a.id, a.published_at, a.discovered_at,
         a.x_post->>'handle' AS handle,
         a.x_post->>'authorName' AS author,
         a.x_post->>'avatarUrl' AS avatar,
         a.x_post->>'text' AS text,
         a.x_post->>'tweetId' AS tweet_id,
         coalesce(a.language, a.x_post->>'lang') AS lang,
         coalesce(jsonb_array_length(a.x_post->'media'), 0) AS media_count,
         coalesce(a.x_post->'media'->0->>'kind', '') AS media_kind,
         (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb) AS is_reply,
         (a.x_post->'quoted' IS NOT NULL AND a.x_post->'quoted' <> 'null'::jsonb) AS is_quote,
         coalesce((a.raw->>'favorite')::bigint, 0) AS likes,
         coalesce((a.raw->>'retweet')::bigint, 0) AS retweets,
         coalesce((a.raw->>'reply')::bigint, 0) AS replies,
         coalesce((a.raw->>'quote')::bigint, 0) AS quotes,
         coalesce((a.raw->>'views')::bigint, 0) AS views,
         length(coalesce(a.x_post->>'text', '')) AS text_len,
         la.category, la.tags, la.score
  FROM articles a
  LEFT JOIN LATERAL (
    SELECT category, tags, score FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1
  ) la ON true
  WHERE a.source_id LIKE 'x-account-%'
    AND a.published_at > now() - make_interval(days => ${WINDOW_DAYS})
`;

export const SUMMARY = sql`
  source_id,
  max(handle) AS handle,
  max(author) AS author,
  max(avatar) AS avatar,
  count(*)::int AS posts,
  count(DISTINCT published_at::date)::int AS active_days,
  min(published_at) AS first_at,
  max(published_at) AS last_at,
  round(avg(views))::bigint AS avg_views,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views,
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS p90_views,
  round(avg(likes))::bigint AS avg_likes,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY likes)::numeric)::bigint AS med_likes,
  max(likes)::bigint AS top_likes,
  round(100.0 * sum(likes) / nullif(sum(views), 0), 2) AS engagement_rate,
  round(1000.0 * sum(likes) / nullif(sum(views), 0), 1) AS like_per_k,
  round(1000.0 * sum(retweets) / nullif(sum(views), 0), 1) AS repost_per_k,
  round(1000.0 * sum(replies) / nullif(sum(views), 0), 1) AS reply_per_k,
  round(1000.0 * sum(quotes) / nullif(sum(views), 0), 1) AS quote_per_k,
  round(100.0 * avg((media_count > 0)::int), 1) AS media_pct,
  round(100.0 * avg(is_reply::int), 1) AS reply_pct,
  round(100.0 * avg(is_quote::int), 1) AS quote_pct,
  round(100.0 * count(*) FILTER (WHERE lang LIKE 'zh%') / nullif(count(*) FILTER (WHERE lang IS NOT NULL), 0), 1) AS zh_pct,
  round(100.0 * count(*) FILTER (WHERE lang LIKE 'en%') / nullif(count(*) FILTER (WHERE lang IS NOT NULL), 0), 1) AS en_pct,
  mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE category IS NOT NULL) AS top_category,
  mode() WITHIN GROUP (ORDER BY lang) FILTER (WHERE lang IS NOT NULL) AS language
`;

export interface SummaryRow {
  source_id: string;
  handle: string | null;
  author: string | null;
  avatar: string | null;
  posts: number;
  active_days: number;
  first_at: Date;
  last_at: Date;
  avg_views: string | null;
  med_views: string | null;
  p90_views: string | null;
  avg_likes: string | null;
  med_likes: string | null;
  top_likes: string | null;
  engagement_rate: string | null;
  /** 最近一次粉丝快照；没有快照时为 null（列在不同查询里可能不带）。 */
  followers?: string | null;
  like_per_k: string | null;
  repost_per_k: string | null;
  reply_per_k: string | null;
  quote_per_k: string | null;
  media_pct: string | null;
  reply_pct: string | null;
  quote_pct: string | null;
  zh_pct: string | null;
  en_pct: string | null;
  top_category: string | null;
  language: string | null;
}

export const num = (value: string | null | undefined) => (value === null || value === undefined ? 0 : Number(value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function toSummary(row: SummaryRow): XPersonSummary {
  const first = new Date(row.first_at).getTime();
  const last = new Date(row.last_at).getTime();
  const days = Math.max(1, Math.ceil((last - first) / 86_400_000) + 1);
  return {
    sourceId: row.source_id,
    handle: row.handle ?? row.source_id.replace(/^x-account-/, ""),
    author: row.author ?? row.handle ?? row.source_id,
    avatar: row.avatar,
    posts: row.posts,
    activeDays: row.active_days,
    days,
    postsPerDay: round1(row.posts / days),
    avgLikes: Math.round(num(row.avg_likes)),
    medLikes: Math.round(num(row.med_likes)),
    topLikes: Math.round(num(row.top_likes)),
    avgViews: Math.round(num(row.avg_views)),
    medViews: Math.round(num(row.med_views)),
    p90Views: Math.round(num(row.p90_views)),
    engagementRate: round2(num(row.engagement_rate)),
    // 每千曝光的互动结构：X 官方公开的打分动作里，回复/引用/转发都比点赞重得多。
    perK: {
      likes: round1(num(row.like_per_k)),
      reposts: round1(num(row.repost_per_k)),
      replies: round1(num(row.reply_per_k)),
      quotes: round1(num(row.quote_per_k)),
    },
    mediaPct: round1(num(row.media_pct)),
    replyPct: round1(num(row.reply_pct)),
    quotePct: round1(num(row.quote_pct)),
    region: regionOf(num(row.zh_pct), num(row.en_pct)),
    kind: personKind(row.handle ?? row.source_id.replace(/^x-account-/, "")),
    // 模型初标在 listPeople / loadPerson 里覆盖，这里留默认值。
    category: null,
    topCategory: row.top_category,
    language: row.language,
    firstAt: new Date(row.first_at).toISOString(),
    lastAt: new Date(row.last_at).toISOString(),
    followers: row.followers == null ? null : Number(row.followers),
  };
}

/** 全部可画像的账号（有帖子、并且帖子数达到门槛的才列）。 */
export async function listPeople(): Promise<XPeopleResponse> {
  return queryPeople();
}

/**
 * 接口层用的同一份数据：一次聚合要 5–6 秒（12 万篇帖子 + 每篇取最新分析），整页 SSR 和筛选都等它。
 * 缓存 60 秒、之后先返回旧的再后台刷新——采集每两小时才写一次，这 60 秒不影响任何判断。
 * 测试和一次性脚本走 listPeople，读的永远是新数据。
 */
export const peoplePage = cached(queryPeople, { freshMs: 60_000, maxStaleMs: 600_000 });

async function queryPeople(): Promise<XPeopleResponse> {
  const rows = await sql<SummaryRow[]>`
    WITH p AS (${posts()}),
         per AS (
           SELECT ${SUMMARY}
           FROM p
           GROUP BY source_id
           HAVING count(*) >= 5
         )
    SELECT per.*, f.followers
    FROM per
    LEFT JOIN LATERAL (
      SELECT followers FROM x_follower_snapshots s
      WHERE s.handle = lower(per.handle)
      ORDER BY captured_on DESC, captured_at DESC
      LIMIT 1
    ) f ON true
    ORDER BY per.posts DESC
  `;
  const people = rows.map(toSummary);
  // 模型初标覆盖代码里的类型表；没有标过的账号保持原样。
  const meta = await accountMeta(people.map((person) => person.handle));
  for (const person of people) {
    const found = meta.get(person.handle);
    if (!found) continue;
    person.kind = found.kind;
    person.category = found.category;
  }
  return {
    people,
    generatedAt: new Date().toISOString(),
    totals: { people: people.length, posts: people.reduce((sum, p) => sum + p.posts, 0) },
  };
}

interface PostRow {
  id: string;
  text: string | null;
  tweet_id: string | null;
  published_at: Date;
  discovered_at: Date | null;
  likes: string;
  retweets: string;
  replies: string;
  quotes: string;
  views: string;
  media_kind: string;
  lang: string | null;
  is_reply: boolean;
}

function withInsight(post: XPost, followers: number | null): XPost {
  if (!post.capturedAt) return post;
  const age = ageHours(post.at, post.capturedAt);
  // 采集时已经过了 24 小时的帖子，预测值就是实际值，没必要显示。
  const projected = age !== null && age < 24 ? projected24hViews(post.views, age) : null;
  return { ...post, projected24h: projected, breakout: breakoutRatio(post.views, followers) };
}

function toPost(row: PostRow, handle: string): XPost {
  return {
    id: row.id,
    text: row.text ?? "",
    url: row.tweet_id ? `https://x.com/${handle}/status/${row.tweet_id}` : `https://x.com/${handle}`,
    at: new Date(row.published_at).toISOString(),
    capturedAt: row.discovered_at ? new Date(row.discovered_at).toISOString() : null,
    views: Number(row.views),
    likes: Number(row.likes),
    retweets: Number(row.retweets),
    replies: Number(row.replies),
    quotes: Number(row.quotes),
    mediaKind: row.media_kind,
    language: row.lang,
    isReply: row.is_reply,
  };
}

const postColumns = sql`
  a.id, a.x_post->>'text' AS text, a.x_post->>'tweetId' AS tweet_id, a.published_at, a.discovered_at,
  coalesce((a.raw->>'favorite')::bigint, 0) AS likes,
  coalesce((a.raw->>'retweet')::bigint, 0) AS retweets,
  coalesce((a.raw->>'reply')::bigint, 0) AS replies,
  coalesce((a.raw->>'quote')::bigint, 0) AS quotes,
  coalesce((a.raw->>'views')::bigint, 0) AS views,
  coalesce(a.x_post->'media'->0->>'kind', '') AS media_kind,
  coalesce(a.language, a.x_post->>'lang') AS lang,
  (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb) AS is_reply
`;

/** 一个账号的全部维度；`handle` 不区分大小写。没有这个账号时返回 null。 */
export async function loadPerson(handle: string): Promise<XPersonResponse | null> {
  const [who] = await sql<{ source_id: string; handle: string | null }[]>`
    SELECT source_id, max(x_post->>'handle') AS handle
    FROM articles
    WHERE source_id LIKE 'x-account-%' AND lower(x_post->>'handle') = lower(${handle})
    GROUP BY source_id
    LIMIT 1
  `;
  if (!who) return null;
  const id = who.source_id;
  const resolvedHandle = who.handle ?? handle;

  const [[row], weekly, hours, weekdays, categories, tags, languages, media, topRows, heatRows, hitsRows, formats] = await Promise.all([
    sql<SummaryRow[]>`WITH p AS (${posts()}) SELECT ${SUMMARY} FROM p WHERE source_id = ${id} GROUP BY source_id`,
    sql<{ week: string; posts: number; med_views: string; likes: string; views: string }[]>`
      WITH p AS (${posts()})
      SELECT to_char(date_trunc('week', published_at AT TIME ZONE ${BEIJING_TIMEZONE}), 'YYYY-MM-DD') AS week,
             count(*)::int AS posts,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views,
             sum(likes)::bigint AS likes,
             sum(views)::bigint AS views
      FROM p WHERE source_id = ${id}
      GROUP BY 1 ORDER BY 1
    `,
    sql<{ hour: number; posts: number; med_views: string }[]>`
      WITH p AS (${posts()})
      SELECT extract(hour FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS hour,
             count(*)::int AS posts,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM p WHERE source_id = ${id} GROUP BY 1 ORDER BY 1
    `,
    sql<{ weekday: number; posts: number; med_views: string }[]>`
      WITH p AS (${posts()})
      SELECT extract(isodow FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS weekday,
             count(*)::int AS posts,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM p WHERE source_id = ${id} GROUP BY 1 ORDER BY 1
    `,
    sql<{ key: string; count: number }[]>`
      WITH p AS (${posts()})
      SELECT category AS key, count(*)::int AS count FROM p WHERE source_id = ${id} AND category IS NOT NULL GROUP BY 1 ORDER BY 2 DESC
    `,
    sql<{ key: string; count: number }[]>`
      WITH p AS (${posts()})
      SELECT tag AS key, count(*)::int AS count FROM p, unnest(tags) AS tag WHERE source_id = ${id} GROUP BY 1 ORDER BY 2 DESC LIMIT 12
    `,
    sql<{ key: string; count: number }[]>`
      WITH p AS (${posts()})
      SELECT coalesce(lang, '未知') AS key, count(*)::int AS count FROM p WHERE source_id = ${id} GROUP BY 1 ORDER BY 2 DESC
    `,
    sql<{ key: string; count: number }[]>`
      WITH p AS (${posts()})
      SELECT CASE WHEN media_count = 0 THEN '文字' ELSE coalesce(nullif(media_kind, ''), '媒体') END AS key,
             count(*)::int AS count
      FROM p WHERE source_id = ${id} GROUP BY 1 ORDER BY 2 DESC
    `,
    sql<PostRow[]>`
      SELECT ${postColumns} FROM articles a
      WHERE a.source_id = ${id} AND a.published_at > now() - make_interval(days => ${WINDOW_DAYS})
      ORDER BY coalesce((a.raw->>'views')::bigint, 0) DESC LIMIT 12
    `,
    sql<{ weekday: number; hour: number; posts: number; med_views: string }[]>`
      WITH p AS (${posts()})
      SELECT extract(isodow FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS weekday,
             extract(hour FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS hour,
             count(*)::int AS posts,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM p WHERE source_id = ${id} GROUP BY 1, 2
    `,
    sql<{ is_top: boolean; posts: number; media_pct: string; reply_pct: string; avg_len: number; med_views: string; avg_likes: string }[]>`
      WITH p AS (${posts()}),
           q AS (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY views)::numeric AS cut FROM p WHERE source_id = ${id}),
           labeled AS (SELECT *, views >= (SELECT cut FROM q) AS is_top FROM p WHERE source_id = ${id})
      SELECT is_top,
             count(*)::int AS posts,
             round(100.0 * avg((media_count > 0)::int), 1) AS media_pct,
             round(100.0 * avg(is_reply::int), 1) AS reply_pct,
             round(avg(text_len))::int AS avg_len,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views,
             round(avg(likes))::bigint AS avg_likes
      FROM labeled GROUP BY 1
    `,
    sql<{ key: "media" | "text"; posts: number; med_views: string }[]>`
      WITH p AS (${posts()})
      SELECT CASE WHEN media_count > 0 THEN 'media' ELSE 'text' END AS key,
             count(*)::int AS posts,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM p WHERE source_id = ${id} GROUP BY 1
    `,
  ]);
  if (!row) return null;

  const filledHours = Array.from({ length: 24 }, (_, hour) => {
    const found = hours.find((h) => h.hour === hour);
    return { hour, posts: found?.posts ?? 0, medViews: Math.round(num(found?.med_views)) };
  });
  const filledWeekdays = Array.from({ length: 7 }, (_, index) => {
    const found = weekdays.find((w) => w.weekday === index + 1);
    return { weekday: index + 1, posts: found?.posts ?? 0, medViews: Math.round(num(found?.med_views)) };
  });
  const weeks: XSeriesPoint[] = weekly.slice(-12).map((w) => ({
    label: w.week.slice(5),
    posts: w.posts,
    medViews: Math.round(num(w.med_views)),
    likes: Number(w.likes),
    views: Number(w.views),
  }));

  // 跟自己比：近 4 周 vs 前 4 周（harken 的基线口径）。
  const windowStats = (points: XSeriesPoint[]) => {
    const posts = points.reduce((sum, p) => sum + p.posts, 0);
    const likes = points.reduce((sum, p) => sum + p.likes, 0);
    const views = points.reduce((sum, p) => sum + p.views, 0);
    const medViews = points.length ? Math.round(points.reduce((sum, p) => sum + p.medViews, 0) / points.length) : 0;
    return { posts, medViews, likes, views, engagementRate: round2(views ? (likes / views) * 100 : 0) };
  };
  const trend = { recent: windowStats(weeks.slice(-4)), previous: windowStats(weeks.slice(-8, -4)) };

  const bestOf = <T extends { posts: number; medViews: number }>(list: T[], key: (item: T) => number) => {
    const enough = list.filter((item) => item.posts >= 3).sort((a, b) => b.medViews - a.medViews)[0];
    return enough ? key(enough) : null;
  };

  const hitRow = (isTop: boolean) => {
    const found = hitsRows.find((h) => h.is_top === isTop);
    return {
      posts: found?.posts ?? 0,
      mediaPct: round1(num(found?.media_pct)),
      replyPct: round1(num(found?.reply_pct)),
      avgLength: found?.avg_len ?? 0,
      medViews: Math.round(num(found?.med_views)),
      avgLikes: Math.round(num(found?.avg_likes)),
    };
  };

  // 7×24 热力图：周几 × 小时，空格补 0，前端直接铺。
  const heat = new Map(heatRows.map((h) => [`${h.weekday}-${h.hour}`, h]));
  const heatmap = Array.from({ length: 7 }, (_, w) =>
    Array.from({ length: 24 }, (_, hour) => {
      const found = heat.get(`${w + 1}-${hour}`);
      return { weekday: w + 1, hour, posts: found?.posts ?? 0, medViews: Math.round(num(found?.med_views)) };
    }),
  ).flat();

  const summary = toSummary(row);
  const [meta, median, snap] = await Promise.all([
    accountMeta([summary.handle]),
    structureMedians(),
    sql<{ followers: string }[]>`SELECT followers::text AS followers FROM x_follower_snapshots WHERE handle = ${resolvedHandle} ORDER BY captured_on DESC LIMIT 1`,
  ]);
  // 破圈系数要粉丝数：优先用最新快照，没有快照时退回画像里的值。
  const followers = snap[0] ? Number(snap[0].followers) : summary.followers;
  const structure = { median, verdict: structureVerdict(summary.perK, median) };
  return {
    person: meta.get(summary.handle) ? { ...summary, kind: meta.get(summary.handle)!.kind, category: meta.get(summary.handle)!.category } : summary,
    structure,
    weekly: weeks,
    trend,
    hours: filledHours,
    weekdays: filledWeekdays,
    heatmap,
    formats: formats.map((f) => ({ key: f.key, posts: f.posts, medViews: Math.round(num(f.med_views)) })),
    hits: { top: hitRow(true), rest: hitRow(false) },
    best: { hour: bestOf(filledHours, (h) => h.hour), weekday: bestOf(filledWeekdays, (w) => w.weekday) },
    categories,
    tags,
    languages,
    media,
    topPosts: topRows.map((r) => withInsight(toPost(r, resolvedHandle), followers)),
    // 粉丝快照在 followers.ts 里读：接口层把 loadPersonGrowth 的结果填进来。
    growth: null,
  };
}
