// X 粉丝快照与涨粉榜。
//
// 粉丝数不在自己的表里：它只出现在 SocialData 的回执（receipts.response 的每条推文的 user.followers_count）。
// 回执响应保留 45 天（embedding 14 天），所以这里把每次抓到的粉丝数按天记进本模块的表，快照永久保留，不受回执清理影响：
//   扫描（定时任务）从回执里读新出现的推文 → 每个账号每天一行，取当天最后一次；
//   读取（页面接口）按 7 天 / 30 天两种窗口找最近一次和窗口外最近的一次，算涨粉。
// 快照时间跟着抓取走，不是每天定点：不发帖的账号就没有新快照，读取时会被“最近一次在窗口内”滤掉。
import { sql } from "@aihot/backend/db";
import { freshnessOf } from "./freshness.ts";
import { cachedByKey } from "@aihot/backend/lib/cache";
import { beijingDate, BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { regionOf } from "./classify.ts";
import type { Region, XGrowthPrevRow, XGrowthResponse, XGrowthRow, XPersonGrowth, XPost } from "../types.ts";

/** 扫描游标：处理到哪一张回执（自增 id）。写在 settings 里。 */
const CURSOR_KEY = "x-followers.scan";
/**
 * 回看窗口：回执先建后完成，事务提交顺序可能让「更早收到」的回执晚落库，id 又被游标越过；
 * 每轮先按 received_at 把最近十分钟收到的回执重读一遍，重复写入是幂等的（同一天取更晚的一次）。
 */
const REWIND_MS = 10 * 60_000;
/** 一次取多少张回执；24 小时约 900 张，回填时每批几十毫秒。 */
const BATCH = 400;
/** 一次扫描最多占多久；没追完的下一轮接着来（游标已推进，任务可以重入）。 */
const RUN_BUDGET_MS = 20_000;
/** 只回看最近这些天的回执：更早的通常已经被回执清理删掉了，再往前扫只是空转。 */
const LOOKBACK_DAYS = 32;
/** 写进快照的账号形态：X 的 handle。 */
const HANDLE = /^[a-z0-9_]{1,30}$/;
/** 涨粉榜的窗口，单位和天。 */
export const GROWTH_WINDOWS = [7, 30] as const;
/**
 * 基线最多比窗口早几天。账号不是每天都有快照（不发帖就没有），窗口 7 天时最多接受 14 天前的基线；
 * 再早的基线说明这个账号很久没被抓到，拿来折算会把几个月的变化压成一周，宁可不排。
 */
const MAX_BASELINE_LAG_DAYS = 7;

interface ReceiptRow {
  id: number;
  received_at: Date;
  response: unknown;
}

/** SocialData 搜索回执里本模块要用到的部分（完整结构见 providers/socialdata.ts 的 SdTweet）。 */
interface ReceiptTweet {
  user?: {
    screen_name?: string;
    name?: string;
    profile_image_url_https?: string;
    followers_count?: number;
  };
}

interface SnapshotRow {
  handle: string;
  captured_on: string;
  screen_name: string;
  name: string | null;
  avatar_url: string | null;
  followers: number;
  captured_at: Date;
  receipt_id: number;
}

async function readCursor(): Promise<number | null> {
  const [row] = await sql<{ value: Record<string, unknown> }[]>`SELECT value FROM settings WHERE key = ${CURSOR_KEY}`;
  const id = Number(row?.value?.receiptId ?? row?.value?.id);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

async function saveCursor(receiptId: number): Promise<void> {
  await sql`
    INSERT INTO settings (key, value, updated_by) VALUES (${CURSOR_KEY}, ${sql.json({ receiptId, at: new Date().toISOString() })}, 'x-profile')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** 第一次扫描从哪里开始：回执里还在的最早一张，避免从头扫过已经删掉的历史。 */
async function firstCursor(): Promise<number> {
  const [row] = await sql<{ id: number | null }[]>`
    SELECT min(id) AS id FROM receipts
    WHERE service = 'socialdata' AND purpose = 'source_fetch' AND status IN ('received', 'completed')
      AND received_at > now() - make_interval(days => ${LOOKBACK_DAYS})`;
  return row?.id ? Number(row.id) - 1 : 0;
}

/** 一批回执里的账号快照：一个账号一天只留最后抓到的那次。 */
export function snapshotsOf(rows: ReceiptRow[]): SnapshotRow[] {
  const byKey = new Map<string, SnapshotRow>();
  for (const row of rows) {
    const tweets = (row.response as { tweets?: ReceiptTweet[] } | null)?.tweets;
    if (!Array.isArray(tweets)) continue;
    const capturedAt = new Date(row.received_at);
    if (!Number.isFinite(capturedAt.getTime())) continue;
    const capturedOn = beijingDate(capturedAt);
    for (const tweet of tweets) {
      const user = tweet?.user;
      if (!user) continue;
      const screenName = typeof user.screen_name === "string" ? user.screen_name.trim() : "";
      const handle = screenName.toLowerCase();
      const followers = Number(user.followers_count);
      if (!HANDLE.test(handle) || !Number.isFinite(followers) || followers < 0 || !Number.isSafeInteger(followers)) continue;
      const key = `${handle}|${capturedOn}`;
      const seen = byKey.get(key);
      // 同一批里同一账号可能出现在多条推文里：留时间最晚的那次。
      if (seen && (seen.captured_at.getTime() > capturedAt.getTime() || (seen.captured_at.getTime() === capturedAt.getTime() && seen.receipt_id > row.id))) continue;
      byKey.set(key, {
        handle,
        captured_on: capturedOn,
        screen_name: screenName,
        name: typeof user.name === "string" ? user.name : null,
        avatar_url: typeof user.profile_image_url_https === "string" ? user.profile_image_url_https : null,
        followers,
        captured_at: capturedAt,
        receipt_id: row.id,
      });
    }
  }
  return [...byKey.values()];
}

/** 写快照：同一天已经有更晚的一次时不动它，回填和增量可以任意顺序重放。 */
async function storeSnapshots(rows: SnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let stored = 0;
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000);
    const result = await sql`
      INSERT INTO x_follower_snapshots ${sql(chunk, "handle", "captured_on", "screen_name", "name", "avatar_url", "followers", "captured_at", "receipt_id")}
      ON CONFLICT (handle, captured_on) DO UPDATE SET
        screen_name = EXCLUDED.screen_name,
        name = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url,
        followers = EXCLUDED.followers,
        captured_at = EXCLUDED.captured_at,
        receipt_id = EXCLUDED.receipt_id
      WHERE EXCLUDED.captured_at > x_follower_snapshots.captured_at`;
    stored += result.count;
  }
  return stored;
}

/**
 * 定时扫描：从回执里把新出现的粉丝数记成当天的快照。按 id 顺序推进，处理过的回执不再读；
 * 每轮先按收到时刻回看十分钟，补上晚落库的回执。一次最多花 RUN_BUDGET_MS，没追完的下一轮接着来。
 */
export async function scanFollowerSnapshots(opts: { budgetMs?: number } = {}): Promise<{ receipts: number; snapshots: number; caughtUp: boolean }> {
  const deadline = Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const stored = await readCursor();
  let cursor = stored ?? (await firstCursor());
  const rewindFrom = new Date(Date.now() - REWIND_MS);
  let rewind = true;
  let receipts = 0;
  let snapshots = 0;
  for (;;) {
    // 第一批按收到时刻回看（晚落库的回执 id 可能已被越过）；之后严格按 id 往后推进。
    const isRewind = rewind;
    rewind = false;
    const rows = isRewind
      ? await sql<ReceiptRow[]>`
          SELECT id, received_at, response FROM receipts
          WHERE received_at > ${rewindFrom} AND received_at <= now()
            AND service = 'socialdata' AND purpose = 'source_fetch'
            AND status IN ('received', 'completed') AND received_at IS NOT NULL
            AND response IS NOT NULL AND jsonb_typeof(response->'tweets') = 'array'
          ORDER BY id LIMIT ${BATCH}`
      : await sql<ReceiptRow[]>`
          SELECT id, received_at, response FROM receipts
          WHERE id > ${cursor}
            AND service = 'socialdata' AND purpose = 'source_fetch'
            AND status IN ('received', 'completed') AND received_at IS NOT NULL
            AND response IS NOT NULL AND jsonb_typeof(response->'tweets') = 'array'
          ORDER BY id LIMIT ${BATCH}`;
    if (rows.length === 0) {
      // 回看窗口里没有新回执不算结束，还要按 id 继续追。
      if (isRewind) continue;
      // 没有新回执：第一次扫描也在这里记下游标，下一轮从同一位置继续。
      if (stored === null && receipts === 0) await saveCursor(cursor);
      return { receipts, snapshots, caughtUp: true };
    }
    snapshots += await storeSnapshots(snapshotsOf(rows));
    const lastId = Number(rows[rows.length - 1]!.id);
    // 回看批里可能只有 id 已越过的晚落库回执：游标不能因此回退，否则每轮重放这段。
    cursor = isRewind ? Math.max(cursor, lastId) : lastId;
    receipts += rows.length;
    await saveCursor(cursor);
    if (Date.now() >= deadline) return { receipts, snapshots, caughtUp: false };
  }
}

/** 一个账号在一个窗口里的原始数字；排行和效率都从它来。 */
interface GrowthAccount {
  handle: string;
  screenName: string;
  name: string | null;
  avatarUrl: string | null;
  followers: number;
  baseline: number;
  growth: number;
  growthPct: number;
  spanDays: number;
  /** 这次涨粉实际跨的日期（基线那天到最近一次快照那天），用来数区间内的帖子。 */
  fromOn: string;
  toOn: string;
}

interface GrowthBaseRow {
  handle: string;
  screen_name: string;
  name: string | null;
  avatar_url: string | null;
  followers: string;
  captured_on: string;
  base_followers: string;
  base_on: string;
  span_days: number;
}

/**
 * 某一天看到的榜：每个账号取最近一次快照作为现在的粉丝数，取窗口之外最近的一次作基线；
 * 两点跨了 span_days 天，涨粉按窗口长度折算（span_days 等于窗口时不折算）。
 */
async function growthAccounts(window: number, today: string): Promise<GrowthAccount[]> {
  const lag = window + MAX_BASELINE_LAG_DAYS;
  const rows = await sql<GrowthBaseRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (handle) handle, screen_name, name, avatar_url, followers, captured_on
      FROM x_follower_snapshots
      WHERE captured_on >= ${today}::date - ${window}::int AND captured_on <= ${today}::date
      ORDER BY handle, captured_on DESC
    )
    SELECT l.handle, l.screen_name, l.name, l.avatar_url, l.followers::text AS followers,
           to_char(l.captured_on, 'YYYY-MM-DD') AS captured_on,
           b.followers::text AS base_followers, to_char(b.captured_on, 'YYYY-MM-DD') AS base_on,
           (l.captured_on - b.captured_on) AS span_days
    FROM latest l
    JOIN LATERAL (
      SELECT captured_on, followers FROM x_follower_snapshots s
      WHERE s.handle = l.handle AND s.captured_on <= l.captured_on - ${window}::int
      ORDER BY s.captured_on DESC LIMIT 1
    ) b ON true
    WHERE (l.captured_on - b.captured_on) <= ${lag}::int`;
  return rows.map((row) => {
    const followers = Number(row.followers);
    const baseline = Number(row.base_followers);
    const spanDays = Number(row.span_days);
    // 基线比窗口早时把这段涨粉按窗口长度折算，避免把 10 天的增长当成 7 天的。
    const growth = Math.round(((followers - baseline) * window) / Math.max(1, spanDays));
    const growthPct = baseline > 0 ? Math.round((growth / baseline) * 1000) / 10 : 0;
    return {
      handle: row.handle,
      screenName: row.screen_name,
      name: row.name,
      avatarUrl: row.avatar_url,
      followers,
      baseline,
      growth,
      growthPct,
      spanDays,
      fromOn: row.base_on,
      toOn: row.captured_on,
    };
  });
}

/** 全站名次：按给定字段从大到小，同分时粉丝多的在前，再按 handle 稳定。 */
function ranksOf(accounts: GrowthAccount[], key: "growth" | "growthPct"): Map<string, number> {
  const sorted = [...accounts].sort((a, b) => b[key] - a[key] || b.followers - a.followers || (a.handle < b.handle ? -1 : 1));
  return new Map(sorted.map((account, index) => [account.handle, index + 1]));
}

/** handle → 它的 source id（一个账号可能有历史重复源）。 */
async function sourceIdsOf(handles: readonly string[]): Promise<Map<string, string[]>> {  const ids = new Map<string, string[]>();
  if (handles.length === 0) return ids;
  const wanted = new Set(handles);
  const sources = await sql<{ id: string; handle: string | null }[]>`
    SELECT id, lower(substring(config->>'query' from '^from:([A-Za-z0-9_]+)')) AS handle
    FROM sources WHERE kind = 'x_search'`;
  for (const source of sources) {
    const handle = source.handle?.toLowerCase();
    if (!handle || !wanted.has(handle)) continue;
    const list = ids.get(handle) ?? [];
    list.push(source.id);
    ids.set(handle, list);
  }
  return ids;
}

/** 一个账号的 source id；报告和画像页取它自己的帖子时用。 */
export async function sourceIdsOfHandle(handle: string): Promise<string[]> {
  return (await sourceIdsOf([handle.toLowerCase()])).get(handle.toLowerCase()) ?? [];
}

/**
 * 每个账号属于中文区还是英文区：和博主画像同一口径，用最近 120 天帖子的语言占比。
 * 账号 id 从 sources 的查询里认（x-account-<handle> 是惯例，但历史重复源和改名让它不总是对得上），
 * 所以按 query 反查，再把这些 id 的帖子一次聚合。
 */
async function regionsOf(ids: Map<string, string[]>): Promise<Map<string, Region>> {
  const regions = new Map<string, Region>();
  const all = [...ids.values()].flat();
  if (all.length === 0) return regions;
  const counts = await sql<{ source_id: string; zh: number; en: number }[]>`
    SELECT source_id,
           count(*) FILTER (WHERE coalesce(language, x_post->>'lang') LIKE 'zh%')::int AS zh,
           count(*) FILTER (WHERE coalesce(language, x_post->>'lang') LIKE 'en%')::int AS en
    FROM articles
    WHERE source_id = ANY(${all}::text[]) AND published_at > now() - interval '120 days'
    GROUP BY source_id`;
  const byId = new Map(counts.map((row) => [row.source_id, row]));
  for (const [handle, sourceIds] of ids) {
    let zh = 0;
    let en = 0;
    for (const id of sourceIds) {
      zh += byId.get(id)?.zh ?? 0;
      en += byId.get(id)?.en ?? 0;
    }
    const known = zh + en;
    if (known > 0) regions.set(handle, regionOf((zh / known) * 100, (en / known) * 100));
  }
  return regions;
}

/** 涨粉区间里的发帖与浏览：效率（每帖、每千曝光）和“本期没发帖”的提示都靠它。 */
async function activityOf(accounts: GrowthAccount[], ids: Map<string, string[]>): Promise<Map<string, { posts: number; views: number }>> {
  const activity = new Map<string, { posts: number; views: number }>();
  const ranges: Array<{ source_id: string; from_on: string; to_on: string }> = [];
  for (const account of accounts) {
    for (const id of ids.get(account.handle) ?? []) ranges.push({ source_id: id, from_on: account.fromOn, to_on: account.toOn });
  }
  if (ranges.length === 0) return activity;
  const rows = await sql<{ source_id: string; posts: number; views: string }[]>`
    WITH w AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(ranges)}::jsonb) AS x(source_id text, from_on date, to_on date)
    )
    SELECT w.source_id, count(a.id)::int AS posts, coalesce(sum((a.raw->>'views')::bigint), 0)::text AS views
    FROM w
    JOIN articles a ON a.source_id = w.source_id
      AND (a.published_at AT TIME ZONE ${BEIJING_TIMEZONE})::date BETWEEN w.from_on AND w.to_on
    GROUP BY w.source_id`;
  const byId = new Map(rows.map((row) => [row.source_id, row]));
  for (const account of accounts) {
    let posts = 0;
    let views = 0;
    for (const id of ids.get(account.handle) ?? []) {
      posts += byId.get(id)?.posts ?? 0;
      views += Number(byId.get(id)?.views ?? 0);
    }
    activity.set(account.handle, { posts, views });
  }
  return activity;
}

/**
 * 归因提示：本期没发帖（涨粉只能来自外部）、发帖太少（不足以归因）、
 * 涨粉远高于曝光或一周内涨跌幅超过 30%（可能买粉、抽奖或外部事件，值得核对）。
 */
function signalOf(growth: number, growthPct: number, posts: number, views: number): XGrowthRow["signal"] {
  if (posts === 0) return "quiet";
  if (posts < 3) return "thin";
  if (growth >= 1000 && views > 0 && views < growth * 5) return "caution";
  // 一周涨或跌超过三成：正常的内容账号很少这样，先让人核一下再当榜样。
  if (Math.abs(growthPct) >= 30) return "caution";
  return null;
}

/** 一个账号在本窗口里的地区、发帖与浏览；本周榜和上周重排都要它。 */
interface BoardExtra {
  region: Region;
  posts: number;
  views: number;
}

async function extrasOf(accounts: GrowthAccount[]): Promise<Map<string, BoardExtra>> {
  const out = new Map<string, BoardExtra>();
  if (accounts.length === 0) return out;
  const ids = await sourceIdsOf(accounts.map((account) => account.handle));
  const [regions, activity] = await Promise.all([regionsOf(ids), activityOf(accounts, ids)]);
  for (const account of accounts) {
    const counts = activity.get(account.handle) ?? { posts: 0, views: 0 };
    out.set(account.handle, { region: regions.get(account.handle) ?? "other", posts: counts.posts, views: counts.views });
  }
  return out;
}

/**
 * 一个窗口的涨粉榜。名次由页面按当前筛选重排（这里给的是全站名次，画像页用）；
 * 另外返回上周同一窗口的行，页面按同一筛选重排后算每行的名次变化。
 * 区间内的发帖与浏览一并给出，页面据此显示效率和归因提示。
 */
export async function loadGrowth(window: number, now = new Date()): Promise<XGrowthResponse> {
  const today = beijingDate(now);
  const weekAgo = beijingDate(new Date(now.getTime() - 7 * 86_400_000));
  const [coverage, current, previous] = await Promise.all([
    coverageOf(),
    growthAccounts(window, today),
    growthAccounts(window, weekAgo),
  ]);
  const [currentExtras, previousExtras] = await Promise.all([extrasOf(current), extrasOf(previous)]);
  const rank = ranksOf(current, "growth");
  const rankPct = ranksOf(current, "growthPct");
  const prevRank = ranksOf(previous, "growth");
  const prevRankPct = ranksOf(previous, "growthPct");
  const rows: XGrowthRow[] = current.map((account) => {
    const extra = currentExtras.get(account.handle) ?? { region: "other", posts: 0, views: 0 };
    return {
      handle: account.handle,
      screenName: account.screenName,
      name: account.name,
      avatarUrl: account.avatarUrl,
      region: extra.region,
      followers: account.followers,
      baseline: account.baseline,
      growth: account.growth,
      growthPct: account.growthPct,
      spanDays: account.spanDays,
      updatedOn: account.toOn,
      rank: rank.get(account.handle)!,
      rankPct: rankPct.get(account.handle)!,
      rankPrev: prevRank.get(account.handle) ?? null,
      rankPctPrev: prevRankPct.get(account.handle) ?? null,
      posts: extra.posts,
      views: extra.views,
      perPost: extra.posts > 0 ? Math.round(account.growth / extra.posts) : null,
      perK: extra.views > 0 ? Math.round((account.growth / extra.views) * 1000 * 10) / 10 : null,
      signal: signalOf(account.growth, account.growthPct, extra.posts, extra.views),
    };
  });
  const prev: XGrowthPrevRow[] = previous.map((account) => {
    const extra = previousExtras.get(account.handle) ?? { region: "other", posts: 0, views: 0 };
    return {
      handle: account.handle,
      region: extra.region,
      followers: account.followers,
      growth: account.growth,
      growthPct: account.growthPct,
      posts: extra.posts,
      views: extra.views,
    };
  });
  const since = coverage?.since ?? null;
  const coveredDays = coverage?.since && coverage?.latest ? Math.round((Date.parse(coverage.latest) - Date.parse(coverage.since)) / 86_400_000) + 1 : 0;
  const freshness = freshnessOf({ latest: coverage?.latest ?? null, since, snapshots: coveredDays, now });
  return {
    window,
    freshness,
    rows,
    prev,
    generatedAt: now.toISOString(),
    coverage: {
      accounts: coverage?.accounts ?? 0,
      rows: coverage?.rows ?? 0,
      since,
      latest: coverage?.latest ?? null,
      days: since ? Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86_400_000) + 1) : 0,
      eligible: rows.length,
    },
  };
}

