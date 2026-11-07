// 数据新鲜度：每个涨粉结论都要能回答「这是哪天的数、覆盖多少天、够不够下结论」。
//
// 规则只有四条：没快照 → empty；快照少于 5 次 → insufficient；最近一次超过 2 天 → delayed；
// 其余 normal。页面把 status 翻成一个短标签，把 note 原样显示，别让读者自己猜。
export type XFreshnessStatus = "normal" | "delayed" | "insufficient" | "empty";

export interface XFreshness {
  status: XFreshnessStatus;
  /** 一句短标签：正常 / 延迟 / 样本不足 / 还没有数据。 */
  label: string;
  /** 最近一次快照的日期（YYYY-MM-DD）。 */
  latest: string | null;
  /** 最早一次快照的日期。 */
  since: string | null;
  /** 首尾快照相隔的天数；不足一天按 0。 */
  spanDays: number;
  /** 区间内的快照次数（一行一天）。 */
  snapshots: number;
  /** 给读者看的一句话，说清为什么是这个状态。 */
  note: string;
}

const BEIJING = "Asia/Shanghai";

/** 北京时间的今天（en-CA 输出 YYYY-MM-DD）。 */
export function beijingDateOf(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BEIJING, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function freshnessOf(input: {
  latest: string | null;
  since?: string | null;
  snapshots: number;
  /** 超过几天算延迟，默认 2 天（周末断一次不算）。 */
  staleDays?: number;
  now?: Date;
}): XFreshness {
  const { latest, snapshots, staleDays = 2 } = input;
  const since = input.since ?? latest;
  const today = beijingDateOf(input.now);
  const spanDays = latest && since ? daysBetween(since, latest) : 0;

  if (!latest || snapshots <= 0) {
    return { status: "empty", label: "还没有数据", latest: null, since: null, spanDays: 0, snapshots: 0, note: "还没有粉丝快照，等第一次采集完成后再看涨粉。" };
  }
  if (snapshots < 5) {
    return { status: "insufficient", label: "样本不足", latest, since, spanDays, snapshots, note: `只有 ${snapshots} 天快照，攒够 5 天再解读涨粉，现在只能看个大概。` };
  }
  const lag = daysBetween(latest, today);
  if (lag > staleDays) {
    return { status: "delayed", label: "延迟", latest, since, spanDays, snapshots, note: `最近一次快照是 ${lag} 天前（${latest}），这几天的涨粉还没进来。` };
  }
  return { status: "normal", label: "正常", latest, since, spanDays, snapshots, note: `快照从 ${since} 起，覆盖 ${spanDays + 1} 天，最近一次是${lag === 0 ? "今天" : lag === 1 ? "昨天" : `${lag} 天前`}（${latest}）。` };
}
