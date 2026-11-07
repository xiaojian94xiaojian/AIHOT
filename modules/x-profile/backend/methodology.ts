// 跨账号内容方法论：每个账号按自己的浏览 P90 切出“爆款”，再把这些爆款放到一起看共性。
// 这样大号不会因为绝对浏览高而淹没小号的相对爆款；结论只描述相关性。
import { sql } from "@aihot/backend/db";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { num, posts } from "./data.ts";
import type { XHitSummary, XMethodologyResponse } from "../types.ts";

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 每篇帖子 + 所属账号的 P90 切点；账号至少 20 帖才参与。 */
const LABELED = sql`
  SELECT p.*, (p.views >= per.cut) AS is_hit, per.cut
  FROM (${posts()}) p
  JOIN (
    SELECT source_id, percentile_cont(0.9) WITHIN GROUP (ORDER BY views)::numeric AS cut
    FROM (${posts()}) q
    GROUP BY 1 HAVING count(*) >= 20
  ) per ON per.source_id = p.source_id
  -- 只统计发布满 3 天的帖子：浏览是抓取快照，新帖还没攒够曝光。
  WHERE p.published_at < now() - interval '3 days'
`;

interface TotalRow {
  accounts: number;
  posts: number;
  hits: number;
  hit_rate: string;
  top_media: string; top_reply: string; top_len: number; top_med: string;
  rest_media: string; rest_reply: string; rest_len: number; rest_med: string;
}
interface FormatRow { key: string; posts: number; hits: number; hit_rate: string; med_views: string }
interface LengthRow { key: string; posts: number; hit_rate: string; med_views: string }
interface HourRow { hour: number; posts: number; hit_rate: string; med_views: string }
interface WeekdayRow { weekday: number; posts: number; hit_rate: string }
interface LanguageRow { key: string; posts: number; hit_rate: string }
interface CategoryRow { key: string; posts: number; hit_rate: string }
interface RegionRow { key: string; posts: number; hit_rate: string; media_pct: string }
interface ExemplarRow {
  handle: string; author: string; text: string | null; tweet_id: string | null;
  views: string; likes: string; ratio: string; published_at: Date;
}

const hit = (row: { posts: number; media_pct?: string; reply_pct?: string; avg_len?: number; med_views?: string }): XHitSummary => ({
  posts: row.posts,
  mediaPct: round1(num(row.media_pct)),
  replyPct: round1(num(row.reply_pct)),
  avgLength: row.avg_len ?? 0,
  medViews: Math.round(num(row.med_views)),
});

