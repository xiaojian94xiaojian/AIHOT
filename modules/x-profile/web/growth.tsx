// X 涨粉榜（工具默认页）：中文 AI 圈里谁在涨、涨得值不值得学。
// 粉丝数只出现在采集回执里，后端每五分钟把新回执记成当天的快照（backend/followers.ts），
// 这里把两个窗口一起取回来，切换只改显示。名次按当前筛选重排；箭头和「上周同一筛选」比。
// 排序在表头上（数据站的通用心智），地区与窗口常驻，粉丝门槛与「显示需核对」收进筛选。
import { memo, useEffect, useMemo, useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import type { Region, XGrowthPrevRow, XGrowthResponse, XGrowthRow } from "../types";
import { REGION_LABEL } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { beijingDay } from "@aihot/contracts/time";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { KEYS, readRaw, writeRaw } from "@aihot/web/lib/local-state";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
import { PillTabs } from "@aihot/web/components/ui/Tabs";
import { compact, signed, signedPercent, stamp } from "./format";
import { SubscribeButton } from "./subscribe";
import { IconCrown, IconFilter, IconSearch, IconTrendingDown, IconTrendingUp, IconTrophy } from "./icons";

export async function loader({ request }: { request: Request }) {
  const [seven, thirty] = await Promise.all([
    loadOr404<XGrowthResponse>("/api/site/x-people/growth?window=7", { signal: request.signal }),
    loadOr404<XGrowthResponse>("/api/site/x-people/growth?window=30", { signal: request.signal }),
  ]);
  return { seven, thirty };
}

export function meta() {
  return pageMeta({
    title: "X 涨粉榜：中文 AI 圈的涨粉效率",
    description: "本站每次采集 X 账号时记下粉丝数，默认按中文区、每千曝光效率排出值得学的账号，可按地区、粉丝门槛筛选。",
    path: "/x-people/growth",
  });
}

/**
 * 涨粉榜数据不依赖查询参数，使用规范 pageReuse 统一处理同路径与下拉刷新支持
 */
export const { clientLoader, shouldRevalidate } = pageReuse<Awaited<ReturnType<typeof loader>>>(() => "/x-people/growth");

export function headers() {
  return edgeTtl(300);
}

/** 手机底栏的「工具」标签：这个页面就是它的落地页。 */
export const handle = { tab: "x-tools", name: "涨粉榜" } as const;

const WINDOWS = [7, 30] as const;
type Window = (typeof WINDOWS)[number];
/** 可以点表头排序的列。 */
type Metric = "followers" | "growth" | "growthPct" | "posts" | "perPost" | "perK";
type Dir = "desc" | "asc";
/** 效率榜的最小样本：窗口内曝光不足这个数的行不进名次，只标「样本小」。 */
const EFF_MIN_VIEWS = 2000;

const REGIONS: Array<Region | "all"> = ["zh", "en", "all"];
/** 粉丝档：下界含、上界不含；「不限」以下两档是给小号扫同量级用的。 */
const TIERS: Array<{ key: string; label: string; min: number; max: number | null }> = [
  { key: "all", label: "不限粉丝", min: 0, max: null },
  { key: "lt1k", label: "1 千以下", min: 0, max: 1_000 },
  { key: "1k-10k", label: "1 千–1 万", min: 1_000, max: 10_000 },
  { key: "gt10k", label: "1 万以上", min: 10_000, max: null },
  { key: "gt100k", label: "10 万以上", min: 100_000, max: null },
  { key: "gt1m", label: "100 万以上", min: 1_000_000, max: null },
];
/** 三个常用看法；表头还能按粉丝、帖数、每帖排，但默认这几个。 */
const VIEWS: Array<{ key: Metric; label: string }> = [
  { key: "perK", label: "效率榜" },
  { key: "growth", label: "涨粉数榜" },
  { key: "growthPct", label: "涨粉率榜" },
];
const METRIC_LABEL: Record<Metric, string> = {
  followers: "按粉丝", posts: "按帖数", growth: "涨粉数榜", growthPct: "涨粉率榜", perPost: "按每帖", perK: "效率榜",
};

const tint = (n: number) => (n > 0 ? "text-accent font-medium" : "text-ink-3");

const getSignalInfo = (windowDays: number): Record<NonNullable<XGrowthRow["signal"]>, { label: string; title: string; tone: string }> => ({
  quiet: {
    label: "本期无发帖",
    title: `这 ${windowDays} 天没抓到它的帖子：涨粉只能来自外部事件、产品发布或其他渠道，无法用内容解释。`,
    tone: "text-ink-4",
  },
  thin: {
    label: "发帖少",
    title: `这 ${windowDays} 天帖子太少，样本不足，看不出内容与涨粉的关系。`,
    tone: "text-ink-4",
  },
  caution: {
    label: "需核对",
    title: `涨粉远高于同期曝光，或 ${windowDays} 日涨跌幅超过 30%：可能是一次站外传播、抽奖或买粉，建议核对，不是定论。`,
    tone: "text-amber-ink",
  },
});

interface Sortable {
  handle: string;
  followers: number;
  growth: number;
  growthPct: number;
  posts: number;
  views: number;
  perPost: number | null;
  perK: number | null;
}

/** 一行参与效率排名的条件：有发帖，且曝光够多（否则分母太小，效率会失真）。 */
function effEligible(row: { posts: number; views: number }): boolean {
  return row.posts > 0 && row.views >= EFF_MIN_VIEWS;
}

function metricValue(row: Sortable, metric: Metric): number | null {
  if (metric === "perK") return row.perK;
  if (metric === "perPost") return row.perPost;
  return row[metric];
}

/** 按当前筛选和排序列排序；效率列只有样本够的行参与名次，其余排在后面、不编号。 */
function rankRows<T extends Sortable>(list: T[], metric: Metric, dir: Dir): { ordered: T[]; rank: Map<string, number> } {
  const efficiency = metric === "perK" || metric === "perPost";
  const ranked: T[] = [];
  const rest: T[] = [];
  for (const row of list) (efficiency && !effEligible(row) ? rest : ranked).push(row);
  const sign = dir === "desc" ? 1 : -1;
  ranked.sort((a, b) => sign * ((metricValue(b, metric) ?? 0) - (metricValue(a, metric) ?? 0)) || b.growth - a.growth);
  rest.sort((a, b) => b.growth - a.growth);
  return { ordered: [...ranked, ...rest], rank: new Map(ranked.map((row, index) => [row.handle, index + 1])) };
}

/** 表头里的排序按钮：点一次按这一列排，再点一次换方向。自带 aria-sort */
function SortHead({
  label,
  metric,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  metric: Metric;
  sort: { metric: Metric; dir: Dir };
  onSort: (metric: Metric) => void;
  align?: "left" | "right";
}) {
  const active = sort.metric === metric;
  return (
    <button
      type="button"
      onClick={() => onSort(metric)}
      title={`按${label}排序（再点一次换方向）`}
      className={`inline-flex min-h-[32px] items-center gap-0.5 text-[12px] ${align === "right" ? "justify-end" : ""} ${
        active ? "font-bold text-accent" : "text-ink-3 hover:text-ink"
      }`}
    >
      <span>{label}</span>
      <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
        {sort.dir === "desc" ? "↓" : "↑"}
      </span>
    </button>
  );
}

/** 独立拆解的“查我的账号”表单组件，输入不重渲染整个账号列表 */
const MineSearchForm = memo(function MineSearchForm({
  mine,
  myRank,
  regionLabel,
  windowLabel,
  metricLabel,
  onSetMine,
}: {
  mine: string | null;
  myRank: number | null;
  regionLabel: string;
  windowLabel: string;
  metricLabel: string;
  onSetMine: (handle: string) => void;
}) {
  const [mineInput, setMineInput] = useState(mine ?? "");
  const [mineState, setMineState] = useState<null | { tracked: boolean; path: string | null; request: string | null }>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupTick, setLookupTick] = useState(0);

  // 只在没有 ?mine= 时，用上次显式提交过的 handle 预填一次；不跟着清除动作回填。
  useEffect(() => {
    if (mine) return;
    const saved = readRaw(KEYS.xMineHandle);
    if (saved) setMineInput(saved);
  }, []);

  useEffect(() => {
    if (!mine) return;
    setMineInput(mine);
    setLookupFailed(false);
    setMineState(null);
    let alive = true;
    fetch(`/api/site/x-people/lookup?handle=${encodeURIComponent(mine)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => { if (alive) setMineState(body); })
      .catch(() => { if (alive) setLookupFailed(true); });
    return () => { alive = false; };
  }, [mine, lookupTick]);

  const applyForMine = async () => {
    if (!mine || applying) return;
    setApplying(true);
    try {
      const res = await fetch("/api/site/x-people/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: mine }),
      });
      const body = await res.json().catch(() => ({}));
      setApplied(res.ok ? (body.status === "tracked" ? "tracked" : "pending") : (body.detail ?? "提交失败，稍后再试。"));
    } catch {
      setApplied("网络错误，稍后再试。");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-2.5 sm:px-3 sm:py-2">
      <form
        className="flex items-center gap-1.5 sm:gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // 写入在 setMine 里统一做；这里只负责跳转。
          onSetMine(mineInput.trim().replace(/^@/, "").toLowerCase());
        }}
      >
        <label htmlFor="x-mine-input" className="shrink-0 text-[12px] font-medium text-ink-3">
          查我的账号
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-control border border-line bg-bg-sunk/40 px-2 focus-within:border-accent">
          <IconSearch size={13} className="shrink-0 text-ink-4" />
          <span className="text-[13px] text-ink-4">@</span>
          <input
            id="x-mine-input"
            value={mineInput}
            onChange={(event) => setMineInput(event.target.value)}
            placeholder="your_handle"
            aria-label="你的 X 账号"
            className="num h-8 w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
        </div>
        <button
          type="submit"
          className="shrink-0 min-h-[32px] rounded-control border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          查一下
        </button>
        {mine && (
          <button
            type="button"
            onClick={() => {
              writeRaw(KEYS.xMineHandle, null);
              onSetMine("");
              setMineInput("");
              setMineState(null);
              setApplied(null);
            }}
            className="shrink-0 min-h-[32px] px-1.5 text-[12px] text-ink-4 transition-colors hover:text-ink-2"
          >
            清除
          </button>
        )}
      </form>
      {mine && (
        <div className="mt-2 space-y-1.5 border-t border-line-soft pt-2 text-[12px]">
          {/* 名次和画像链接是本地算的，不依赖收录状态查询。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {myRank !== null ? (
              <span className="text-ink-2">
                在 <b className="text-ink">{regionLabel} · {windowLabel}榜</b>中位列 <b className="num font-bold text-accent">#{myRank}</b> 名（{metricLabel}）
              </span>
            ) : (
              <span className="text-ink-3">当前筛选下暂未上榜</span>
            )}
            <Link
              to={`/x-people/${mine}`}
              className="rounded-control border border-accent/40 bg-accent-soft px-2 py-0.5 text-accent font-medium hover:opacity-90"
            >
              看我的画像 →
            </Link>
            <SubscribeButton handle={mine} label="订阅周报" className="text-ink-3 underline-offset-2 hover:text-ink hover:underline" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lookupFailed ? (
              <>
                <span className="text-ink-4">收录状态暂时查不到，名次和画像不受影响。</span>
                <button
                  type="button"
                  onClick={() => setLookupTick((n) => n + 1)}
                  className="min-h-[28px] rounded-control border border-line px-2 py-0.5 text-ink-2 hover:border-accent hover:text-accent"
                >
                  重试
                </button>
              </>
            ) : mineState === null ? (
              <span className="text-ink-4">查询收录状态…</span>
            ) : mineState.tracked ? (
              <span className="font-semibold text-ok">已收录</span>
            ) : applied === "tracked" ? (
              <span className="font-semibold text-ok">已收录</span>
            ) : applied === "pending" || mineState.request === "pending" ? (
              <span className="text-ink-3">已提交，等审核；通过后会出现在榜单和画像里。</span>
            ) : applied ? (
              <span className="text-ink-3">{applied}</span>
            ) : mineState.request === "rejected" ? (
              <span className="text-ink-4">之前的申请没通过，可以补一句介绍再提交。</span>
            ) : (
              <>
                <span className="text-ink-3">还没收录</span>
                <button
                  type="button"
                  onClick={applyForMine}
                  disabled={applying}
                  className="min-h-[32px] rounded-control bg-ink px-3 py-1 text-[12px] font-medium text-bg disabled:opacity-60"
                >
                  {applying ? "提交中…" : "申请收录"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default function GrowthPage() {
  const { seven, thirty } = useLoaderData<typeof loader>();
  const [window, setWindow] = useState<Window>(7);
  const [sort, setSort] = useState<{ metric: Metric; dir: Dir }>({ metric: "perK", dir: "desc" });
  // 表头用：当前排序列标 ascending/descending，其余不写。
  const ariaSort = (metric: Metric) =>
    sort.metric === metric ? (sort.dir === "asc" ? ("ascending" as const) : ("descending" as const)) : undefined;
  const [region, setRegion] = useState<Region | "all">("zh");
  const [tierKey, setTierKey] = useState("all");
  const [showCaution, setShowCaution] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const data = window === 7 ? seven : thirty;
  const label = window === 7 ? "7 日" : "30 日";
  const signalMap = useMemo(() => getSignalInfo(window), [window]);

  // 「我的账号」：?mine=handle 就是身份，不用登录
  const [params, setParams] = useSearchParams();
  const mine = (params.get("mine") ?? "").replace(/^@/, "").toLowerCase() || null;

  const setMine = (handle: string) => {
    const next = new URLSearchParams(params);
    if (handle) {
      next.set("mine", handle);
      // 写入只由这里的显式查询触发；清除走「清除」按钮（会删掉存储）。
      writeRaw(KEYS.xMineHandle, handle);
    } else {
      next.delete("mine");
    }
    setParams(next, { replace: true });
  };

  const onSort = (metric: Metric) =>
    setSort((current) => (current.metric === metric ? { metric, dir: current.dir === "desc" ? "asc" : "desc" } : { metric, dir: "desc" }));

  const prevRows = useMemo(
    () =>
      data.prev.map((row: XGrowthPrevRow) => ({
        ...row,
        perPost: row.posts > 0 ? Math.round(row.growth / row.posts) : null,
        perK: row.views > 0 ? Math.round((row.growth / row.views) * 1000 * 10) / 10 : null,
      })),
    [data.prev],
  );

  const tier = TIERS.find((option) => option.key === tierKey) ?? TIERS[0];
  const inTier = (row: { followers: number }) => row.followers >= tier.min && (tier.max === null || row.followers < tier.max);

  const inScope = useMemo(
    () => data.rows.filter((row) => inTier(row) && (region === "all" || row.region === region)),
    [data.rows, tierKey, region],
  );

  const cautionCountInScope = useMemo(
    () => inScope.filter((row) => row.signal === "caution").length,
    [inScope],
  );

  const shown = useMemo(() => inScope.filter((row) => showCaution || row.signal !== "caution"), [inScope, showCaution]);

  const regionCounts = useMemo(() => {
    const pool = data.rows.filter((row) => inTier(row));
    const count = (value: Region) => pool.filter((row) => row.region === value).length;
    return { all: pool.length, zh: count("zh"), en: count("en"), other: count("other") };
  }, [data.rows, tierKey]);

  const { ordered, rank } = useMemo(() => rankRows(shown, sort.metric, sort.dir), [shown, sort.metric, sort.dir]);

  // 计算用于表格数据条图形化展示的最大每千曝光值
  const maxPerK = useMemo(() => {
    const vals = ordered.map((r) => r.perK ?? 0);
    return Math.max(1, ...vals);
  }, [ordered]);

  // 「我的账号」在当前筛选下的真正排名（若无资格排名的行不显示为下标名次，避免 bug 2）
  const myRank = useMemo(() => {
    if (!mine) return null;
    return rank.get(mine) ?? null;
  }, [rank, mine]);

  const prevOrder = useMemo(() => {
    const pool = prevRows.filter((row) => inTier(row) && (region === "all" || row.region === region));
    return rankRows(pool, sort.metric, sort.dir).rank;
  }, [prevRows, tierKey, region, sort.metric, sort.dir]);

  const chips = useMemo(
    () =>
      data.rows
        .filter((row) => (region === "all" || row.region === region) && inTier(row) && row.signal !== "caution" && effEligible(row))
        .sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))
        .slice(0, 3),
    [data.rows, region, tierKey],
  );

  const enoughHistory = data.coverage.days >= window + 1;
  const regionLabel = region === "all" ? "全站" : REGION_LABEL[region];
  const filtersActive = tierKey !== "all" || showCaution;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6 space-y-4">
      <nav className="text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">涨粉榜</span>
      </nav>

      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">X 涨粉榜</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent font-semibold border border-accent/20">
          {regionLabel} · {label} · {METRIC_LABEL[sort.metric]}{sort.dir === "asc" ? "（升序）" : ""}
        </span>
        <p className="text-[13px] text-ink-3">中文 AI 圈 · 涨粉值不值得学</p>
        <div className="ml-auto flex flex-wrap gap-2 text-[12px]">
          <Link to="/x-people" className="text-ink-3 transition-colors hover:text-ink">博主列表</Link>
          <Link to="/x-people/weekly" className="text-ink-3 transition-colors hover:text-ink">涨粉周报</Link>
          <Link to="/x-people/methodology" className="text-ink-3 transition-colors hover:text-ink">方法论</Link>
        </div>
      </header>

      {/* 视觉升级：本期效率领奖台 Top 3 Podiums (突出重点，直观见效) */}
      {chips.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-1">
          {chips.map((row, idx) => {
            const isFirst = idx === 0;
            const isSecond = idx === 1;
            const rankLabel = isFirst ? "NO.1 效率领跑" : isSecond ? "NO.2 卓越效率" : "NO.3 标杆效率";
            const medalBg = isFirst
              ? "bg-accent text-accent-contrast shadow-xs"
              : isSecond
                ? "bg-bg-sunk text-ink font-bold border border-line-soft"
                : "bg-bg-sunk text-ink-2 font-bold border border-line-soft";
            const borderStyle = isFirst
              ? "border-accent/50 bg-accent-soft/25 ring-1 ring-accent/30 shadow-sm"
              : "border-line bg-surface shadow-xs hover:border-line-strong";

            return (
              <Link
                key={row.handle}
                to={`/x-people/${row.handle}`}
                className={`group relative flex flex-col justify-between rounded-card border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${borderStyle}`}
              >
                {/* 顶栏：领奖台标识 + 每千曝光核心指标 */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${medalBg}`}>
                    {isFirst ? <IconCrown size={13} className="shrink-0" /> : <IconTrophy size={12} className="shrink-0" />}
                    <span>{rankLabel}</span>
                  </span>
                  <div className="flex items-baseline gap-1 text-right">
                    <span className="text-[10.5px] text-ink-4 font-medium">每千曝光</span>
                    <span className="num font-black text-accent text-[15px] tracking-tight">
                      {row.perK != null ? `${row.perK >= 0 ? "+" : ""}${row.perK.toFixed(1)}` : "—"}
                    </span>
                  </div>
                </div>

                {/* 中栏：博主信息与头像 */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="relative shrink-0">
                    <SourceAvatar name={row.name ?? row.screenName} avatarUrl={row.avatarUrl} size={42} />
                    <span className={`absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center rounded-full text-[9px] font-black ${
                      isFirst ? "bg-accent text-accent-contrast shadow-xs" : "bg-bg-sunk text-ink-2 border border-line-soft"
                    }`}>
                      {idx + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-bold text-ink group-hover:text-accent transition-colors">
                        {row.name ?? row.screenName}
                      </span>
                      <span className="shrink-0 rounded-mark bg-bg-sunk px-1.5 py-0.2 text-[10px] text-ink-3">
                        {REGION_LABEL[row.region]}
                      </span>
                    </div>
                    <div className="num mt-0.5 truncate text-[11.5px] text-ink-3">
                      @{row.screenName} · {compact(row.followers)} 粉丝
                    </div>
                  </div>
                </div>

                {/* 底栏：曝光转化与周期产出 */}
                <div className="mt-3 border-t border-line-soft pt-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <div>
                      <span className="text-ink-4">{label}净增 </span>
                      <strong className={`num font-bold ${row.growth > 0 ? "text-accent" : "text-ink-3"}`}>
                        {signed(row.growth)}
                      </strong>
                      <span className="num text-[10.5px] text-ink-4 ml-1">({signedPercent(row.growthPct)})</span>
                    </div>
                    <div className="text-right text-ink-4">
                      <span>发帖 <b>{row.posts}</b> · 曝光 <b>{compact(row.views)}</b></span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 新鲜度 */}
      <p
        className={`rounded-card border px-3 py-1.5 text-[11.5px] leading-relaxed ${
          data.freshness.status === "normal"
            ? "border-line-soft bg-bg-sunk/60 text-ink-3"
            : "border-amber/30 bg-amber-soft text-amber-ink"
        }`}
      >
        <b className="mr-1.5">{data.freshness.label}</b>
        {data.freshness.note}
      </p>

      {/* 查我的账号 */}
      <MineSearchForm
        mine={mine}
        myRank={myRank}
        regionLabel={regionLabel}
        windowLabel={label}
        metricLabel={(METRIC_LABEL[sort.metric] ?? "每千曝光").replace(/^按/, "")}
        onSetMine={setMine}
      />

      {/* 看法切换分段控件：使用通用 PillTabs */}
      <div className="pt-1">
        <PillTabs
          layoutId="x-growth-views"
          size="sm"
          active={sort.metric}
          items={VIEWS.map((v) => ({ key: v.key, label: v.label }))}
          onSelect={(key) => setSort({ metric: key as Metric, dir: "desc" })}
        />
      </div>

      {/* 筛选条：窗口、地区、粉丝门槛 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <PillTabs
          layoutId="x-growth-windows"
          size="xs"
          active={String(window)}
          items={WINDOWS.map((v) => ({ key: String(v), label: `${v} 天` }))}
          onSelect={(v) => setWindow(Number(v) as Window)}
        />
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <PillTabs
          layoutId="x-growth-regions"
          size="xs"
          active={region}
          items={REGIONS.map((v) => ({
            key: v,
            label: v === "all" ? "全部地区" : REGION_LABEL[v],
            count: regionCounts[v],
          }))}
          onSelect={(v) => setRegion(v as Region | "all")}
        />
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className={`ml-auto flex min-h-[32px] items-center gap-1 rounded-full border px-3 py-0.5 text-[11.5px] transition-colors ${
            filtersActive ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-ink-3 hover:text-ink"
          }`}
          aria-expanded={filtersOpen}
        >
          <IconFilter size={12} className="shrink-0" />
          <span>筛选{filtersActive ? " ·" : ""}</span>
          <span className="text-[10px]">{filtersOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-line-soft bg-bg-sunk/40 p-2.5">
          <span className="text-[11.5px] text-ink-4 mr-1">粉丝规模:</span>
          {TIERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTierKey(option.key)}
              className={`min-h-[28px] rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${
                tierKey === option.key ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-ink-3 hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
          <label className="ml-2 flex min-h-[28px] cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-3 hover:text-ink">
            <input type="checkbox" checked={showCaution} onChange={(event) => setShowCaution(event.target.checked)} className="size-3.5 rounded-mark" />
            显示需核对 {cautionCountInScope > 0 && !showCaution && <span className="text-ink-4">（已隐 {cautionCountInScope} 个）</span>}
          </label>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-surface p-5 text-[13px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">{regionLabel}{tierKey !== "all" ? `「${tier.label}」` : ""}的 {label} 榜暂时没有可排行的账号。</p>
          <p className="mt-1.5">
            {data.coverage.accounts === 0
              ? "粉丝快照还在积累：部署后的几分钟里，后台会把采集回执里过去 30 天的粉丝数补进来。"
              : enoughHistory
                ? "换一个地区或粉丝门槛看看；也可能这批账号最近没有新帖子，没有新快照就没有涨粉，或者需核对的都被藏起来了。"
                : `快照从 ${data.coverage.since ?? "今天"} 开始，才积累了 ${data.coverage.days} 天；要比较 ${label}的变化，至少需要 ${label}之前就有一个快照。`}
          </p>
        </div>
      ) : (
        <>
          {/* 手机端的轻量级卡片流（lg:hidden） */}
          <div className="mt-2.5 space-y-2 lg:hidden">
            {ordered.map((row) => {
              const signal = row.signal ? signalMap[row.signal] : null;
              const rankNow = rank.get(row.handle);
              const rankPrev = prevOrder.get(row.handle) ?? null;
              const efficiency = sort.metric === "perK" || sort.metric === "perPost";
              const eligible = !efficiency || effEligible(row);
              const isMine = mine !== null && row.handle.toLowerCase() === mine;
              return (
                <Link
                  key={row.handle}
                  to={`/x-people/${row.handle}`}
                  className={`block rounded-card border bg-surface px-3 py-2.5 transition-colors active:bg-bg-sunk ${
                    isMine ? "border-accent bg-accent-soft/20 ring-1 ring-accent-soft" : "border-line"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="num flex w-8 shrink-0 flex-col items-center justify-center gap-0.5 text-center">
                      {rankNow === 1 ? (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-black text-accent-contrast shadow-xs">1</span>
                      ) : rankNow === 2 ? (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-bg-sunk text-[10px] font-bold text-ink border border-line-soft">2</span>
                      ) : rankNow === 3 ? (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-bg-sunk text-[10px] font-bold text-ink-2 border border-line-soft">3</span>
                      ) : (
                        <span className="font-bold font-mono text-[12px] text-ink-4">{rankNow ?? "—"}</span>
                      )}
                      {rankNow && (
                        rankPrev === null ? (
                          <span className="rounded-mark bg-accent px-1 text-[8.5px] font-bold text-accent-contrast">NEW</span>
                        ) : rankPrev - rankNow === 0 ? null : rankPrev > rankNow ? (
                          <span className="inline-flex items-center gap-0.2 rounded-full bg-accent-soft px-1 text-[9px] font-bold text-accent">
                            <IconTrendingUp size={9} className="shrink-0 stroke-[2.2]" />
                            <span>+{rankPrev - rankNow}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.2 rounded-full bg-bg-sunk px-1 text-[9px] font-medium text-ink-4">
                            <IconTrendingDown size={9} className="shrink-0 stroke-[2.2]" />
                            <span>−{rankNow - rankPrev}</span>
                          </span>
                        )
                      )}
                    </div>
                    <SourceAvatar name={row.name ?? row.screenName} avatarUrl={row.avatarUrl} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold text-ink">{row.name ?? row.screenName}</span>
                      <span className="num block truncate text-[11px] text-ink-3">@{row.screenName} · {REGION_LABEL[row.region]}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`num block text-[16px] font-black leading-tight ${eligible ? "text-accent" : "text-ink-4"}`}>
                        {row.perK === null ? "—" : row.perK.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-ink-4">每千曝光</span>
                    </span>
                  </div>
                  <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[46px] text-[11.5px] text-ink-3">
                    <span className={tint(row.growth)}>{signed(row.growth)} 粉</span>
                    <span>{signedPercent(row.growthPct)}</span>
                    <span>{row.posts} 帖</span>
                    <span>{row.perPost === null ? "" : `每帖 ${signed(row.perPost)}`}</span>
                    <span className="text-ink-4">{compact(row.followers)} 粉</span>
                  </div>
                  {(signal || (efficiency && !eligible)) && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-[46px]">
                      {signal && <span className={`rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] ${signal.tone}`}>{signal.label}</span>}
                      {efficiency && !eligible && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] text-ink-4">样本小</span>}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {/* 桌面端：标准表格（hidden lg:block）带进度条与高亮 */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface lg:block shadow-sm">
            <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
              <caption className="sr-only">X 创作者涨粉榜单，默认按每千曝光效率排序</caption>
              <thead>
                <tr className="border-b border-line bg-bg-sunk/40 text-[12px] text-ink-3">
                  <th scope="col" className="w-24 px-3 py-2.5 font-normal"># 排名</th>
                  <th scope="col" className="px-3 py-2.5 font-normal">账号</th>
                  <th scope="col" aria-sort={ariaSort("followers")} className="px-3 py-2.5 text-right font-normal">
                    <SortHead label="粉丝" metric="followers" sort={sort} onSort={onSort} />
                  </th>
                  <th scope="col" aria-sort={ariaSort("growth") ?? ariaSort("growthPct")} className="px-3 py-2.5 text-right font-normal">
                    <span className="inline-flex items-center gap-1">
                      <SortHead label="涨粉" metric="growth" sort={sort} onSort={onSort} />
                      <span className="text-ink-4">/</span>
                      <SortHead label="率" metric="growthPct" sort={sort} onSort={onSort} />
                    </span>
                  </th>
                  <th scope="col" aria-sort={ariaSort("posts")} className="px-3 py-2.5 text-right font-normal">
                    <SortHead label="帖" metric="posts" sort={sort} onSort={onSort} />
                  </th>
                  <th scope="col" aria-sort={ariaSort("perPost")} className="px-3 py-2.5 text-right font-normal">
                    <SortHead label="每帖" metric="perPost" sort={sort} onSort={onSort} />
                  </th>
                  <th scope="col" aria-sort={ariaSort("perK")} className="px-3 py-2.5 text-right font-normal w-44">
                    <SortHead label="每千曝光" metric="perK" sort={sort} onSort={onSort} />
                  </th>
                  <th scope="col" className="w-20 px-3 py-2.5 font-normal">标签</th>
                  <th scope="col" className="w-16 whitespace-nowrap px-3 py-2.5 text-right font-normal">数据日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {ordered.map((row) => {
                  const signal = row.signal ? signalMap[row.signal] : null;
                  const rankNow = rank.get(row.handle);
                  const rankPrev = prevOrder.get(row.handle) ?? null;
                  const efficiency = sort.metric === "perK" || sort.metric === "perPost";
                  const eligible = !efficiency || effEligible(row);
                  const active = sort.metric;
                  const isMine = mine !== null && row.handle.toLowerCase() === mine;
                  const barPct = row.perK != null && row.perK > 0 ? Math.min(100, Math.round((row.perK / maxPerK) * 100)) : 0;
                  return (
                    <tr key={row.handle} className={`transition-colors hover:bg-bg-sunk ${isMine ? "bg-accent-soft/40 border-l-4 border-accent font-medium" : rankNow === 1 ? "bg-accent-soft/10" : ""}`}>
                      <td className="num px-3 py-2.5 text-[12px] text-ink-4">
                        <div className="flex items-center gap-2">
                          {rankNow === 1 ? (
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-black text-accent-contrast shadow-xs">1</span>
                          ) : rankNow === 2 ? (
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-sunk text-[11px] font-bold text-ink border border-line-soft">2</span>
                          ) : rankNow === 3 ? (
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-sunk text-[11px] font-bold text-ink-2 border border-line-soft">3</span>
                          ) : (
                            <span className="inline-flex size-6 items-center justify-center font-mono text-[12px] font-medium text-ink-4">{rankNow ?? "—"}</span>
                          )}
                          {rankNow && (
                            rankPrev === null ? (
                              <span className="inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[9.5px] font-bold text-accent-contrast shadow-xs" title="上周期未入榜，本期新晋上榜">
                                NEW
                              </span>
                            ) : rankPrev - rankNow === 0 ? (
                              <span className="inline-flex w-6 justify-center text-[11px] text-ink-4 font-mono" title="名次与上期持平">—</span>
                            ) : rankPrev > rankNow ? (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-bold text-accent"
                                title={`较上周期上升 ${rankPrev - rankNow} 名（上期第 ${rankPrev} 名）`}
                              >
                                <IconTrendingUp size={11} className="shrink-0 stroke-[2.2]" />
                                <span>+{rankPrev - rankNow}</span>
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full border border-line-soft bg-bg-sunk px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-4"
                                title={`较上周期下降 ${rankNow - rankPrev} 名（上期第 ${rankPrev} 名）`}
                              >
                                <IconTrendingDown size={11} className="shrink-0 stroke-[2.2]" />
                                <span>−{rankNow - rankPrev}</span>
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      {/* 名字是 nowrap，表格的 min-content 会被最长的一行撑到 1000px 以上，把「数据日」挤出可视区；给这一列封个顶。 */}
                      <td className="max-w-[290px] px-3 py-2.5">
                        <Link to={`/x-people/${row.handle}`} className="flex items-center gap-3">
                          <SourceAvatar name={row.name ?? row.screenName} avatarUrl={row.avatarUrl} size={36} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-bold text-ink">
                              {row.name ?? row.screenName}
                              {isMine && <span className="ml-1.5 text-[10px] px-1 rounded-mark bg-accent text-accent-contrast">ME</span>}
                            </span>
                            <span className="num block truncate text-[11.5px] text-ink-3">@{row.screenName} · {REGION_LABEL[row.region]}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={`num px-3 py-2.5 text-right ${active === "followers" ? "font-semibold text-ink" : "text-ink-2"}`} title={`基线 ${row.baseline.toLocaleString("en-US")}（${row.spanDays} 天前）`}>
                        {compact(row.followers)}
                      </td>
                      <td className={`num px-3 py-2.5 text-right ${active === "growth" || active === "growthPct" ? "font-semibold" : ""}`}>
                        <span className={tint(row.growth)}>{signed(row.growth)}</span>
                        <span className={`ml-1 text-[11px] ${tint(row.growthPct)}`}>{signedPercent(row.growthPct)}</span>
                      </td>
                      <td className={`num px-3 py-2.5 text-right ${active === "posts" ? "font-semibold text-ink" : "text-ink-2"}`} title={`同期浏览合计 ${row.views.toLocaleString("en-US")}`}>{row.posts}</td>
                      <td className={`num px-3 py-2.5 text-right ${active === "perPost" ? "font-semibold text-ink" : "text-ink-3"}`}>{row.perPost === null ? "—" : signed(row.perPost)}</td>
                      
                      {/* 每千曝光带微型进度条，数据一目了然！ */}
                      <td className="num px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {eligible && row.perK != null && (
                            <span className="w-16 h-1.5 rounded-full bg-bg-sunk overflow-hidden hidden sm:block">
                              <span className="block h-full bg-accent rounded-full" style={{ width: `${barPct}%` }} />
                            </span>
                          )}
                          <span className={`font-bold ${active === "perK" ? "text-accent" : eligible ? "text-ink" : "text-ink-4"}`}>
                            {row.perK === null ? "—" : row.perK.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {signal && <span className={`whitespace-nowrap rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] ${signal.tone}`} title={signal.title}>{signal.label}</span>}
                          {efficiency && !eligible && (
                            <span className="whitespace-nowrap rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] text-ink-4" title={`窗口内曝光不足 ${EFF_MIN_VIEWS.toLocaleString("en-US")} 次或没有发帖：分母太小，不进效率名次`}>
                              样本小
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right text-[12px] text-ink-4" title={row.updatedOn}>{row.updatedOn.slice(5)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 说明区 */}
      <div className="mt-4 rounded-card border border-line-soft bg-bg-sunk/60 p-4 text-[12px] leading-relaxed text-ink-3">
        <p>
          共 {data.coverage.accounts} 个账号有粉丝快照，{label}榜里 {data.coverage.eligible} 个账号有两次相隔 {window} 天以上的快照；
          当前筛选（{regionLabel}{tierKey !== "all" ? ` · 粉丝 ${tier.label}` : ""}{showCaution ? " · 含需核对" : ` · 已隐藏 ${cautionCountInScope} 个需核对`}）下 {shown.length} 个。
          {data.coverage.latest && <> 最近一次快照 {beijingDay(data.coverage.latest)}。</>}
        </p>
        <p className="mt-2">
          名次是<b>筛后重排</b>的：换地区、粉丝门槛或排序，名次会跟着变；箭头是同一筛选下和上一对应周期比。
          上面三个按钮是三种常用看法（效率榜 / 涨粉数榜 / 涨粉率榜），点表头还能按粉丝、帖数、每帖排（再点一次换方向）。
          效率榜只有窗口内曝光 ≥ {EFF_MIN_VIEWS.toLocaleString("en-US")} 次且发过帖的行参与名次，
          其余标「样本小」——分母太小时效率会虚高，看起来像黑马，其实只是没人看到。
        </p>
        <p className="mt-2">
          涨粉 = 最近快照 − {label}之外最近的一次快照，基线更早时按天数折算到 {label}；粉丝快照跟着采集走，不发帖就没有新快照。
          「本期无发帖」说明这 {window} 天没抓到它的帖子，涨粉只能来自外部；「需核对」表示涨粉远高于曝光或 {window} 日涨跌幅超过 30%，
          可能是一次站外传播、抽奖或买粉，建议核对，不是定论。
        </p>
      </div>
      <p className="mt-4 text-[11.5px] text-ink-4">数据截至 {stamp(data.generatedAt)}（北京时间），每 5 分钟从采集回执里更新一次。</p>
    </div>
  );
}