async function coverageOf(): Promise<{ accounts: number; since: string | null; latest: string | null; rows: number } | undefined> {
  const [coverage] = await sql<{ accounts: number; since: string | null; latest: string | null; rows: number }[]>`
    SELECT count(DISTINCT handle)::int AS accounts, to_char(min(captured_on), 'YYYY-MM-DD') AS since,
           to_char(max(captured_on), 'YYYY-MM-DD') AS latest, count(*)::int AS rows
    FROM x_follower_snapshots`;
  return coverage;
}

/** 榜单在进程里缓存一分钟：同一时刻的榜单接口和画像页共用一次计算。 */
const boards = cachedByKey<number, XGrowthResponse>((window) => String(window), (window) => loadGrowth(window), {
  freshMs: 60_000, maxStaleMs: 300_000, maxKeys: 4,
});

export const growthBoard = (window: number): Promise<XGrowthResponse> => boards(window);

/** 粉丝档：画像页说「同档中位」和榜单筛选用同一套边界。 */
export function tierOf(followers: number): { key: string; label: string } {
  if (followers < 1000) return { key: "s0", label: "1 千以下" };
  if (followers < 10_000) return { key: "s1", label: "1 千–1 万" };
  if (followers < 50_000) return { key: "s2", label: "1–5 万" };
  if (followers < 200_000) return { key: "s3", label: "5–20 万" };
  return { key: "s4", label: "20 万以上" };
}

