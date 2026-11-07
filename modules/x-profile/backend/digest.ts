// 每个被收录账号的「涨粉周报」订阅源：把 7 日一档的粉丝变化做成 RSS，读者可以在阅读器里订阅自己的
// 账号，不用登录、不用存邮箱。只读本模块自己的 x_follower_snapshots，不调任何外部接口。
import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { addDays, beijingAt, beijingDate } from "@aihot/contracts/time";

const DAY = 86_400_000;
/** 默认给最近八周：够看清趋势，又不至于让订阅源太长。 */
const DEFAULT_WEEKS = 8;

export interface DigestWeek {
  /** 这一周的周一（北京时间）。 */
  start: string;
  /** 这一周的周日。 */
  end: string;
  /** 周日那天（或之前最近一天）的粉丝数。 */
  followers: number;
  /** 相对上周同一天的净增。 */
  growth: number;
}

interface Point {
  day: string;
  followers: number;
}

/** 北京时间某一周的周一（以 YYYY-MM-DD 表示）。 */
export function weekStartOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = 周日
  return addDays(day, -((weekday + 6) % 7));
}

/** 某天的粉丝数：取这一天或之前最近一次快照。 */
function atOrBefore(points: readonly Point[], day: string): number | null {
  let found: number | null = null;
  for (const point of points) {
    if (point.day > day) break;
    found = point.followers;
  }
  return found;
}

/**
 * 从每日快照里切出最近几周的涨粉（只算已经过完的周）：某周结束时的粉丝数，减去上一周结束时的。
 * 缺基线或末点的那一周跳过，不做假数据。
 */
export function weeksFrom(points: readonly Point[], today: string, weeks = DEFAULT_WEEKS): DigestWeek[] {
  const out: DigestWeek[] = [];
  let start = addDays(weekStartOf(today), -7);
  for (let i = 0; i < weeks; i += 1) {
    const end = addDays(start, 6);
    const before = addDays(start, -1);
    const closed = atOrBefore(points, end);
    const baseline = atOrBefore(points, before);
    if (closed !== null && baseline !== null) out.push({ start, end, followers: closed, growth: closed - baseline });
    start = addDays(start, -7);
  }
  return out.reverse();
}

async function snapshotsOf(handle: string): Promise<{ screenName: string | null; points: Point[] }> {
  const rows = await sql<{ screen_name: string; captured_on: string; followers: string }[]>`
    SELECT screen_name, to_char(captured_on, 'YYYY-MM-DD') AS captured_on, followers::text AS followers
    FROM x_follower_snapshots WHERE handle = ${handle} ORDER BY captured_on`;
  return {
    screenName: rows.at(-1)?.screen_name ?? null,
    points: rows.map((row) => ({ day: row.captured_on, followers: Number(row.followers) })),
  };
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US"));

/** 一个账号的周报源；还没快照就返回 null（页面给「数据积累中」）。 */
export async function growthDigest(handle: string, today = beijingDate(new Date())): Promise<string | null> {
  const { screenName, points } = await snapshotsOf(handle);
  if (points.length === 0) return null;
  const weeks = weeksFrom(points, today);
  const label = screenName ? `@${screenName}` : `@${handle}`;
  const pageUrl = `${config.siteUrl}/x-people/${handle}`;
  const feedUrl = `${config.siteUrl}/feed/x/${handle}.xml`;
  const items = weeks
    .slice()
    .reverse()
    .map((week) => {
      const title = `${week.end} 那周：${signed(week.growth)} 粉，共 ${week.followers.toLocaleString("en-US")} 粉`;
      const description = `${label} 在 ${week.start} 至 ${week.end} 的七天里净增 ${signed(week.growth)} 粉，`
        + `到周日累计 ${week.followers.toLocaleString("en-US")} 粉。名次与每千曝光见 <a href="${escapeXml(pageUrl)}">画像页</a>。`;
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(pageUrl)}</link>
      <guid isPermaLink="false">${escapeXml(`${pageUrl}#${week.end}`)}</guid>
      <pubDate>${beijingAt(week.end, "12:00").toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${label} 的涨粉周报`)}</title>
    <link>${escapeXml(pageUrl)}</link>
    <description>${escapeXml(`X 涨粉榜：${label} 每周的粉丝变化，来自本站自己的采集快照。`)}</description>
    <language>zh-CN</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
