// 单条帖子的预测：预计 24 小时浏览、此刻流速、破圈系数。
//
// 模型来自 X 公开的「热门帖子池」（xai-org/x-algorithm home-mixer/util/popular_posts.rs）：
//   V(t) = A·(1 − e^(−λt))，λ = ln2 / 8h，t 下限 0.5h
// X 用它给全站热门帖子按「预计 24h 浏览」排序。我们只有采集那一刻的一个数，所以反推 A 再外推；
// 这比「浏览 ÷ 已发布小时」准：全程平均会高估老帖子（早期涨得快，随后衰减）。
export const HALF_LIFE_HOURS = 8;
/** 发帖后不到半小时的帖子，浏览量还太噪，按半小时算。 */
export const AGE_FLOOR_HOURS = 0.5;
const LAMBDA = Math.LN2 / HALF_LIFE_HOURS;

const num = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 从发布到采集经过的小时数；时间缺失或在未来时返回 null。 */
export function ageHours(publishedAt: string | Date, capturedAt: string | Date): number | null {
  const start = new Date(publishedAt).getTime();
  const end = new Date(capturedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

/** 到 t 小时为止已经发生的浏览占总量的比例。 */
function elapsedShare(age: number): number {
  return 1 - Math.exp(-LAMBDA * Math.max(age, AGE_FLOOR_HOURS));
}

/** 预计 24 小时浏览；超过 24 小时的帖子直接返回实际浏览（不再外推）。 */
export function projected24hViews(views: number | null | undefined, age: number | null): number | null {
  const v = num(views ?? null);
  if (v === null || v < 0 || age === null) return null;
  if (age >= 24) return v;
  const saturation = 1 - Math.exp(-LAMBDA * 24);
  return Math.round(Math.max(v, (v * saturation) / elapsedShare(age)));
}

/** 采集那一刻的流速（浏览/小时）：A·λ·e^(−λt)。超过 48 小时的帖子不再显示。 */
export function velocityPerHour(views: number | null | undefined, age: number | null): number | null {
  const v = num(views ?? null);
  if (v === null || v < 0 || age === null || age > 48) return null;
  const t = Math.max(age, AGE_FLOOR_HOURS);
  const total = v / elapsedShare(age);
  return Math.round(total * LAMBDA * Math.exp(-LAMBDA * t) * 10) / 10;
}

/** 破圈系数 = 浏览 ÷ max(粉丝数, 下限)。超过 1 说明看的人比粉丝还多，推荐系统在往外推。 */
export function breakoutRatio(views: number | null | undefined, followers: number | null | undefined, floor = 500): number | null {
  const v = num(views ?? null);
  const f = num(followers ?? null);
  if (v === null || f === null || f < 0) return null;
  return Math.round((v / Math.max(f, floor)) * 10) / 10;
}

/** 权重口径的互动率（回复/引用比点赞值钱）。没有浏览时返回 null。 */
export function weightedEngagement(
  input: { views?: number | null; likes?: number | null; retweets?: number | null; replies?: number | null; quotes?: number | null },
): number | null {
  const views = num(input.views ?? null);
  if (!views || views <= 0) return null;
  const count = (value: number | null | undefined) => num(value ?? null) ?? 0;
  const weighted = 0.708 * count(input.likes) + 5 * count(input.replies) + 1 * count(input.retweets) + 5 * count(input.quotes);
  return Math.round((weighted / views) * 10000) / 10000;
}

/**
 * 回复机会分：窗口内预计还剩多少浏览 ÷（已有回复 + 平滑量）。
 * 用来回答「现在去回哪条最划算」——刚起量、回复少的分最高。
 */
export function replyOpportunity(
  input: { views: number | null; age: number | null; replies: number | null; windowHours?: number; smoothing?: number },
): { hoursLeft: number; remainingViews: number; score: number } | null {
  const { windowHours = 12, smoothing = 8 } = input;
  const views = num(input.views);
  const age = input.age;
  if (views === null || age === null || age >= windowHours) return null;
  const velocity = velocityPerHour(views, age);
  if (velocity === null) return null;
  const hoursLeft = Math.round((windowHours - age) * 10) / 10;
  const remaining = (velocity / LAMBDA) * (1 - Math.exp(-LAMBDA * hoursLeft));
  const replies = num(input.replies) ?? 0;
  return {
    hoursLeft,
    remainingViews: Math.round(remaining),
    score: Math.round((remaining / (replies + smoothing)) * 10) / 10,
  };
}
