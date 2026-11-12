// 公开周报：把「这周谁涨粉最多、哪条帖子最火、大家发的是什么形态」做成一张可以分享、也可以订阅的
// 周报页。数字全部来自本站自己的抓取（x_follower_snapshots + articles），不调模型，页面只读结果。
// 只报已经过完的周；缺基线的那一周直接说数据不足，不编趋势。
import { sql } from "@aihot/backend/db";
import { cachedByKey } from "@aihot/backend/lib/cache";
import { config } from "@aihot/backend/config";
import { SITE } from "@aihot/site";
import { addDays, beijingAt, beijingDate, beijingTime, beijingWeekday, isValidDate } from "@aihot/contracts/time";
import { escapeXml, weekStartOf } from "./digest.ts";
import { posts } from "./data.ts";
import { regionOf } from "./classify.ts";
import type { XWeeklyDarkHorse, XWeeklyPattern, XWeeklyResponse, XWeeklyRow, XWeeklyShape, XWeeklySummary, XWeeklyViral } from "../types.ts";

/** 页面上能回看的周数，也是 RSS 的条目数。 */
export const WEEKLY_WEEKS = 8;
const TOP = 10;
const VIRAL = 6;

/** 最近一个已经过完的周一（北京时间）。 */
export function lastClosedWeekStart(today = beijingDate(new Date())): string {
  return addDays(weekStartOf(today), -7);
}

/** 从最近一个过完的周开始，往回 n 个周一。 */
export function recentWeeks(today = beijingDate(new Date()), n = WEEKLY_WEEKS): string[] {
  const out: string[] = [];
  let start = lastClosedWeekStart(today);
  for (let i = 0; i < n; i += 1) {
    out.push(start);
    start = addDays(start, -7);
  }
  return out;
}

interface GrowthRow {
  handle: string;
  screen_name: string | null;
  name: string | null;
  avatar_url: string | null;
  followers: string;
  baseline: string;
  end_on: string;
  baseline_on: string;
}

/** 基线最远回看到上周日之前多少天：再久就把多周涨幅算进一周，宁可不上榜。 */
const MAX_BASELINE_LAG_DAYS = 14;

/**
 * 一周的涨粉：取这周内最后一次快照，减去上周日（或更早最近一次）的快照；基线太旧就以 14 天为限不上榜。
 * 稀疏快照按 span 折算成一周（与涨粉榜 growthBoard 同口径），免得三周的涨幅被当成一周。
 * 这周没采到快照、或没有基线的账号不参与排名 —— 不做假数据。
 */
async function growthOf(start: string, end: string): Promise<GrowthRow[]> {
  return sql<GrowthRow[]>`
    WITH e AS (
      SELECT DISTINCT ON (handle) handle, screen_name, name, avatar_url, followers, captured_on
      FROM x_follower_snapshots
      WHERE captured_on <= ${end}::date
      ORDER BY handle, captured_on DESC
    ), s AS (
      SELECT DISTINCT ON (handle) handle, followers, captured_on
      FROM x_follower_snapshots
      WHERE captured_on <= ${addDays(start, -1)}::date
      ORDER BY handle, captured_on DESC
    )
    SELECT e.handle, e.screen_name, e.name, e.avatar_url,
           e.followers::text AS followers, s.followers::text AS baseline,
           to_char(e.captured_on, 'YYYY-MM-DD') AS end_on,
           to_char(s.captured_on, 'YYYY-MM-DD') AS baseline_on
    FROM e JOIN s USING (handle)
    WHERE e.captured_on >= ${start}::date AND e.captured_on <= ${end}::date
      AND s.captured_on >= ${addDays(start, -MAX_BASELINE_LAG_DAYS)}::date`;
}

/**
 * 中文 AI 圈：近 120 天抓到的帖子里中文占一半以上的账号（与涨粉榜的 region 口径一致）。
 * 没有语言证据的账号不算进来 —— 榜单写的是中文圈，就不能拿全区的账号充数。
 * 帖子里的 handle 是 SocialData 返回的原样大小写（`AndrewYNg`），快照键是小写，比较一律 lower()。
 */
