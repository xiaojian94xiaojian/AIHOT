// 跨账号内容方法论：每个账号按自己的浏览 P90 切出“爆款”，再把这些爆款放到一起看共性。
// 这样大号不会因为绝对浏览高而淹没小号的相对爆款；结论只描述相关性。
import { sql } from "@aihot/backend/db";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { cached } from "@aihot/backend/lib/cache";
import { num, posts } from "./data.ts";
import type { XHitSummary, XMethodologyResponse } from "../types.ts";

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 每篇成熟的原创新帖 + 所属账号的 P90 切点；账号至少 20 帖成熟原创才参与。
 * 回复帖的浏览结构和原创不同，和卡片/画像页一样不进池；P90 也只从同一批成熟帖里切，
 * 否则切点会被还没攒够曝光的新帖往下拉。
 */
const LABELED = sql`
  WITH matured AS (
    SELECT * FROM (${posts()}) m
    WHERE m.published_at < now() - interval '3 days' AND NOT m.is_reply
  )
  SELECT p.*, (p.views >= per.cut) AS is_hit, per.cut
  FROM matured p
  JOIN (
    SELECT source_id, percentile_cont(0.9) WITHIN GROUP (ORDER BY views)::numeric AS cut
    FROM matured
    GROUP BY 1 HAVING count(*) >= 20
  ) per ON per.source_id = p.source_id
`;

interface TotalRow {
  accounts: number;
  posts: number;
  hits: number;
  hit_rate: string | null;
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

interface PageJson {
  total: TotalRow;
  formats: FormatRow[];
  lengths: LengthRow[];
  hours: HourRow[];
  weekdays: WeekdayRow[];
  languages: LanguageRow[];
  categories: CategoryRow[];
  regions: RegionRow[];
  exemplars: ExemplarRow[];
}

export async function loadMethodology(): Promise<XMethodologyResponse> {
  // 一次扫描：posts() 里的 analyses 横向关联是主要成本，分 9 条查询会各扫一遍；这里把它物化一次，
  // 之后所有聚合都在同一批 l 上做（原来单次冷算约 38 秒，页面 15 秒超时会 503）。
  const [row] = await sql<{ page: PageJson }[]>`
    WITH p AS (${posts()}),
         matured AS (
           SELECT * FROM p WHERE p.published_at < now() - interval '3 days' AND NOT p.is_reply
         ),
         per AS (
           SELECT source_id, percentile_cont(0.9) WITHIN GROUP (ORDER BY views)::numeric AS cut
           FROM matured GROUP BY 1 HAVING count(*) >= 20
         ),
         l AS (
           SELECT matured.*, per.cut, (matured.views >= per.cut) AS is_hit
           FROM matured JOIN per ON per.source_id = matured.source_id
         )
    SELECT jsonb_build_object(
      'total', (SELECT jsonb_build_object(
        'accounts', count(DISTINCT source_id)::int,
        'posts', count(*)::int,
        'hits', count(*) FILTER (WHERE is_hit)::int,
        'hit_rate', round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1),
        'top_media', round(100.0 * avg((media_count > 0)::int) FILTER (WHERE is_hit), 1),
        'top_reply', round(100.0 * avg(is_reply::int) FILTER (WHERE is_hit), 1),
        'top_len', round(avg(text_len) FILTER (WHERE is_hit))::int,
        'top_med', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE is_hit))::bigint,
        'rest_media', round(100.0 * avg((media_count > 0)::int) FILTER (WHERE NOT is_hit), 1),
        'rest_reply', round(100.0 * avg(is_reply::int) FILTER (WHERE NOT is_hit), 1),
        'rest_len', round(avg(text_len) FILTER (WHERE NOT is_hit))::int,
        'rest_med', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FILTER (WHERE NOT is_hit))::bigint
      ) FROM l),
      'formats', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (
        SELECT CASE WHEN media_kind = 'video' THEN 'video' WHEN media_count > 0 THEN 'image' ELSE 'text' END AS key,
               count(*)::int AS posts,
               count(*) FILTER (WHERE is_hit)::int AS hits,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
        FROM l GROUP BY 1
      ) f),
      'lengths', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (
        SELECT CASE WHEN text_len <= 140 THEN '0-140'
                    WHEN text_len <= 280 THEN '141-280'
                    WHEN text_len <= 560 THEN '281-560'
                    ELSE '560+' END AS key,
               count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
        FROM l GROUP BY 1
      ) f),
      'hours', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY hour), '[]'::jsonb) FROM (
        SELECT extract(hour FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS hour,
               count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY views)::numeric)::bigint AS med_views
        FROM l GROUP BY 1
      ) f),
      'weekdays', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY weekday), '[]'::jsonb) FROM (
        SELECT extract(isodow FROM published_at AT TIME ZONE ${BEIJING_TIMEZONE})::int AS weekday,
               count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate
        FROM l GROUP BY 1
      ) f),
      'languages', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (
        SELECT CASE WHEN lang LIKE 'zh%' THEN 'zh' WHEN lang LIKE 'en%' THEN 'en' ELSE 'other' END AS key,
               count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate
        FROM l GROUP BY 1
      ) f),
      'categories', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY posts DESC), '[]'::jsonb) FROM (
        SELECT category AS key, count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate
        FROM l WHERE category IS NOT NULL GROUP BY 1 HAVING count(*) >= 100
      ) f),
      'regions', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (
        SELECT CASE WHEN lang LIKE 'zh%' THEN 'zh' WHEN lang LIKE 'en%' THEN 'en' ELSE 'other' END AS key,
               count(*)::int AS posts,
               round(100.0 * count(*) FILTER (WHERE is_hit) / nullif(count(*), 0), 1) AS hit_rate,
               round(100.0 * avg((media_count > 0)::int), 1) AS media_pct
        FROM l GROUP BY 1
      ) f),
      'exemplars', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY ratio DESC), '[]'::jsonb) FROM (
        SELECT handle, author, text, tweet_id,
               views::bigint AS views, likes::bigint AS likes,
               round((views / nullif(cut, 0))::numeric, 1) AS ratio,
               published_at
        FROM l WHERE is_hit AND text IS NOT NULL AND length(text) > 40
          -- 爆款样本是给读者看的：去掉极端、自伤向的帖子（关键词粗筛，宁严勿宽）。
          AND text !~* '(自杀|自残|割腕|轻生|跳楼|去死|想死|kys|kill myself|suicide|self.?harm)'
        ORDER BY views / nullif(cut, 0) DESC LIMIT 12
      ) e)
    ) AS page`;
  const page = row?.page;
  if (!page?.total) throw new Error("methodology: no labeled posts");
  const { total, formats, lengths, hours, weekdays, languages, categories, regions, exemplars } = page;

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

/**
 * 这条聚合要扫 120 天的帖子上十秒，而页面只读一个结论：10 分钟内复用上一次结果，
 * 过期后先返回旧值、后台再算，读者不会再等到 15 秒超时。
 */
export const methodologyPage = cached(loadMethodology, { freshMs: 600_000, maxStaleMs: 3_600_000 });
