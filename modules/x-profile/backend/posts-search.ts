// 只读中文帖查询：读本站已采集的 X 帖（不是全站中文），支持全文检索、日期范围和游标翻页。
// 只覆盖 hot.jian.ing 收录的 X 账号；回复和转推默认没有采集，所以 replies 通常为空。
import { sql } from "@aihot/backend/db";
import { addDays, beijingMidnight, isValidDate } from "@aihot/contracts/time";

export interface XPostsFilters {
  from: string;
  to: string;
  q?: string | null;
  /** 只保留原创（排除回复）；回复用 replies 单独筛。 */
  originals: boolean;
  /** 只看回复；与 originals 互斥。 */
  replies: boolean;
  limit: number;
  cursor?: string | null;
}

export interface XPostsCoverage {
  scope: "tracked-accounts";
  source: string;
  accounts: number;
  note: string;
}

export interface XPostsPage {
  posts: Array<{
    id: string;
    text: string;
    created_at: string;
    author: { handle: string; followers: number | null };
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
    view_count: number;
    is_reply: boolean;
    is_retweet: boolean;
  }>;
  next_cursor: string | null;
  coverage: XPostsCoverage;
}

export interface XPostsCount {
  total: number;
  sampled: number;
  method: "local-corpus-exact";
  coverage: XPostsCoverage;
}

const COVERAGE_NOTE = "只覆盖 hot.jian.ing 收录的 X 账号（中文 AI 圈），不是全站中文；回复和转推默认未采集。";

function rangeOf(filters: Pick<XPostsFilters, "from" | "to">): { start: Date; end: Date } {
  if (!isValidDate(filters.from) || !isValidDate(filters.to)) throw new Error("from / to 必须是 YYYY-MM-DD");
  if (filters.to < filters.from) throw new Error("to 不能早于 from");
  const days = Math.round((beijingMidnight(filters.to).getTime() - beijingMidnight(filters.from).getTime()) / 86_400_000) + 1;
  if (days > 31) throw new Error("日期范围最多 31 天");
  return { start: beijingMidnight(filters.from), end: beijingMidnight(addDays(filters.to, 1)) };
}

/** 回复/原创的 SQL 条件；两者互斥由调用方校验。 */
function scopeCondition(filters: Pick<XPostsFilters, "replies" | "originals">) {
  if (filters.replies) return sql`AND a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb`;
  if (filters.originals) return sql`AND (a.x_post->'replyTo' IS NULL OR a.x_post->'replyTo' = 'null'::jsonb)`;
  return sql``;
}

/** 收录的 X 源：只取一次，用数组过滤 articles，避免 sources 关联把整段查询拖成 nested loop。 */
async function xSources(): Promise<Array<{ id: string; query: string | null }>> {
  return sql<Array<{ id: string; query: string | null }>>`
    SELECT id, config->>'query' AS query FROM sources WHERE kind = 'x_search' AND enabled`;
}

function baseCondition(filters: XPostsFilters, ids: string[]) {
  const { start, end } = rangeOf(filters);
  return sql`
    a.source_id = ANY(${ids}::text[]) AND a.x_post IS NOT NULL
    AND a.published_at >= ${start} AND a.published_at < ${end}
    AND coalesce(a.x_post->>'lang', a.language) = 'zh'
    ${scopeCondition(filters)}
  `;
}

function textMatch(q: string | null | undefined) {
  const text = (q ?? "").trim();
  return text ? sql`position(lower(${text}) in lower(coalesce(a.x_post->>'text', ''))) > 0` : sql`true`;
}

function textCondition(q: string | null | undefined) {
  return sql`AND ${textMatch(q)}`;
}

function handleFromQuery(query: string | null | undefined): string | null {
  return /^from:([A-Za-z0-9_]+)/i.exec(query ?? "")?.[1] ?? null;
}

export function encodeCursor(at: Date | string, id: string): string {
  return Buffer.from(JSON.stringify([new Date(at).toISOString(), id])).toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    if (!Array.isArray(value) || value.length !== 2 || !/^\d+$/.test(value[1]) || !Number.isFinite(Date.parse(value[0]))) return null;
    return { at: new Date(value[0]), id: value[1] };
  } catch {
    return null;
  }
}

async function coverageFor(filters: XPostsFilters, ids: string[]): Promise<XPostsCoverage> {
  const [row] = await sql<{ accounts: number }[]>`
    SELECT count(DISTINCT a.source_id)::int AS accounts
    FROM articles a
    WHERE ${baseCondition(filters, ids)}`;
  return { scope: "tracked-accounts", source: "hot.jian.ing 收录的 X 账号", accounts: row?.accounts ?? 0, note: COVERAGE_NOTE };
}