async function chineseHandles(handles: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (handles.length === 0) return out;
  const rows = await sql<{ handle: string; zh: number; en: number }[]>`
    SELECT lower(a.x_post->>'handle') AS handle,
           count(*) FILTER (WHERE coalesce(a.language, a.x_post->>'lang') LIKE 'zh%')::int AS zh,
           count(*) FILTER (WHERE coalesce(a.language, a.x_post->>'lang') LIKE 'en%')::int AS en
    FROM articles a
    WHERE a.source_id LIKE 'x-account-%'
      AND a.published_at > now() - interval '120 days'
      AND lower(a.x_post->>'handle') IN ${sql(handles)}
    GROUP BY 1`;
  for (const row of rows) {
    const known = row.zh + row.en;
    if (known > 0 && regionOf((row.zh / known) * 100, (row.en / known) * 100) === "zh") out.add(row.handle);
  }
  return out;
}

/** 这一周里每个账号发了多少帖、带来多少浏览（同样按小写 handle 对齐快照）。 */
async function activityOf(startAt: Date, endAt: Date, handles: string[]): Promise<Map<string, { posts: number; views: number }>> {
  const out = new Map<string, { posts: number; views: number }>();
  if (handles.length === 0) return out;
  const rows = await sql<{ handle: string; posts: number; views: string }[]>`
    SELECT lower(a.x_post->>'handle') AS handle, count(*)::int AS posts,
           coalesce(sum(coalesce((a.raw->>'views')::bigint, 0)), 0)::text AS views
    FROM articles a
    WHERE a.source_id LIKE 'x-account-%'
      AND a.published_at >= ${startAt} AND a.published_at < ${endAt}
      AND lower(a.x_post->>'handle') IN ${sql(handles)}
      AND coalesce(a.language, a.x_post->>'lang') LIKE 'zh%'
    GROUP BY 1`;
  for (const row of rows) out.set(row.handle, { posts: Number(row.posts), views: Number(row.views) });
  return out;
}

async function viralOf(startAt: Date, endAt: Date): Promise<XWeeklyViral[]> {
  const rows = await sql<{ handle: string; author: string | null; text: string | null; tweet_id: string; views: string; likes: string; media: number; published_at: Date }[]>`
    SELECT p.handle, p.author, p.text, p.tweet_id, p.views::text AS views, p.likes::text AS likes,
           p.media_count AS media, p.published_at
    FROM (${posts()}) p
    WHERE p.published_at >= ${startAt} AND p.published_at < ${endAt}
      AND p.tweet_id IS NOT NULL AND p.views > 0 AND p.lang LIKE 'zh%'
    ORDER BY p.views DESC
    LIMIT ${VIRAL}`;
  return rows.map((row) => {
    const at = new Date(row.published_at);
    const views = Number(row.views);
    return {
      handle: row.handle,
      author: row.author,
      text: row.text ?? "",
      url: `https://x.com/${row.handle}/status/${row.tweet_id}`,
      views,
      likes: Number(row.likes),
      at: at.toISOString(),
      chars: (row.text ?? "").length,
      media: Number(row.media),
      weekday: beijingWeekday(beijingDate(at)),
      hour: Number(beijingTime(at).slice(0, 2)),
      likeRate: views > 0 ? Math.round((Number(row.likes) / views) * 1000) / 10 : 0,
    };
  });
}

