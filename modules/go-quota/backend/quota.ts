// Go 套餐（OpenCode Zen）的额度：网关有一个只读接口，按滚动/周/月三个窗口给百分比。
//
//   GET {LLM_BASE_URL}/usage  ->  {"usage":{"rolling":{percent,resetsAt,status},"weekly":{…},"monthly":{…}}}
//
// 额度按 key 算（两把 key 各自独立：10-15 那次一把用尽时，换上的另一把周额度只用了 11%），
// 所以状态里记 key 的 sha256 前 6 位 —— 数字跳变时能分辨是用量还是换 key。
import { createHash } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { beijingStamp } from "@aihot/contracts/time";
import type { Finding } from "@aihot/backend/notify/feishu";

export const QUOTA_SETTING = "go.quota";
/** 每 30 分钟一条样本，最多留两天：够算"最近的用量速度"，也不会把 settings 撑大。 */
export const SAMPLE_LIMIT = 96;
/** 低于这个百分比不打扰站主。 */
const WORRY_PERCENT = 70;
/** 到这个百分比就不再等"按速度外推"，直接说。 */
const URGENT_PERCENT = 95;
/** 算速度用的回看长度。 */
const RATE_WINDOW_MS = 24 * 3600_000;

export const WINDOW_LABEL: Record<string, string> = { rolling: "滚动窗口", weekly: "本周", monthly: "本月" };

export interface QuotaWindow {
  percent: number;
  /** 这个窗口什么时候重置；没有就当不知道。 */
  resetsAt: string | null;
  status: string;
}
export interface QuotaSample {
  at: string;
  percent: number;
}
export interface QuotaState {
  checkedAt: string;
  /** 密钥的 sha256 前 6 位，用来分辨换没换 key（不是密钥本身）。 */
  keyTag: string;
  windows: Record<string, QuotaWindow>;
  history: Record<string, QuotaSample[]>;
}

/** 网关答复里的 usage 对象 -> 三个窗口；没有可用窗口时报错，因为那说明接口变了。 */
export function parseUsage(body: unknown): Record<string, QuotaWindow> {
  const usage = (body as { usage?: Record<string, { percent?: unknown; resetsAt?: unknown; status?: unknown }> } | null)?.usage;
  if (!usage || typeof usage !== "object") throw new Error("Go usage 答复里没有 usage 对象");
  const out: Record<string, QuotaWindow> = {};
  for (const [name, w] of Object.entries(usage)) {
    const percent = Number(w?.percent);
    if (!Number.isFinite(percent)) continue;
    out[name] = { percent, resetsAt: typeof w?.resetsAt === "string" ? w.resetsAt : null, status: String(w?.status ?? "") };
  }
  if (!Object.keys(out).length) throw new Error("Go usage 答复里没有可用的窗口");
  return out;
}

/** key 的指纹：换 key 之后额度会重新算，数字跳变要能解释得通。 */
export const keyTag = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 6);

/**
 * 最近的用量速度（百分点/天）。只在"没有掉过"的一段里算：百分比下降说明窗口重置了，
 * 重置之前的速度不能拿来外推；样本不足或没有增长时给出 null（宁可不猜）。
 */
export function ratePerDay(history: readonly QuotaSample[], now: number): number | null {
  const recent = history.filter((s) => Number.isFinite(Date.parse(s.at)) && now - Date.parse(s.at) <= RATE_WINDOW_MS);
  let start = 0;
  for (let i = recent.length - 1; i > 0; i--) {
    if (recent[i]!.percent < recent[i - 1]!.percent) {
      start = i;
      break;
    }
  }
  const series = recent.slice(start);
  if (series.length < 2) return null;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3_600_000;
  const delta = last.percent - first.percent;
  if (hours < 1 || delta <= 0) return null;
  return (delta / hours) * 24;
}

export interface Outlook {
  window: string;
  percent: number;
  /** 按最近速度还能用几天；算不出来是 null。 */
  daysLeft: number | null;
  hoursToReset: number | null;
  /** 该不该现在告诉站主：快到顶，或者按速度会在重置之前用尽。 */
  tell: boolean;
}

