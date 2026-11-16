// 曝光自查（W9）：把近 14 天的中位浏览和这个账号自己的基线对照，再结合粉丝走势，
// 区分「内容/选题没起来」和「值得核对账号状态」。我们看不到曝光曲线和推荐系统分配，
// 所以只给对照和置信度，不下「被限流」的结论。
import { sql } from "@aihot/backend/db";
import { cachedByKey } from "@aihot/backend/lib/cache";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { posts } from "./data.ts";
import { sourceIdsOfHandle } from "./followers.ts";
import type { XReachCheck } from "../types.ts";

const RECENT_DAYS = 14;
const num = (value: string | null | undefined) => (value === null || value === undefined ? null : Number(value));
const round = (value: number) => Math.round(value);

const CAVEATS = [
  "浏览是采集那一刻的快照，不是完整曝光曲线；我们看不到推荐系统把这条分给了多少人。",
  "低曝光也可能只是选题、发布时间或题材的问题；这里给的是对照，不能证明限流。",
  "粉丝还在涨时，低曝光更可能是内容没进推荐池；如果连续几条都低，再核对账号状态。",
];

export interface ReachVerdictInput {
  recentPosts: number;
  basePosts: number;
  recentMed: number | null;
  baseMed: number | null;
  d30: number | null;
}

export interface ReachVerdict {
  status: XReachCheck["status"];
  label: string;
  confidence: XReachCheck["confidence"];
  conclusion: string;
  ratio: number | null;
}

/** 纯函数：样本量、自身基线和一个月粉丝变化 → 结论。测试直接打这里。 */
export function reachVerdict(input: ReachVerdictInput): ReachVerdict {
  const { recentPosts, basePosts, recentMed, baseMed, d30 } = input;
  const ratio = recentMed !== null && baseMed !== null && baseMed > 0 ? Math.round((recentMed / baseMed) * 100) / 100 : null;
  const confidence: XReachCheck["confidence"] =
    recentPosts >= 8 && basePosts >= 20 ? "high" : recentPosts >= 5 && basePosts >= 12 ? "medium" : "low";

  if (recentPosts === 0) {
    return {
      status: "quiet",
      label: "近 14 天没发原创",
      confidence,
      conclusion: "近 14 天没有原创帖，没有新的曝光可以对照；先发几条再看。",
      ratio,
    };
  }
  if (ratio === null || recentPosts < 3 || basePosts < 12) {
    return {
      status: "insufficient",
      label: "样本不足",
      confidence,
      conclusion: `近 14 天原创帖 ${recentPosts} 条、基线 ${basePosts} 条，样本还不够判断曝光是不是异常。`,
      ratio,
    };
  }
  if (ratio >= 0.8) {
    return {
      status: "normal",
      label: "和基线接近",
      confidence,
      conclusion: `近 14 天中位浏览 ${round(recentMed!)}，是自身基线（${round(baseMed!)}）的 ${ratio} 倍，没有明显掉队。`,
      ratio,
    };
  }
  if (ratio >= 0.5) {
    return {
      status: "mixed",
      label: "略低于基线",
      confidence,
      conclusion: `近 14 天中位浏览是自身基线的 ${ratio} 倍，低了一些但还在常见波动里；先看是不是题材或发布时间变了。`,
      ratio,
    };
  }
  if (d30 === null) {
    return {
      status: "insufficient",
      label: "快照历史不足",
      confidence,
      conclusion: `近 14 天中位浏览是自身基线的 ${ratio} 倍，但还没有一个月前的粉丝快照，无法判断是内容还是账号问题；先积累快照再看。`,
      ratio,
    };
  }
  if (d30 > 0) {
    return {
      status: "content",
      label: "低曝光，粉丝还在涨",
      confidence,
      conclusion: `近 14 天中位浏览只有自身基线的 ${ratio} 倍，但粉丝 30 天还涨了 ${d30}。更像这批内容没进推荐池，而不是账号整体被限；如果下一条还这样，再核对。`,
      ratio,
    };
  }
  return {
    status: "check",
    label: "曝光和粉丝同时走低",
    confidence,
    conclusion: `近 14 天中位浏览只有自身基线的 ${ratio} 倍，粉丝 30 天也没有涨（${d30 === null ? "没有一个月前的快照" : `${d30 > 0 ? "+" : ""}${d30}`}）。可能限流，也可能停更、换题材或外部事件；建议对照发文时间和题材再判断。`,
    ratio,
  };
}