/** 一页最多 100 条；`next_cursor` 只在确实还有下一页时返回。 */
export async function searchXPosts(filters: XPostsFilters): Promise<XPostsPage> {
  const cursor = decodeCursor(filters.cursor);
  if (filters.cursor && !cursor) throw new Error("cursor 无效");
  const limit = Math.min(100, Math.max(1, filters.limit));
  const sources = await xSources();
  const ids = sources.map((source) => source.id);
  const [rows, coverage] = await Promise.all([
    sql<Array<{
      id: string; source_id: string; text: string | null; published_at: Date; tweet_id: string | null; author_handle: string | null;
      like_count: string; retweet_count: string; reply_count: string; quote_count: string; view_count: string; is_reply: boolean;
    }>>`
      SELECT a.id,
             a.source_id,
             a.x_post->>'text' AS text,
             a.published_at,
             a.x_post->>'tweetId' AS tweet_id,
             a.x_post->>'handle' AS author_handle,
             coalesce((a.raw->>'favorite')::bigint, 0)::text AS like_count,
             coalesce((a.raw->>'retweet')::bigint, 0)::text AS retweet_count,
             coalesce((a.raw->>'reply')::bigint, 0)::text AS reply_count,
             coalesce((a.raw->>'quote')::bigint, 0)::text AS quote_count,
             coalesce((a.raw->>'views')::bigint, 0)::text AS view_count,
             (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb) AS is_reply
      FROM articles a
      WHERE ${baseCondition(filters, ids)}
        ${textCondition(filters.q)}
        ${cursor ? sql`AND (a.published_at, coalesce((a.x_post->>'tweetId')::numeric, 0)) < (${cursor.at}, ${cursor.id}::numeric)` : sql``}
      ORDER BY a.published_at DESC, coalesce((a.x_post->>'tweetId')::numeric, 0) DESC
      LIMIT ${limit + 1}`,
    coverageFor(filters, ids),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const queryById = new Map(sources.map((source) => [source.id, source.query]));
  // Followers in one query for the page's handles: a correlated lookup here took the whole range down.
  const handles = [...new Set(page.map((row) => (row.author_handle ?? handleFromQuery(queryById.get(row.source_id)) ?? "").toLowerCase()).filter(Boolean))];
  const followerRows = handles.length
    ? await sql<{ key: string; followers: string }[]>`
        SELECT DISTINCT ON (lower(handle)) lower(handle) AS key, followers::text AS followers
        FROM x_follower_snapshots
        WHERE lower(handle) = ANY(${handles}::text[])
        ORDER BY lower(handle), captured_on DESC`
    : [];
  const followers = new Map(followerRows.map((row) => [row.key, Number(row.followers)]));
  const last = page[page.length - 1];
  return {
    posts: page.map((row) => {
      const handle = row.author_handle ?? handleFromQuery(queryById.get(row.source_id)) ?? "";
      return {
        id: row.tweet_id ?? row.id,
        text: row.text ?? "",
        created_at: row.published_at.toISOString(),
        author: { handle, followers: followers.get(handle.toLowerCase()) ?? null },
        like_count: Number(row.like_count),
        retweet_count: Number(row.retweet_count),
        reply_count: Number(row.reply_count),
        quote_count: Number(row.quote_count),
        view_count: Number(row.view_count),
        is_reply: row.is_reply,
        is_retweet: false,
      };
    }),
    next_cursor: hasMore && last ? encodeCursor(last.published_at, last.tweet_id ?? "0") : null,
    coverage,
  };
}

/** 同一组筛选下的精确计数：total = 命中 q 的条数，sampled = 该范围的中文原创/回复基线。 */
export async function countXPosts(filters: Omit<XPostsFilters, "limit" | "cursor">): Promise<XPostsCount> {
  const all: XPostsFilters = { ...filters, limit: 100, cursor: null };
  const sources = await xSources();
  const ids = sources.map((source) => source.id);
  const [rows, coverage] = await Promise.all([
    sql<{ total: number; sampled: number }[]>`
      SELECT count(*)::int AS sampled,
             count(*) FILTER (WHERE ${textMatch(filters.q)})::int AS total
      FROM articles a
      WHERE ${baseCondition(all, ids)}`,
    coverageFor(all, ids),
  ]);
  const row = rows[0];
  return { total: row?.total ?? 0, sampled: row?.sampled ?? 0, method: "local-corpus-exact", coverage };
}
