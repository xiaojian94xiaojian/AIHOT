// 算法视角：拿 X 公开的 For You 权重，用本站自己的数据回测几个常见说法。
//
// 只说我们量得到的东西：快照是采集那一刻的值，所以「48 小时窗口」「负向信号」这类
// 需要逐次曝光的数据，这里明确写「测不了」，不硬凑结论。
import { cached } from "@aihot/backend/lib/cache";
import { sql } from "@aihot/backend/db";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";

export interface DecayRow {
  /** 1 = 当天第一条，4 = 第 4 条及以后。 */
  position: number;
  posts: number;
  /** 相对该账号浏览中位的倍数。 */
  ratio: number;
}

export interface AlgorithmCheck {
  key: "decay" | "link" | "discuss";
  claim: string;
  /** 我们的数据给出的判断。 */
  verdict: "成立" | "不成立" | "看不清";
  /** 一句结论。 */
  summary: string;
  /** 支撑数字，按页面需要展示。 */
  rows: Array<{ label: string; value: string; hint?: string }>;
}

export interface AlgorithmResponse {
  checks: AlgorithmCheck[];
  generatedAt: string;
}

const num = (value: string | number | null | undefined) => (value === null || value === undefined ? 0 : Number(value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** 同日第 N 条：1 是当天第一条，4 是第 4 条及以后；只算原创、只看有 20 条以上记录的账号。 */
async function decayRows(): Promise<DecayRow[]> {
  const rows = await sql<{ position: number; posts: number; ratio: string }[]>`
    WITH p AS (
      SELECT a.source_id,
             coalesce((a.raw->>'views')::bigint, 0) AS views,
             row_number() OVER (
               PARTITION BY a.source_id, (a.published_at AT TIME ZONE )::date
               ORDER BY a.published_at
             ) AS seq
      FROM articles a
      WHERE a.source_id LIKE 'x-account-%'
        AND a.published_at > now() - interval '120 days'
        AND NOT (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb)
    ), acct AS (
      SELECT source_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS med
      FROM p GROUP BY 1 HAVING count(*) >= 20
    )
    SELECT least(p.seq, 4)::int AS position,
           count(*)::int AS posts,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY p.views::numeric / nullif(acct.med, 0))::text AS ratio
    FROM p JOIN acct USING (source_id)
    GROUP BY 1 ORDER BY 1`;
  return rows.map((row) => ({ position: row.position, posts: row.posts, ratio: round2(num(row.ratio)) }));
}

/** 带站外链接的原创帖，浏览相对账号中位的倍数。 */
async function linkRows(): Promise<Array<{ hasLink: boolean; posts: number; ratio: number }>> {
  const rows = await sql<{ has_link: boolean; posts: number; ratio: string }[]>`
    WITH p AS (
      SELECT a.source_id,
             coalesce((a.raw->>'views')::bigint, 0) AS views,
             (coalesce(a.x_post->>'text', '') ~* 'https?://(?!x\.com|twitter\.com)') AS has_link
      FROM articles a
      WHERE a.source_id LIKE 'x-account-%'
        AND a.published_at > now() - interval '120 days'
        AND NOT (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb)
    ), acct AS (
      SELECT source_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS med
      FROM p GROUP BY 1 HAVING count(*) >= 20
    )
    SELECT p.has_link, count(*)::int AS posts,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY p.views::numeric / nullif(acct.med, 0))::text AS ratio
    FROM p JOIN acct USING (source_id) GROUP BY 1`;
  return rows.map((row) => ({ hasLink: row.has_link, posts: row.posts, ratio: round2(num(row.ratio)) }));
}

/** 每千曝光的回复+引用，和 30 日涨粉百分比的相关性（只算曝光过万的账号）。 */
async function discussGrowth(): Promise<{ accounts: number; corr: number; high: { accounts: number; median: number }; low: { accounts: number; median: number } }> {
  const [row] = await sql<{ n: number; corr: string | null; high_n: number; high_med: string | null; low_n: number; low_med: string | null }[]>`
    WITH p AS (
      SELECT a.source_id,
             coalesce((a.raw->>'views')::bigint, 0) AS views,
             coalesce((a.raw->>'reply')::bigint, 0) AS replies,
             coalesce((a.raw->>'quote')::bigint, 0) AS quotes,
             lower(a.x_post->>'handle') AS handle
      FROM articles a
      WHERE a.source_id LIKE 'x-account-%' AND a.published_at > now() - interval '120 days'
        AND NOT (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb)
    ), acct AS (
      SELECT source_id, max(handle) AS handle,
             1000.0 * sum(replies + quotes) / nullif(sum(views), 0) AS discuss_k
      FROM p GROUP BY 1 HAVING sum(views) >= 10000
    ), g AS (
      SELECT lower(handle) AS handle,
             max(followers) FILTER (WHERE captured_on = (SELECT max(captured_on) FROM x_follower_snapshots)) AS now_f,
             max(followers) FILTER (WHERE captured_on <= (SELECT max(captured_on) FROM x_follower_snapshots) - 30) AS then_f
      FROM x_follower_snapshots GROUP BY 1
    ), j AS (
      SELECT acct.discuss_k, 100.0 * (g.now_f - g.then_f) / g.then_f AS growth_pct
      FROM acct JOIN g USING (handle) WHERE g.then_f > 0 AND g.now_f IS NOT NULL
    )
    SELECT count(*)::int AS n,
           corr(discuss_k, growth_pct)::text AS corr,
           count(*) FILTER (WHERE discuss_k >= 2)::int AS high_n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY growth_pct) FILTER (WHERE discuss_k >= 2)::text AS high_med,
           count(*) FILTER (WHERE discuss_k < 2)::int AS low_n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY growth_pct) FILTER (WHERE discuss_k < 2)::text AS low_med
    FROM j`;
  return {
    accounts: row?.n ?? 0,
    corr: round2(num(row?.corr)),
    high: { accounts: row?.high_n ?? 0, median: round2(num(row?.high_med)) },
    low: { accounts: row?.low_n ?? 0, median: round2(num(row?.low_med)) },
  };
}

/** 「同日连发会衰减」：第 2 条以后相对第一条掉多少算成立；掉不到 10% 就说不成立。 */
export function decayVerdict(rows: DecayRow[]): { verdict: AlgorithmCheck["verdict"]; summary: string } {
  const first = rows.find((row) => row.position === 1)?.ratio;
  const later = rows.filter((row) => row.position > 1);
  if (!first || later.length === 0) return { verdict: "看不清", summary: "样本还不够，先不下结论。" };
  const worst = Math.min(...later.map((row) => row.ratio));
  if (worst < first * 0.9) {
    return { verdict: "成立", summary: `当天的帖子里，第 2 条以后最低只有第一条的 ${Math.round((worst / first) * 100)}%，连发确实吃亏。` };
  }
  return {
    verdict: "不成立",
    summary: `当天的第 2、3、4 条，浏览都还在第一条的 ${Math.round((worst / first) * 100)}% 以上——按账号看，没有「连发就被压」这回事。`,
  };
}

/** 「外链会被限流」：外链帖的相对浏览掉到 0.9 以下才算成立。 */
export function linkVerdict(rows: Array<{ hasLink: boolean; ratio: number }>): { verdict: AlgorithmCheck["verdict"]; summary: string } {
  const withLink = rows.find((row) => row.hasLink);
  const without = rows.find((row) => !row.hasLink);
  if (!withLink || !without) return { verdict: "看不清", summary: "带链接的样本太少，先不下结论。" };
  if (withLink.ratio < without.ratio * 0.9) {
    return { verdict: "成立", summary: `带站外链接的帖子浏览是账号中位的 ${withLink.ratio.toFixed(2)} 倍，不带的 ${without.ratio.toFixed(2)} 倍——外链确实吃亏。` };
  }
  return {
    verdict: "不成立",
    summary: `带站外链接 ${withLink.ratio.toFixed(2)} 倍、不带 ${without.ratio.toFixed(2)} 倍，几乎一样——至少在我们的样本里，放链接没有明显惩罚。`,
  };
}

/** 「讨论多的账号涨粉快」：相关系数低于 0.2 就算看不清。 */
export function discussVerdict(stats: { accounts: number; corr: number; high: { accounts: number; median: number }; low: { accounts: number; median: number } }): {
  verdict: AlgorithmCheck["verdict"];
  summary: string;
} {
  if (stats.accounts < 30) return { verdict: "看不清", summary: "能算的账号太少，先不下结论。" };
  if (Math.abs(stats.corr) < 0.2) {
    return {
      verdict: "看不清",
      summary: `讨论率和涨粉的相关只有 ${stats.corr}（${stats.accounts} 个账号）：讨论多的组涨 ${stats.high.median}%、少的组 ${stats.low.median}%，差得不多——回复、引用在排序里值钱，但不等于涨粉捷径。`,
    };
  }
  return {
    verdict: "成立",
    summary: `讨论率和涨粉的相关是 ${stats.corr}，高的组涨 ${stats.high.median}%、低的组 ${stats.low.median}%。`,
  };
}

async function queryChecks(): Promise<AlgorithmResponse> {
  const [decay, links, discuss] = await Promise.all([decayRows(), linkRows(), discussGrowth()]);
  const decayV = decayVerdict(decay);
  const linkV = linkVerdict(links);
  const discussV = discussVerdict(discuss);
  return {
    checks: [
      {
        key: "decay",
        claim: "同一天连发，后几条会被算法压",
        verdict: decayV.verdict,
        summary: decayV.summary,
        rows: decay.map((row) => ({
          label: row.position === 4 ? "第 4 条起" : `第 ${row.position} 条`,
          value: `×${row.ratio.toFixed(2)}`,
          hint: `${row.posts.toLocaleString("en-US")} 条`,
        })),
      },
      {
        key: "link",
        claim: "帖子里放站外链接会被限流",
        verdict: linkV.verdict,
        summary: linkV.summary,
        rows: links.map((row) => ({
          label: row.hasLink ? "带站外链接" : "不带链接",
          value: `×${row.ratio.toFixed(2)}`,
          hint: `${row.posts.toLocaleString("en-US")} 条`,
        })),
      },
      {
        key: "discuss",
        claim: "回复、引用多（讨论率高）的账号涨粉更快",
        verdict: discussV.verdict,
        summary: discussV.summary,
        rows: [
          { label: "讨论率 ≥2 / 千曝光", value: `${discuss.high.median}%`, hint: `${discuss.high.accounts} 个账号的 30 日涨粉中位` },
          { label: "讨论率 <2 / 千曝光", value: `${discuss.low.median}%`, hint: `${discuss.low.accounts} 个账号的 30 日涨粉中位` },
          { label: "相关系数", value: String(discuss.corr), hint: `${discuss.accounts} 个账号（曝光过万）` },
        ],
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export const algorithmPage = cached(queryChecks, { freshMs: 600_000, maxStaleMs: 3_600_000 });
