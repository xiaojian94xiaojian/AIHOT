// X 涨粉榜（工具默认页）：中文 AI 圈里谁在涨、涨得值不值得学。
// 粉丝数只出现在采集回执里，后端每五分钟把新回执记成当天的快照（backend/followers.ts），
// 这里把两个窗口一起取回来，切换只改显示。名次按当前筛选重排；箭头和「上周同一筛选」比。
// 排序在表头上（数据站的通用心智），地区与窗口常驻，粉丝门槛与「显示需核对」收进筛选。
import { useEffect, useMemo, useState } from "react";
import { Link, useLoaderData, useSearchParams, type ShouldRevalidateFunction } from "react-router";
import type { Region, XGrowthPrevRow, XGrowthResponse, XGrowthRow } from "../types";
import { REGION_LABEL } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { beijingDay } from "@aihot/contracts/time";
import { compact, stamp } from "./format";
import { SubscribeButton } from "./subscribe";

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
 * 涨粉榜的数据不依赖查询参数（?mine= 只在客户端查），同路径导航不必重跑 loader：
 * 否则每次输入「我的账号」都要等一次 SSR 请求。
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
  currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;
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

/** 带正负号的数：涨粉数用「万」，小的保留千分位。 */
function signed(n: number): string {
  if (!n) return "0";
  return `${n > 0 ? "+" : "-"}${compact(Math.abs(n))}`;
}
const signedPercent = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1).replace(/\.0$/, "")}%`;
const tint = (n: number) => (n > 0 ? "text-accent" : "text-ink-3");

const SIGNAL: Record<NonNullable<XGrowthRow["signal"]>, { label: string; title: string; tone: string }> = {
  quiet: { label: "本期无发帖", title: "这一周没抓到它的帖子：涨粉只能来自外部事件、产品发布或其他渠道，无法用内容解释。", tone: "text-ink-4" },
  thin: { label: "发帖少", title: "这一周只有 1–2 条帖子，样本太少，看不出内容与涨粉的关系。", tone: "text-ink-4" },
  caution: {
    label: "需核对",
    title: "涨粉远高于同期曝光，或一周涨跌幅超过 30%：可能是一次站外传播、抽奖或买粉，建议核对，不是定论。",
    tone: "text-amber",
  },
};

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

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12.5px] transition-colors ${active ? "bg-ink text-bg" : "bg-bg-sunk text-ink-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Avatar({ row }: { row: XGrowthRow }) {
  return row.avatarUrl ? (
    <img src={row.avatarUrl} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-full bg-bg-sunk object-cover" />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg-sunk text-[13px] text-ink-3">{(row.name ?? row.screenName).slice(0, 1)}</span>
  );
}

/** 表头里的排序按钮：点一次按这一列排，再点一次换方向。 */
function SortHead({ label, metric, sort, onSort, align = "right" }: { label: string; metric: Metric; sort: { metric: Metric; dir: Dir }; onSort: (metric: Metric) => void; align?: "left" | "right" }) {
  const active = sort.metric === metric;
  return (
    <button
      type="button"
      onClick={() => onSort(metric)}
      title={`按${label}排序（再点一次换方向）`}
      className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end" : ""} ${active ? "font-semibold text-accent" : "hover:text-ink"}`}
    >
      {label}
      <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`}>{sort.dir === "desc" ? "↓" : "↑"}</span>
    </button>
  );
}

export default function GrowthPage() {
  const { seven, thirty } = useLoaderData<typeof loader>();
  const [window, setWindow] = useState<Window>(7);
  const [sort, setSort] = useState<{ metric: Metric; dir: Dir }>({ metric: "perK", dir: "desc" });
  const [region, setRegion] = useState<Region | "all">("zh");
  const [tierKey, setTierKey] = useState("all");
  const [showCaution, setShowCaution] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const data = window === 7 ? seven : thirty;
  const label = window === 7 ? "7 日" : "30 日";

  // 「我的账号」：?mine=handle 就是身份，不用登录；查本地库看有没有收录，没有就提交申请。
  const [params, setParams] = useSearchParams();
  const mine = (params.get("mine") ?? "").replace(/^@/, "").toLowerCase() || null;
  const [mineInput, setMineInput] = useState(mine ?? "");
  const [mineState, setMineState] = useState<null | { tracked: boolean; path: string | null; request: string | null }>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    if (!mine) { setMineState(null); setApplied(null); return; }
    let alive = true;
    fetch(`/api/site/x-people/lookup?handle=${encodeURIComponent(mine)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (alive && body) setMineState(body); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [mine]);
  const setMine = (handle: string) => {
    const next = new URLSearchParams(params);
    if (handle) next.set("mine", handle);
    else next.delete("mine");
    setParams(next, { replace: true });
  };
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
  const shown = useMemo(() => inScope.filter((row) => showCaution || row.signal !== "caution"), [inScope, showCaution]);
  const regionCounts = useMemo(() => {
    const pool = data.rows.filter((row) => inTier(row));
    const count = (value: Region) => pool.filter((row) => row.region === value).length;
    return { all: pool.length, zh: count("zh"), en: count("en"), other: count("other") };
  }, [data.rows, tierKey]);

  const { ordered, rank } = useMemo(() => rankRows(shown, sort.metric, sort.dir), [shown, sort.metric, sort.dir]);
  // 「我的账号」在当前筛选下的名次（不在筛选里就是 null）。
  const myRank = useMemo(() => {
    if (!mine) return null;
    const index = ordered.findIndex((row) => row.handle.toLowerCase() === mine);
    return index >= 0 ? index + 1 : null;
  }, [ordered, mine]);
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
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">涨粉榜</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">X 涨粉榜</h1>
        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[12px] text-accent">
          {regionLabel} · {label} · {METRIC_LABEL[sort.metric]}{sort.dir === "asc" ? "（升序）" : ""}
        </span>
        <p className="text-[13px] text-ink-3">中文 AI 圈 · 涨粉值不值得学</p>
        <div className="ml-auto flex flex-wrap gap-2 text-[12px]">
          <Link to="/x-people" className="text-ink-3 transition-colors hover:text-ink">博主列表</Link>
          <Link to="/x-people/growth/report" className="text-ink-3 transition-colors hover:text-ink">本周观察</Link>
          <Link to="/x-people/methodology" className="text-ink-3 transition-colors hover:text-ink">方法论</Link>
        </div>
      </header>

      {/* 新鲜度：先说清这是哪天的数、覆盖多少天，再让人看榜。 */}
      <p
        className={`mt-2 rounded-card border px-3 py-1.5 text-[11.5px] leading-relaxed ${
          data.freshness.status === "normal"
            ? "border-line-soft bg-bg-sunk/60 text-ink-3"
            : "border-amber-500/30 bg-amber-500/[0.06] text-ink-2"
        }`}
      >
        <b className="mr-1.5">{data.freshness.label}</b>
        {data.freshness.note}
      </p>

      {/* 查我的账号：?mine=handle 就是身份，不登录也能收藏这个链接；没收录可以直接申请。 */}
      <div className="mt-2.5 flex flex-col gap-2 rounded-card border border-line bg-surface px-3 py-2 sm:flex-row sm:items-center">
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            setMine(mineInput.trim().replace(/^@/, "").toLowerCase());
          }}
        >
          <span className="text-[12.5px] text-ink-3">查我的账号</span>
          <span className="flex min-w-0 items-center rounded-full border border-line px-2">
            <span className="text-[13px] text-ink-4">@</span>
            <input
              value={mineInput}
              onChange={(event) => setMineInput(event.target.value)}
              placeholder="your_handle"
              aria-label="你的 X 账号"
              className="num h-7 w-36 min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
            />
          </span>
          <button type="submit" className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent">
            查一下
          </button>
          {mine && (
            <button type="button" onClick={() => { setMine(""); setMineInput(""); }} className="text-[12px] text-ink-4 transition-colors hover:text-ink-2">
              清除
            </button>
          )}
        </form>
        {mine && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            {mineState === null ? (
              <span className="text-ink-4">查询中…</span>
            ) : mineState.tracked ? (
              <>
                <span className="text-ok">已收录</span>
                {myRank !== null && <span className="text-ink-3">当前筛选下第 <b className="num text-ink">{myRank}</b> 名</span>}
                <Link prefetch="intent" to={`/x-people/${mine}`} className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-accent">
                  看我的画像 →
                </Link>
                <SubscribeButton handle={mine} label="订阅周报" className="text-ink-3 underline-offset-2 hover:text-ink hover:underline" />
              </>
            ) : applied === "tracked" ? (
              <span className="text-ok">已收录</span>
            ) : applied === "pending" || mineState.request === "pending" ? (
              <span className="text-ink-3">已提交，等审核；通过后会出现在榜单和画像里。</span>
            ) : applied ? (
              <span className="text-ink-3">{applied}</span>
            ) : mineState.request === "rejected" ? (
              <span className="text-ink-4">之前的申请没通过，可以补一句介绍再提交。</span>
            ) : (
              <>
                <span className="text-ink-3">还没收录</span>
                <button type="button" onClick={applyForMine} disabled={applying} className="rounded-full bg-ink px-2.5 py-0.5 text-bg disabled:opacity-60">
                  {applying ? "提交中…" : "申请收录"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 看法切换单独一行，做成分段控件：手机上三等分，桌面上靠左排。 */}
      <div className="mt-3 flex w-full rounded-full bg-bg-sunk p-1 sm:w-auto sm:inline-flex">
        {VIEWS.map((view) => {
          const active = sort.metric === view.key;
          return (
            <button
              key={view.key}
              type="button"
              onClick={() => setSort({ metric: view.key, dir: "desc" })}
              aria-pressed={active}
              className={`flex-1 rounded-full px-5 py-1.5 text-[13.5px] transition-colors sm:flex-none ${active ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-3 hover:text-ink"}`}
            >
              {view.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {WINDOWS.map((value) => (
          <Pill key={value} active={window === value} onClick={() => setWindow(value)}>{value} 天</Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        {REGIONS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRegion(value)}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${region === value ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-3 hover:text-ink"}`}
          >
            {value === "all" ? "全部地区" : REGION_LABEL[value]}
            <span className="num ml-1 text-[10.5px] text-ink-4">{regionCounts[value]}</span>
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${filtersActive ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-3 hover:text-ink"}`}
          aria-expanded={filtersOpen}
        >
          筛选{filtersActive ? " ·" : ""} {filtersOpen ? "▴" : "▾"}
        </button>
      </div>

      {filtersOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-card border border-line-soft bg-bg-sunk/40 px-2.5 py-2">
          {TIERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTierKey(option.key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${tierKey === option.key ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-3 hover:text-ink"}`}
            >
              {option.label}
            </button>
          ))}
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-3">
            <input type="checkbox" checked={showCaution} onChange={(event) => setShowCaution(event.target.checked)} className="size-3.5" />
            显示需核对
          </label>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-card border border-accent/25 bg-accent/5 px-3 py-2">
          <span className="text-[12px] font-medium text-accent">本周效率信号</span>
          <span className="hidden text-[12.5px] text-ink-2 sm:inline">{label}每千曝光涨粉最高的三个账号，值得先拆：</span>
          {chips.map((row) => (
            <Link
              key={row.handle}
              to={`/x-people/${row.handle}`}
              className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] text-ink hover:border-accent hover:text-accent"
            >
              {row.name ?? row.screenName} · {row.perK}/千曝光
            </Link>
          ))}
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
          {/* 手机：卡片列表，一屏能读完账号和效率，不用横滑。 */}
          <div className="mt-2.5 space-y-2 md:hidden">
            {ordered.map((row) => {
              const signal = row.signal ? SIGNAL[row.signal] : null;
              const rankNow = rank.get(row.handle);
              const rankPrev = prevOrder.get(row.handle) ?? null;
              const efficiency = sort.metric === "perK" || sort.metric === "perPost";
              const eligible = !efficiency || effEligible(row);
              const isMine = mine !== null && row.handle.toLowerCase() === mine;
              return (
                <Link key={row.handle} to={`/x-people/${row.handle}`} className={`block rounded-card border bg-surface px-3 py-2.5 transition-colors active:bg-bg-sunk ${isMine ? "border-accent ring-1 ring-accent/30" : "border-line"}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="num w-7 shrink-0 pt-1 text-[12px] text-ink-4">
                      {rankNow ?? "—"}
                      {rankNow && (rankPrev === null ? (
                        <span className="ml-0.5 text-[10px] text-accent">新</span>
                      ) : rankPrev - rankNow === 0 ? null : (
                        <span className={`ml-0.5 text-[10px] ${rankPrev > rankNow ? "text-accent" : "text-ink-3"}`}>
                          {rankPrev > rankNow ? "▲" : "▼"}{Math.abs(rankPrev - rankNow)}
                        </span>
                      ))}
                    </span>
                    <Avatar row={row} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">{row.name ?? row.screenName}</span>
                      <span className="num block truncate text-[11.5px] text-ink-3">@{row.screenName} · {REGION_LABEL[row.region]}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`num block text-[15px] font-semibold leading-tight ${eligible ? "text-accent" : "text-ink-4"}`}>
                        {row.perK === null ? "—" : row.perK.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-ink-4">每千曝光</span>
                    </span>
                  </div>
                  <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[38px] text-[11.5px] text-ink-3">
                    <span className={tint(row.growth)}>{signed(row.growth)} 粉</span>
                    <span>{signedPercent(row.growthPct)}</span>
                    <span>{row.posts} 帖</span>
                    <span>{row.perPost === null ? "" : `每帖 +${compact(row.perPost)}`}</span>
                    <span className="text-ink-4">{compact(row.followers)} 粉</span>
                  </div>
                  {(signal || (efficiency && !eligible)) && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-[38px]">
                      {signal && <span className={`rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] ${signal.tone}`}>{signal.label}</span>}
                      {efficiency && !eligible && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] text-ink-4">样本小</span>}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {/* 桌面：表格，列多但一屏能横向扫完。 */}
          <div className="mt-2.5 hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
            <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-3">
                  <th className="w-16 px-3 py-2.5 font-normal">#</th>
                  <th className="px-3 py-2.5 font-normal">账号</th>
                  <th className="px-3 py-2.5 text-right font-normal"><SortHead label="粉丝" metric="followers" sort={sort} onSort={onSort} /></th>
                  <th className="px-3 py-2.5 text-right font-normal">
                    <span className="inline-flex items-center gap-1">
                      <SortHead label="涨粉" metric="growth" sort={sort} onSort={onSort} />
                      <span className="text-ink-4">/</span>
                      <SortHead label="率" metric="growthPct" sort={sort} onSort={onSort} />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right font-normal"><SortHead label="帖" metric="posts" sort={sort} onSort={onSort} /></th>
                  <th className="px-3 py-2.5 text-right font-normal"><SortHead label="每帖" metric="perPost" sort={sort} onSort={onSort} /></th>
                  <th className="px-3 py-2.5 text-right font-normal"><SortHead label="每千曝光" metric="perK" sort={sort} onSort={onSort} /></th>
                  <th className="px-3 py-2.5 font-normal">标签</th>
                  <th className="px-3 py-2.5 text-right font-normal">数据日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
              {ordered.map((row) => {
                const signal = row.signal ? SIGNAL[row.signal] : null;
                const rankNow = rank.get(row.handle);
                const rankPrev = prevOrder.get(row.handle) ?? null;
                const efficiency = sort.metric === "perK" || sort.metric === "perPost";
                const eligible = !efficiency || effEligible(row);
                const active = sort.metric;
                const isMine = mine !== null && row.handle.toLowerCase() === mine;
                return (
                  <tr key={row.handle} className={`transition-colors hover:bg-bg-sunk ${isMine ? "bg-accent/5" : ""}`}>
                    <td className="num px-3 py-2.5 text-[12px] text-ink-4" title={rankPrev === null ? "上周同一筛选下不在榜上" : `上周同一筛选下第 ${rankPrev} 名`}>
                      {rankNow ?? "—"}
                      {rankNow && (rankPrev === null ? (
                        <span className="ml-0.5 text-[10px] text-accent">新</span>
                      ) : rankPrev - rankNow === 0 ? (
                        <span className="ml-0.5 text-[10px] text-ink-4">—</span>
                      ) : (
                        <span className={`ml-0.5 text-[10px] ${rankPrev > rankNow ? "text-accent" : "text-ink-3"}`}>
                          {rankPrev > rankNow ? "▲" : "▼"}{Math.abs(rankPrev - rankNow)}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link prefetch="intent" to={`/x-people/${row.handle}`} className="flex items-center gap-3">
                        <Avatar row={row} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-ink">{row.name ?? row.screenName}</span>
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
                    <td className={`num px-3 py-2.5 text-right ${active === "perPost" ? "font-semibold text-ink" : "text-ink-3"}`}>{row.perPost === null ? "—" : `+${compact(row.perPost)}`}</td>
                    <td className={`num px-3 py-2.5 text-right ${active === "perK" ? "font-semibold text-ink" : eligible ? "text-ink-3" : "text-ink-4"}`}>
                      {row.perK === null ? "—" : row.perK.toFixed(1)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {signal && <span className={`rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] ${signal.tone}`} title={signal.title}>{signal.label}</span>}
                        {efficiency && !eligible && (
                          <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] text-ink-4" title={`窗口内曝光不足 ${EFF_MIN_VIEWS.toLocaleString("en-US")} 次或没有发帖：分母太小，不进效率名次`}>
                            样本小
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num px-3 py-2.5 text-right text-[12px] text-ink-4" title={row.updatedOn}>{row.updatedOn.slice(5)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      <div className="mt-4 rounded-card border border-line-soft bg-bg-sunk/60 p-4 text-[12px] leading-relaxed text-ink-3">
        <p>
          共 {data.coverage.accounts} 个账号有粉丝快照，{label}榜里 {data.coverage.eligible} 个账号有两次相隔 {window} 天以上的快照；
          当前筛选（{regionLabel}{tierKey !== "all" ? ` · 粉丝 ${tier.label}` : ""}{showCaution ? " · 含需核对" : " · 隐藏需核对"}）下 {shown.length} 个。
          {data.coverage.latest && <> 最近一次快照 {beijingDay(data.coverage.latest)}。</>}
        </p>
        <p className="mt-2">
          名次是<b>筛后重排</b>的：换地区、粉丝门槛或排序，名次会跟着变；箭头是同一筛选下和上周比。
          上面三个按钮是三种常用看法（效率榜 / 涨粉数榜 / 涨粉率榜），点表头还能按粉丝、帖数、每帖排（再点一次换方向）。
          效率榜只有窗口内曝光 ≥ {EFF_MIN_VIEWS.toLocaleString("en-US")} 次且发过帖的行参与名次，
          其余标「样本小」——分母太小时效率会虚高，看起来像黑马，其实只是没人看到。
        </p>
        <p className="mt-2">
          涨粉 = 最近快照 − {label}之外最近的一次快照，基线更早时按天数折算到 {label}；粉丝快照跟着采集走，不发帖就没有新快照。
          「本期无发帖」说明这一周没抓到它的帖子，涨粉只能来自外部；「需核对」表示涨粉远高于曝光或一周涨跌幅超过 30%，
          可能是一次站外传播、抽奖或买粉，建议核对，不是定论。
        </p>
      </div>
      <p className="mt-4 text-[11.5px] text-ink-4">数据截至 {stamp(data.generatedAt)}（北京时间），每 5 分钟从采集回执里更新一次。</p>
    </div>
  );
}
