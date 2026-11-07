// 采集成本看板：每天记一行 SocialData 的账（调用数、空抓数、返回对象数、花费、覆盖源数）。
//
// 为什么要有：频率分档、热点提速这些改动到底有没有省钱，只能靠每天的数字看，不能靠估。
// 数据来自 receipts（service = socialdata），按北京时间切天；今天这一行是实时算的，不落库。
import { sql } from "@aihot/backend/db";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";

export interface XCollectStat {
  /** 北京时间的那一天，YYYY-MM-DD。 */
  day: string;
  calls: number;
  emptyCalls: number;
  /** 返回的推文对象总数（按对象计费）。 */
  objects: number;
  usd: number;
  /** 当天被调用过的不同源（含分片查询）。 */
  sources: number;
  /** 当天结束时启用中的 X 源数。 */
  enabledSources: number;
  /** true 表示这行是今天实时算的，还没落库。 */
  live?: boolean;
}

const num = (value: string | number | null | undefined) => (value === null || value === undefined ? 0 : Number(value));

/** 某一天的账（不落库）：receipts 里 socialdata 的调用、空抓、对象数与花费。 */
export async function collectStatsFor(day: string): Promise<XCollectStat> {
  const [row] = await sql<{ calls: number; empty_calls: number; objects: number; usd: string | null; sources: number }[]>`
    WITH r AS (
      SELECT subject,
             coalesce(jsonb_array_length(response->'tweets'), 0) AS tweets,
             coalesce(cost, 0) AS cost
      FROM receipts
      WHERE service = 'socialdata'
        AND (created_at AT TIME ZONE ${BEIJING_TIMEZONE})::date = ${day}::date
    )
    SELECT count(*)::int AS calls,
           count(*) FILTER (WHERE tweets = 0)::int AS empty_calls,
           coalesce(sum(tweets), 0)::int AS objects,
           round(sum(cost)::numeric, 4)::text AS usd,
           count(DISTINCT subject)::int AS sources
    FROM r`;
  const [enabled] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sources WHERE kind = 'x_search' AND enabled`;
  return {
    day,
    calls: row?.calls ?? 0,
    emptyCalls: row?.empty_calls ?? 0,
    objects: row?.objects ?? 0,
    usd: num(row?.usd),
    sources: row?.sources ?? 0,
    enabledSources: enabled?.n ?? 0,
  };
}

/** 把某一天（默认昨天）的账写进表；重复跑覆盖同一天。 */
export async function snapshotCollectStats(day?: string): Promise<XCollectStat> {
  const target = day ?? beijingYesterday();
  const stat = await collectStatsFor(target);
  await sql`
    INSERT INTO x_collect_stats (day, calls, empty_calls, objects, usd, sources, enabled_sources, updated_at)
    VALUES (${stat.day}::date, ${stat.calls}, ${stat.emptyCalls}, ${stat.objects}, ${stat.usd}, ${stat.sources}, ${stat.enabledSources}, now())
    ON CONFLICT (day) DO UPDATE SET
      calls = excluded.calls, empty_calls = excluded.empty_calls, objects = excluded.objects,
      usd = excluded.usd, sources = excluded.sources, enabled_sources = excluded.enabled_sources, updated_at = now()`;
  return { ...stat, live: false };
}

/** 最近这些天的账，新的在前；今天那行没有落库时，用实时数字补上。 */
export async function recentCollectStats(days = 14): Promise<XCollectStat[]> {
  const rows = await sql<{ day: Date; calls: number; empty_calls: number; objects: number; usd: string; sources: number; enabled_sources: number }[]>`
    SELECT day, calls, empty_calls, objects, usd::text AS usd, sources, enabled_sources
    FROM x_collect_stats ORDER BY day DESC LIMIT ${days}`;
  const stored: XCollectStat[] = rows.map((row) => ({
    day: new Date(row.day).toISOString().slice(0, 10),
    calls: row.calls,
    emptyCalls: row.empty_calls,
    objects: row.objects,
    usd: num(row.usd),
    sources: row.sources,
    enabledSources: row.enabled_sources,
  }));
  const today = beijingToday();
  if (!stored.some((row) => row.day === today)) stored.unshift({ ...(await collectStatsFor(today)), live: true });
  return stored;
}

/** 北京时间今天（YYYY-MM-DD）：用同一套时区换算，别在页面里手写 +08:00。 */
export function beijingToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BEIJING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function beijingYesterday(now = new Date()): string {
  return beijingToday(new Date(now.getTime() - 86_400_000));
}

/** 空抓占比（百分比，保留一位）。 */
export function emptyRate(stat: Pick<XCollectStat, "calls" | "emptyCalls">): number {
  return stat.calls === 0 ? 0 : Math.round((stat.emptyCalls / stat.calls) * 1000) / 10;
}
