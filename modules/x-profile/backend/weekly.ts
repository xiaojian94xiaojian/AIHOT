// 公开周报：把「这周谁涨粉最多、哪条帖子最火、大家发的是什么形态」做成一张可以分享、也可以订阅的
// 周报页。数字全部来自本站自己的抓取（x_follower_snapshots + articles），不调模型，页面只读结果。
// 只报已经过完的周；缺基线的那一周直接说数据不足，不编趋势。
import { sql } from "@aihot/backend/db";
import { cachedByKey } from "@aihot/backend/lib/cache";
import { config } from "@aihot/backend/config";
import { SITE } from "@aihot/site";
import { addDays, beijingAt, beijingDate, isValidDate } from "@aihot/contracts/time";
import { escapeXml, weekStartOf } from "./digest.ts";
import { posts } from "./data.ts";
import type { XWeeklyResponse, XWeeklyRow, XWeeklyShape, XWeeklyViral } from "../types.ts";

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

/** 这一周里每个账号发了多少帖、带来多少浏览。 */
async function activityOf(startAt: Date, endAt: Date, handles: string[]): Promise<Map<string, { posts: number; views: number }>> {
  const out = new Map<string, { posts: number; views: number }>();
  if (handles.length === 0) return out;
  const rows = await sql<{ handle: string; posts: number; views: string }[]>`
    SELECT p.handle, count(*)::int AS posts, coalesce(sum(p.views), 0)::text AS views
    FROM (${posts()}) p
    WHERE p.published_at >= ${startAt} AND p.published_at < ${endAt} AND p.handle IN ${sql(handles)}
    GROUP BY 1`;
  for (const row of rows) out.set(row.handle, { posts: Number(row.posts), views: Number(row.views) });
  return out;
}

async function viralOf(startAt: Date, endAt: Date): Promise<XWeeklyViral[]> {
  const rows = await sql<{ handle: string; author: string | null; text: string | null; tweet_id: string; views: string; likes: string; published_at: Date }[]>`
    SELECT p.handle, p.author, p.text, p.tweet_id, p.views::text AS views, p.likes::text AS likes, p.published_at
    FROM (${posts()}) p
    WHERE p.published_at >= ${startAt} AND p.published_at < ${endAt}
      AND p.tweet_id IS NOT NULL AND p.views > 0
    ORDER BY p.views DESC
    LIMIT ${VIRAL}`;
  return rows.map((row) => ({
    handle: row.handle,
    author: row.author,
    text: row.text ?? "",
    url: `https://x.com/${row.handle}/status/${row.tweet_id}`,
    views: Number(row.views),
    likes: Number(row.likes),
    at: new Date(row.published_at).toISOString(),
  }));
}

/** 这一周的内容形态：纯文字、带图/视频、引用、回复，各占多少。 */
async function shapeOf(startAt: Date, endAt: Date): Promise<{ shape: XWeeklyShape[]; summary: { accounts: number; posts: number; views: number; mediaPct: number } }> {
  const [row] = await sql<{ text: number; media: number; quote: number; reply: number; total: number; views: string; accounts: number }[]>`
    SELECT count(*) FILTER (WHERE media_count = 0 AND NOT is_quote AND NOT is_reply)::int AS text,
           count(*) FILTER (WHERE media_count > 0)::int AS media,
           count(*) FILTER (WHERE is_quote)::int AS quote,
           count(*) FILTER (WHERE is_reply)::int AS reply,
           count(*)::int AS total, coalesce(sum(p.views), 0)::text AS views,
           count(DISTINCT p.handle)::int AS accounts
    FROM (${posts()}) p
    WHERE p.published_at >= ${startAt} AND p.published_at < ${endAt}`;
  const total = row?.total ?? 0;
  const share = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  const shape = [
    { key: "text", label: "纯文字", posts: row?.text ?? 0, share: share(row?.text ?? 0) },
    { key: "media", label: "带图/视频", posts: row?.media ?? 0, share: share(row?.media ?? 0) },
    { key: "quote", label: "引用", posts: row?.quote ?? 0, share: share(row?.quote ?? 0) },
    { key: "reply", label: "回复", posts: row?.reply ?? 0, share: share(row?.reply ?? 0) },
  ];
  return {
    shape,
    summary: {
      accounts: row?.accounts ?? 0,
      posts: total,
      views: Number(row?.views ?? 0),
      mediaPct: total > 0 ? Math.round(((row?.media ?? 0) / total) * 1000) / 10 : 0,
    },
  };
}

async function build(start: string): Promise<XWeeklyResponse> {
  const end = addDays(start, 6);
  const startAt = beijingAt(start, "00:00");
  const endAt = beijingAt(addDays(end, 1), "00:00");
  const growth = await growthOf(start, end);
  const ranked = growth
    .map((row) => {
      const spanDays = Math.max(1, Math.round((Date.parse(row.end_on) - Date.parse(row.baseline_on)) / 86_400_000));
      return { row, growth: Math.round(((Number(row.followers) - Number(row.baseline)) * 7) / spanDays) };
    })
    .filter((item) => item.growth > 0)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, TOP);
  const [activity, viral, shape] = await Promise.all([
    activityOf(startAt, endAt, ranked.map((item) => item.row.handle)),
    viralOf(startAt, endAt),
    shapeOf(startAt, endAt),
  ]);
  const rows: XWeeklyRow[] = ranked.map(({ row, growth: value }, index) => {
    const extra = activity.get(row.handle) ?? { posts: 0, views: 0 };
    return {
      rank: index + 1,
      handle: row.handle,
      name: row.name,
      avatarUrl: row.avatar_url,
      followers: Number(row.followers),
      growth: value,
      posts: extra.posts,
      views: extra.views,
      perK: extra.views > 0 ? Math.round((value / extra.views) * 1000 * 10) / 10 : null,
    };
  });
  return {
    week: { start, end },
    weeks: recentWeeks(),
    rows,
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