/** 这一周的内容形态：纯文字、带图/视频、引用、回复，各占多少；顺便给出篇幅与晚间占比给「本周观察」。 */
async function shapeOf(startAt: Date, endAt: Date): Promise<{ shape: XWeeklyShape[]; summary: XWeeklySummary }> {
  const [row] = await sql<{ text: number; media: number; quote: number; reply: number; total: number; views: string; accounts: number; median_chars: string; evening: number }[]>`
    SELECT count(*) FILTER (WHERE media_count = 0 AND NOT is_quote AND NOT is_reply)::int AS text,
           count(*) FILTER (WHERE media_count > 0)::int AS media,
           count(*) FILTER (WHERE is_quote)::int AS quote,
           count(*) FILTER (WHERE is_reply)::int AS reply,
           count(*)::int AS total, coalesce(sum(p.views), 0)::text AS views,
           count(DISTINCT p.handle)::int AS accounts,
           coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY length(p.text)), 0)::text AS median_chars,
           count(*) FILTER (WHERE extract(hour from p.published_at at time zone 'Asia/Shanghai') >= 20)::int AS evening
    FROM (${posts()}) p
    WHERE p.published_at >= ${startAt} AND p.published_at < ${endAt} AND p.lang LIKE 'zh%'`;
  const total = row?.total ?? 0;
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  const shape = [
    { key: "text", label: "纯文字", posts: row?.text ?? 0, share: share(row?.text ?? 0) },
    { key: "media", label: "带图/视频", posts: row?.media ?? 0, share: share(row?.media ?? 0) },
    { key: "quote", label: "引用", posts: row?.quote ?? 0, share: share(row?.quote ?? 0) },
    { key: "reply", label: "回复", posts: row?.reply ?? 0, share: share(row?.reply ?? 0) },
  ];
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    shape,
    summary: {
      accounts: row?.accounts ?? 0,
      posts: total,
      views: Number(row?.views ?? 0),
      mediaPct: pct(row?.media ?? 0),
      medianChars: Math.round(Number(row?.median_chars ?? 0)),
      eveningPct: pct(row?.evening ?? 0),
      quotePct: pct(row?.quote ?? 0),
    },
  };
}

/** 一周的规模（帖子/浏览/账号），用来跟上一周对比；口径与榜单相同，只算中文帖。 */
async function scaleOf(start: string): Promise<{ posts: number; views: number; accounts: number }> {
  const end = addDays(start, 6);
  const [row] = await sql<{ posts: number; views: string; accounts: number }[]>`
    SELECT count(*)::int AS posts, coalesce(sum(p.views), 0)::text AS views,
           count(DISTINCT p.handle)::int AS accounts
    FROM (${posts()}) p
    WHERE p.published_at >= ${beijingAt(start, "00:00")} AND p.published_at < ${beijingAt(addDays(end, 1), "00:00")}
      AND p.lang LIKE 'zh%'`;
  return { posts: row?.posts ?? 0, views: Number(row?.views ?? 0), accounts: row?.accounts ?? 0 };
}

/** 快照差按天数折算成一周；build 与「比上周」共用，公式只写一处。 */
function scoredOf(rows: GrowthRow[]): Array<{ row: GrowthRow; growth: number; growthPct: number }> {
  return rows
    .map((row) => {
      const spanDays = Math.max(1, Math.round((Date.parse(row.end_on) - Date.parse(row.baseline_on)) / 86_400_000));
      const value = Math.round(((Number(row.followers) - Number(row.baseline)) * 7) / spanDays);
      const baseline = Number(row.baseline);
      return { row, growth: value, growthPct: baseline > 0 ? Math.round((value / baseline) * 1000) / 10 : 0 };
    })
    .filter((item) => item.growth > 0);
}