/** 没有任何可读数据时返回 null；有账号但没有近 14 天帖子时给 quiet。 */
export async function loadReachCheck(handle: string): Promise<XReachCheck | null> {
  const ids = await sourceIdsOfHandle(handle);
  if (ids.length === 0) return null;

  const [[row], [snap]] = await Promise.all([
    sql<{ recent_posts: number; recent_med: string | null; base_posts: number; base_med: string | null }[]>`
      WITH p AS (${posts()})
      SELECT
        count(*) FILTER (WHERE p.published_at >= now() - make_interval(days => ${RECENT_DAYS}))::int AS recent_posts,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.views)
          FILTER (WHERE p.published_at >= now() - make_interval(days => ${RECENT_DAYS})) AS recent_med,
        count(*) FILTER (WHERE p.published_at < now() - make_interval(days => ${RECENT_DAYS}))::int AS base_posts,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.views)
          FILTER (WHERE p.published_at < now() - make_interval(days => ${RECENT_DAYS})) AS base_med
      FROM p
      WHERE p.source_id = ANY(${ids}::text[]) AND NOT p.is_reply
    `,
    sql<{ latest: string | null; d7: string | null; d30: string | null }[]>`
      SELECT
        (SELECT followers::text FROM x_follower_snapshots WHERE lower(handle) = lower(${handle}) ORDER BY captured_on DESC LIMIT 1) AS latest,
        (SELECT followers::text FROM x_follower_snapshots
          WHERE lower(handle) = lower(${handle})
            AND captured_on <= (now() AT TIME ZONE ${BEIJING_TIMEZONE})::date - 7
          ORDER BY captured_on DESC LIMIT 1) AS d7,
        (SELECT followers::text FROM x_follower_snapshots
          WHERE lower(handle) = lower(${handle})
            AND captured_on <= (now() AT TIME ZONE ${BEIJING_TIMEZONE})::date - 30
          ORDER BY captured_on DESC LIMIT 1) AS d30
    `,
  ]);

  const recentPosts = Number(row?.recent_posts ?? 0);
  const basePosts = Number(row?.base_posts ?? 0);
  const recentMed = num(row?.recent_med);
  const baseMed = num(row?.base_med);
  const nowFollowers = num(snap?.latest);
  const followers7 = num(snap?.d7);
  const followers30 = num(snap?.d30);
  const d7 = nowFollowers !== null && followers7 !== null ? nowFollowers - followers7 : null;
  const d30 = nowFollowers !== null && followers30 !== null ? nowFollowers - followers30 : null;
  const verdict = reachVerdict({ recentPosts, basePosts, recentMed, baseMed, d30 });

  return {
    ...verdict,
    windowDays: RECENT_DAYS,
    recent: { posts: recentPosts, medViews: recentMed === null ? null : round(recentMed) },
    baseline: { posts: basePosts, medViews: baseMed === null ? null : round(baseMed) },
    followers: { now: nowFollowers, d7, d30 },
    caveats: CAVEATS,
  };
}

/** 画像页和 v1 共用；5 分钟内重复打开不重算。 */
export const reachCheck = cachedByKey<string, XReachCheck | null>((handle) => handle.toLowerCase(), (handle) => loadReachCheck(handle), {
  freshMs: 300_000,
  maxStaleMs: 900_000,
  maxKeys: 500,
});