export async function loadMethodology(): Promise<XMethodologyResponse> {
  const [[total], formats, lengths, hours, weekdays, languages, categories, regions, exemplars] = await Promise.all([
    sql<TotalRow[]>`
      WITH l AS (${LABELED})
      SELECT count(DISTINCT source_id)::int AS accounts,
             count(*)::int AS posts,
             count(*) FILTER (WHERE is_hit)::int AS hits,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate,
             round(100.0 * avg((media_count > 0)::int) FILTER (WHERE is_hit), 1) AS top_media,
             round(100.0 * avg(is_reply::int) FILTER (WHERE is_hit), 1) AS top_reply,
             round(avg(text_len) FILTER (WHERE is_hit))::int AS top_len,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE is_hit))::bigint AS top_med,
             round(100.0 * avg((media_count > 0)::int) FILTER (WHERE NOT is_hit), 1) AS rest_media,
             round(100.0 * avg(is_reply::int) FILTER (WHERE NOT is_hit), 1) AS rest_reply,
             round(avg(text_len) FILTER (WHERE NOT is_hit))::int AS rest_len,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE NOT is_hit))::bigint AS rest_med
      FROM l
    `,
    sql<FormatRow[]>`
      WITH l AS (${LABELED})
      SELECT CASE WHEN media_kind = 'video' THEN 'video' WHEN media_count > 0 THEN 'image' ELSE 'text' END AS key,
             count(*)::int AS posts,
             count(*) FILTER (WHERE is_hit)::int AS hits,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM l GROUP BY 1
    `,
    sql<LengthRow[]>`
      WITH l AS (${LABELED})
      SELECT CASE WHEN text_len <= 140 THEN '0-140'
                  WHEN text_len <= 280 THEN '141-280'
                  WHEN text_len <= 560 THEN '281-560'
                  ELSE '560+' END AS key,
             count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM l GROUP BY 1
    `,
    sql<HourRow[]>`
      WITH l AS (${LABELED})
      SELECT extract(hour FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS hour,
             count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
      FROM l GROUP BY 1 ORDER BY 1
    `,
    sql<WeekdayRow[]>`
      WITH l AS (${LABELED})
      SELECT extract(isodow FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS weekday,
             count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate
      FROM l GROUP BY 1 ORDER BY 1
    `,
    sql<LanguageRow[]>`
      WITH l AS (${LABELED})
      SELECT CASE WHEN lang LIKE 'zh%' THEN 'zh' WHEN lang LIKE 'en%' THEN 'en' ELSE 'other' END AS key,
             count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate
      FROM l GROUP BY 1
    `,
    sql<CategoryRow[]>`
      WITH l AS (${LABELED})
      SELECT category AS key, count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate
      FROM l WHERE category IS NOT NULL GROUP BY 1 HAVING count(*) >= 100 ORDER BY 2 DESC
    `,
    sql<RegionRow[]>`
      WITH l AS (${LABELED})
      SELECT CASE WHEN lang LIKE 'zh%' THEN 'zh' WHEN lang LIKE 'en%' THEN 'en' ELSE 'other' END AS key,
             count(*)::int AS posts,
             round(100.0 * count(*) FILTER (WHERE is_hit) / count(*), 1) AS hit_rate,
             round(100.0 * avg((media_count > 0)::int), 1) AS media_pct
      FROM l GROUP BY 1
    `,
    sql<ExemplarRow[]>`
      WITH l AS (${LABELED})
      SELECT handle, author, text, tweet_id,
             views::bigint AS views, likes::bigint AS likes,
             round((views / nullif(cut, 0))::numeric, 1) AS ratio,
             published_at
      FROM l WHERE is_hit AND text IS NOT NULL AND length(text) > 40
        -- 爆款样本是给读者看的：去掉极端、自伤向的帖子（关键词粗筛，宁严勿宽）。
        AND text !~* '(自杀|自残|割腕|轻生|跳楼|去死|想死|kys|kill myself|suicide|self.?harm)'
      ORDER BY views / nullif(cut, 0) DESC LIMIT 12
    `,
  ]);
  if (!total) throw new Error("methodology: no labeled posts");

  const order = ["text", "image", "video"];
  return {
    totals: {
      accounts: total.accounts,
      posts: total.posts,
      hits: total.hits,
      hitRate: round1(num(total.hit_rate)),
      matureDays: 3,
    },
    overall: {
      top: hit({ posts: total.hits, media_pct: total.top_media, reply_pct: total.top_reply, avg_len: total.top_len, med_views: total.top_med }),
      rest: hit({ posts: total.posts - total.hits, media_pct: total.rest_media, reply_pct: total.rest_reply, avg_len: total.rest_len, med_views: total.rest_med }),
    },
    formats: formats
      .map((f) => ({ key: f.key, posts: f.posts, hits: f.hits, hitRate: round1(num(f.hit_rate)), medViews: Math.round(num(f.med_views)) }))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    lengths: ["0-140", "141-280", "281-560", "560+"].map((key) => {
      const found = lengths.find((row) => row.key === key);
      return { key, posts: found?.posts ?? 0, hitRate: round1(num(found?.hit_rate)), medViews: Math.round(num(found?.med_views)) };
    }),
    hours: Array.from({ length: 24 }, (_, hour) => {
      const found = hours.find((row) => row.hour === hour);
      return { hour, posts: found?.posts ?? 0, hitRate: round1(num(found?.hit_rate)), medViews: Math.round(num(found?.med_views)) };
    }),
    weekdays: Array.from({ length: 7 }, (_, index) => {
      const found = weekdays.find((row) => row.weekday === index + 1);
      return { weekday: index + 1, posts: found?.posts ?? 0, hitRate: round1(num(found?.hit_rate)) };
    }),
    languages: languages.map((l) => ({ key: l.key, posts: l.posts, hitRate: round1(num(l.hit_rate)) })),
    categories: categories.map((c) => ({ key: c.key, posts: c.posts, hitRate: round1(num(c.hit_rate)) })),
    regions: regions.map((r) => ({ key: r.key, posts: r.posts, hitRate: round1(num(r.hit_rate)), mediaPct: round1(num(r.media_pct)) })),
    exemplars: exemplars.map((e) => ({
      handle: e.handle,
      author: e.author,
      text: e.text ?? "",
      url: e.tweet_id ? `https://x.com/${e.handle}/status/${e.tweet_id}` : `https://x.com/${e.handle}`,
      views: Number(e.views),
      likes: Number(e.likes),
      ratio: num(e.ratio),
      at: new Date(e.published_at).toISOString(),
    })),
  };
}