/** 画像页的涨粉：粉丝曲线、7 日与 30 日涨粉和名次、区间内最热帖、同期相关报道。 */
export async function loadPersonGrowth(handle: string, now = new Date()): Promise<XPersonGrowth | null> {
  const key = handle.toLowerCase();
  const today = beijingDate(now);
  const snapshots = await sql<{ on: string; followers: string }[]>`
    SELECT to_char(captured_on, 'YYYY-MM-DD') AS on, followers::text AS followers
    FROM x_follower_snapshots
    WHERE handle = ${key} AND captured_on >= ${today}::date - 30
    ORDER BY captured_on`;
  if (snapshots.length === 0) return null;
  const daily = snapshots.map((row, index) => ({
    on: row.on,
    followers: Number(row.followers),
    delta: index === 0 ? null : Number(row.followers) - Number(snapshots[index - 1]!.followers),
  }));
  const latest = snapshots[snapshots.length - 1]!;
  const [week, month] = await Promise.all([growthBoard(7), growthBoard(30)]);
  const weekRow = week.rows.find((row) => row.handle === key) ?? null;
  const monthRow = month.rows.find((row) => row.handle === key) ?? null;
  const zhRows = week.rows.filter((row) => row.region === "zh").sort((a, b) => b.growth - a.growth);
  const zhRank = zhRows.findIndex((row) => row.handle === key);
  // 同地区、同粉丝档里够得上效率样本的账号，取每千曝光的中位数：画像页用它说「高于/低于同档」。
  const tier = weekRow ? tierOf(weekRow.followers) : null;
  const peers = weekRow
    ? week.rows
        .filter((row) => row.region === weekRow.region && tierOf(row.followers).key === tier!.key && row.posts > 0 && row.views >= 2000)
        .map((row) => row.perK ?? 0)
        .sort((a, b) => a - b)
    : [];
  const perKMedian = peers.length ? peers[Math.floor(peers.length / 2)]! : null;
  const topPosts = await topPostsOf(key, now);
  const [allTime] = await sql<{ n: number; since: string | null }[]>`
    SELECT count(*)::int AS n, to_char(min(captured_on), 'YYYY-MM-DD') AS since
    FROM x_follower_snapshots WHERE handle = ${key}`;
  return {
    freshness: freshnessOf({ latest: latest.on, since: allTime?.since ?? latest.on, snapshots: allTime?.n ?? snapshots.length, now }),
    followers: Number(latest.followers),
    updatedOn: latest.on,
    daily,
    d7: weekRow
      ? {
          growth: weekRow.growth,
          pct: weekRow.growthPct,
          rank: weekRow.rank,
          rankZh: zhRank >= 0 ? zhRank + 1 : null,
          eligible: week.rows.length,
          eligibleZh: zhRows.length,
          posts: weekRow.posts,
          views: weekRow.views,
          perK: weekRow.perK,
          perPost: weekRow.perPost,
          perKMedian,
          tier: tier!.label,
          signal: weekRow.signal,
        }
      : null,
    d30: monthRow
      ? { growth: monthRow.growth, pct: monthRow.growthPct, eligible: month.rows.length, enough: month.coverage.days >= 31 }
      : null,
    topPosts,
    // 每周报告在 growth-report.ts 里读：接口层把 latestReportFor 的结果填进来。
    report: null,
  };
}