export function outlook(state: QuotaState, now: number): Outlook[] {
  return Object.entries(state.windows).map(([name, w]) => {
    const hoursToReset = w.resetsAt && Number.isFinite(Date.parse(w.resetsAt)) ? (Date.parse(w.resetsAt) - now) / 3_600_000 : null;
    const rate = ratePerDay(state.history?.[name] ?? [], now);
    const daysLeft = rate && rate > 0 ? (100 - w.percent) / rate : null;
    const soon = w.percent >= URGENT_PERCENT;
    const runsOutFirst = daysLeft !== null && hoursToReset !== null && hoursToReset > 0 && daysLeft * 24 < hoursToReset;
    return { window: name, percent: w.percent, daysLeft, hoursToReset, tell: soon || (w.percent >= WORRY_PERCENT && (runsOutFirst || daysLeft === null)) };
  });
}

/** 额度快用尽的告警；恢复（重置或用得慢了）由告警状态机自己收尾。 */
export function quotaFindings(state: QuotaState, now: number): Finding[] {
  const windows = state.windows;
  const summary = Object.entries(windows).map(([name, w]) => `${WINDOW_LABEL[name] ?? name} ${w.percent}%`).join("、");
  return outlook(state, now)
    .filter((o) => o.tell)
    .map((o) => {
      const label = WINDOW_LABEL[o.window] ?? o.window;
      const urgent = o.percent >= URGENT_PERCENT;
      const left = o.daysLeft !== null
        ? `按最近一天的用量速度，大约还能撑 ${o.daysLeft < 1 ? `${Math.max(1, Math.round(o.daysLeft * 24))} 小时` : `${o.daysLeft.toFixed(1)} 天`}`
        : "按最近的用量速度外推不出来还能撑多久";
      const reset = o.hoursToReset !== null && o.hoursToReset > 0 ? `${beijingStamp(windows[o.window]!.resetsAt!)} 重置` : "重置时间未知";
      const use = o.window === "rolling" ? "一个短窗口" : o.window === "weekly" ? "这一周的额度" : "这个月的额度";
      return {
        key: `go.quota.${o.window}`,
        level: urgent ? "now" : "today",
        title: `Go 套餐${label}额度已用 ${o.percent}%`,
        impact: `${left}，而${use}在 ${reset}；用尽会让所有模型调用停下来（文章堆着，等额度回来或换 key 才继续），精选和热点会缺内容`,
        heals: "不会自己好，除非额度重置或换 key；换 key 后系统会自己接上",
        action: `决定：等到 ${reset}，或者换上另一把 key（改 .env 里共用 Go key 的那几个变量，再重建 api 与 worker）`,
        detail: `密钥指纹 ${state.keyTag}（sha256 前 6 位），${beijingStamp(state.checkedAt)} 查询；三个窗口：${summary}`,
      };
    });
}

/** 只有 Go 网关有这个接口；换成官方 API 之后这里自然什么都不做。 */
export function goGateway(): { base: string; key: string } | null {
  const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.LLM_API_KEY ?? "";
  if (!key || !/^https:\/\/opencode\.ai\/zen\/go\b/.test(base)) return null;
  return { base, key };
}

export async function readQuota(): Promise<QuotaState | null> {
  const [row] = await sql<{ value: QuotaState }[]>`SELECT value FROM settings WHERE key = ${QUOTA_SETTING}`;
  return row?.value ?? null;
}

/** 问一次网关并把结果连同样本写进 settings；不是 Go 网关时返回 null（不报错）。 */
export async function refreshQuota(now = Date.now()): Promise<QuotaState | null> {
  const gateway = goGateway();
  if (!gateway) return null;
  const res = await fetch(`${gateway.base}/usage`, {
    headers: { authorization: `Bearer ${gateway.key}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Go usage HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const windows = parseUsage(await res.json());
  const previous = await readQuota();
  const at = new Date(now).toISOString();
  const history: Record<string, QuotaSample[]> = {};
  for (const [name, w] of Object.entries(windows)) {
    history[name] = [...(previous?.history?.[name] ?? []).filter((s) => s.at !== at), { at, percent: w.percent }].slice(-SAMPLE_LIMIT);
  }
  const state: QuotaState = { checkedAt: at, keyTag: keyTag(gateway.key), windows, history };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${QUOTA_SETTING}, ${sql.json(state as never)}, 'go-quota')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return state;
}