/** 某周涨粉前 10 之和（只算中文账号、按同一套折算），用于「比上周」。 */
async function topGrowthOf(start: string): Promise<number> {
  const scored = scoredOf(await growthOf(start, addDays(start, 6)));
  const chinese = await chineseHandles(scored.map((item) => item.row.handle));
  return scored
    .filter((item) => chinese.has(item.row.handle))
    .sort((a, b) => b.growth - a.growth)
    .slice(0, TOP)
    .reduce((sum, item) => sum + item.growth, 0);
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

/**
 * 本周观察：只从数据里读出「能照着做」的几条，每条都带数字。
 * 爆款的三条只在整个样本采满时判，且用中位数而不是均值（一条长帖就能把均值拉高）。
 * 标题是陈述不是结论；全周基线含回复和引用，爆款基本是原帖，这个差别写在页面脚注里。
 */
function patternsOf(viral: XWeeklyViral[], summary: XWeeklySummary, rows: XWeeklyRow[], dark: XWeeklyDarkHorse | null): XWeeklyPattern[] {
  const out: XWeeklyPattern[] = [];
  if (viral.length === VIRAL) {
    const withMedia = viral.filter((post) => post.media > 0).length;
    const mediaShare = Math.round((withMedia / viral.length) * 100);
    if (mediaShare - summary.mediaPct >= 10) {
      out.push({ title: "爆款里带图的多", detail: `本周 ${viral.length} 条爆款里有 ${withMedia} 条带图或视频（${mediaShare}%），全周发帖的带图比例是 ${summary.mediaPct}%。` });
    }
    const viralChars = median(viral.map((post) => post.chars));
    if (summary.medianChars > 0 && viralChars >= summary.medianChars * 1.5) {
      out.push({ title: "爆款篇幅偏长", detail: `爆款正文字数中位数 ${viralChars}，全周中位数 ${summary.medianChars}。` });
    }
    const evening = viral.filter((post) => post.hour >= 20).length;
    const eveningShare = Math.round((evening / viral.length) * 100);
    if (eveningShare - summary.eveningPct >= 15) {
      out.push({ title: "爆款多在晚上发", detail: `爆款 ${evening}/${viral.length} 条在 20 点后发布（${eveningShare}%），全周只有 ${summary.eveningPct}% 的帖子在这个时段。` });
    }
  }
  if (rows.length >= 3 && summary.accounts > 0) {
    const avgPosts = Math.round(rows.reduce((sum, row) => sum + row.posts, 0) / rows.length);
    const allAvg = Math.round(summary.posts / summary.accounts);
    if (avgPosts >= Math.max(2, allAvg * 1.5)) {
      out.push({ title: "上榜账号发得更勤", detail: `涨粉榜前 ${rows.length} 的账号本周人均发 ${avgPosts} 条，全站有产出的账号人均 ${allAvg} 条。` });
    }
  }
  if (dark) {
    out.push({ title: "小账号也能上榜", detail: `粉丝 ${dark.followers.toLocaleString("en-US")} 的 @${dark.handle} 本周净增 ${dark.growth.toLocaleString("en-US")} 粉（+${dark.growthPct}%），是本周符合黑马条件的账号里涨幅最高的。` });
  }
  return out;
}

async function build(start: string): Promise<XWeeklyResponse> {
  const end = addDays(start, 6);
  const startAt = beijingAt(start, "00:00");
  const endAt = beijingAt(addDays(end, 1), "00:00");
  const prevStart = addDays(start, -7);
  const scored = scoredOf(await growthOf(start, end));
  const chinese = await chineseHandles(scored.map((item) => item.row.handle));
  const zh = scored.filter((item) => chinese.has(item.row.handle));
  const ranked = [...zh].sort((a, b) => b.growth - a.growth).slice(0, TOP);
  // 小账号榜要有实际量级：涨粉少于 300 的不算「黑马」，否则 1000 粉涨 20 粉也能排第一。
  const dark = zh
    .filter((item) => item.growth >= 300 && Number(item.row.followers) >= 1_000 && Number(item.row.followers) <= 50_000)
    .sort((a, b) => b.growthPct - a.growthPct)
    .slice(0, 5);
  const handles = [...new Set([...ranked, ...dark].map((item) => item.row.handle))];
  const [activity, viral, shape, prevScale, prevTopGrowth] = await Promise.all([
    activityOf(startAt, endAt, handles),
    viralOf(startAt, endAt),
    shapeOf(startAt, endAt),
    scaleOf(prevStart),
    topGrowthOf(prevStart),
  ]);
  const rows: XWeeklyRow[] = ranked.map(({ row, growth: value, growthPct }, index) => {
    const extra = activity.get(row.handle) ?? { posts: 0, views: 0 };
    return {
      rank: index + 1,
      handle: row.handle,
      name: row.name,
      avatarUrl: row.avatar_url,
      followers: Number(row.followers),
      growth: value,
      growthPct,
      posts: extra.posts,
      views: extra.views,
      perK: extra.views > 0 ? Math.round((value / extra.views) * 1000 * 10) / 10 : null,
    };
  });
  const darkHorses: XWeeklyDarkHorse[] = dark.map(({ row, growth: value, growthPct }) => ({
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatar_url,
    followers: Number(row.followers),
    growth: value,
    growthPct,
    posts: activity.get(row.handle)?.posts ?? 0,
  }));
  const topGrowth = ranked.reduce((sum, item) => sum + item.growth, 0);
  return {
    week: { start, end },
    weeks: recentWeeks(),
    rows,
    darkHorses,
    patterns: patternsOf(viral, shape.summary, rows, darkHorses[0] ?? null),
    compare: {
      posts: shape.summary.posts,
      views: shape.summary.views,
      accounts: shape.summary.accounts,
      topGrowth,
      prevPosts: prevScale.posts,
      prevViews: prevScale.views,
      prevAccounts: prevScale.accounts,
      prevTopGrowth,
    },
    viral,
    shape: shape.shape,
    summary: shape.summary,
    generatedAt: new Date().toISOString(),
  };
}

/** 同一周的结果缓存十分钟：页面和 RSS 共用一次计算。 */
const weekly = cachedByKey<string, XWeeklyResponse>((week) => week, (week) => build(week), {
  freshMs: 600_000,
  maxStaleMs: 3_600_000,
  maxKeys: WEEKLY_WEEKS,
});

/** 最近一个过完的周，或指定的那一周；不是周一的日期按所在周算。 */
export async function loadWeekly(week?: string | null): Promise<XWeeklyResponse> {
  const weeks = recentWeeks();
  const wanted = week && isValidDate(week) ? weekStartOf(week) : weeks[0]!;
  return weekly(weeks.includes(wanted) ? wanted : weeks[0]!);
}

/** 周报 RSS：最近八周，每周一条，点进去是那一周的页面。 */
export async function weeklyFeed(today = beijingDate(new Date())): Promise<string> {
  const weeks = recentWeeks(today);
  const reports = await Promise.all(weeks.map((week) => loadWeekly(week)));
  const items = reports
    .map((report) => {
      const top = report.rows.slice(0, 3);
      const names = top.map((row) => `@${row.handle} +${row.growth.toLocaleString("en-US")}`).join("、");
      const best = report.viral[0];
      const title = `${report.week.end} 那周：${names || "暂无涨粉数据"}`;
      const description = [
        top.length ? `涨粉前三：${names}。` : "这一周没有足够快照，涨粉榜单暂缺。",
        best ? `最热帖子：@${best.handle} ${best.views.toLocaleString("en-US")} 浏览。` : "",
        `那周共 ${report.summary.posts.toLocaleString("en-US")} 帖、${report.summary.accounts} 个账号在发，带图/视频占 ${report.summary.mediaPct}%。`,
        report.patterns[0] ? `本周观察：${report.patterns[0].detail}` : "",
      ].filter(Boolean).join("");
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(`${config.siteUrl}/x-people/weekly?week=${report.week.start}`)}</link>
      <guid isPermaLink="false">${escapeXml(`${config.siteUrl}/x-people/weekly#${report.week.start}`)}</guid>
      <pubDate>${beijingAt(report.week.end, "12:00").toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${SITE.name} · 中文 AI 圈涨粉周报`)}</title>
    <link>${escapeXml(`${config.siteUrl}/x-people/weekly`)}</link>
    <description>${escapeXml("每周一期的中文 AI 圈涨粉周报：TOP 涨粉、本周爆款帖、内容形态，数据来自本站自己的采集。")}</description>
    <language>zh-CN</language>
    <atom:link href="${escapeXml(`${config.siteUrl}/feed/x-people/weekly.xml`)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