/** 涨粉区间里浏览最高的几条帖子（与榜单同一个 7 天口径）。 */
async function topPostsOf(handle: string, now: Date): Promise<XPost[]> {
  const ids = await sourceIdsOf([handle]);
  const all = [...ids.values()].flat();
  if (all.length === 0) return [];
  const rows = await sql<{ id: string; text: string | null; tweet_id: string | null; published_at: Date; likes: string; retweets: string; replies: string; quotes: string; views: string; media_kind: string; lang: string | null; is_reply: boolean }[]>`
    SELECT a.id, a.x_post->>'text' AS text, a.x_post->>'tweetId' AS tweet_id, a.published_at,
           coalesce((a.raw->>'favorite')::bigint, 0)::text AS likes,
           coalesce((a.raw->>'retweet')::bigint, 0)::text AS retweets,
           coalesce((a.raw->>'reply')::bigint, 0)::text AS replies,
           coalesce((a.raw->>'quote')::bigint, 0)::text AS quotes,
           coalesce((a.raw->>'views')::bigint, 0)::text AS views,
           coalesce(a.x_post->'media'->0->>'kind', '') AS media_kind,
           coalesce(a.language, a.x_post->>'lang') AS lang,
           (a.x_post->'replyTo' IS NOT NULL AND a.x_post->'replyTo' <> 'null'::jsonb) AS is_reply
    FROM articles a
    WHERE a.source_id = ANY(${all}::text[]) AND a.published_at > ${new Date(now.getTime() - 7 * 86_400_000)}
    ORDER BY coalesce((a.raw->>'views')::bigint, 0) DESC, a.published_at DESC
    LIMIT 300`;
  const mapped: XPost[] = rows.map((row) => ({
    id: row.id,
    text: row.text ?? "",
    url: row.tweet_id ? `https://x.com/${handle}/status/${row.tweet_id}` : `https://x.com/${handle}`,
    at: new Date(row.published_at).toISOString(),
    views: Number(row.views),
    likes: Number(row.likes),
    retweets: Number(row.retweets),
    replies: Number(row.replies),
    quotes: Number(row.quotes),
    mediaKind: row.media_kind,
    language: row.lang,
    isReply: row.is_reply,
  }));
  // 代表帖：浏览 Top5 + 互动率 Top3（去重），最多 10 条。互动率 =（赞+转）/ 浏览。
  const byViews = mapped.slice(0, 5);
  const byRate = [...mapped]
    .filter((post) => post.views > 0)
    .sort((a, b) => (b.likes + b.retweets) / b.views - (a.likes + a.retweets) / a.views)
    .slice(0, 3);
  const picked = new Map<string, XPost>();
  for (const post of [...byViews, ...byRate]) if (!picked.has(post.id)) picked.set(post.id, post);
  return [...picked.values()].slice(0, 10);
}