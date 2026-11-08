// 博主列表：先按语言区（中文/英文/其他）分，再按账号类型（官方、创始人、研究者、媒体、开发者）筛；
// 点进每个人看多维画像。筛选同步到 URL，方便分享。
import { Link, useLoaderData, useSearchParams } from "react-router";
import { useMemo, useState } from "react";
import type { PersonKind, Region, XPeopleResponse } from "../types";
import { CATEGORY_LABEL, KIND_LABEL, REGION_LABEL } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { IconSearch } from "@aihot/web/components/icons";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
import { PillTabs } from "@aihot/web/components/ui/Tabs";
import { categoryName, compact, percent, stamp } from "./format";

export async function loader({ request }: { request: Request }) {
  return loadOr404<XPeopleResponse>("/api/site/x-people", { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "博主画像",
    description: "按账号汇总本站采集的 X 数据：发帖节奏、互动表现与内容结构，按中文区/英文区与账号类型分类。",
    path: "/x-people",
  });
}

export const { clientLoader, shouldRevalidate } = pageReuse<Awaited<ReturnType<typeof loader>>>(() => "/x-people");

export function headers() {
  return edgeTtl(600);
}

/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "博主画像" } as const;

type SortKey = "posts" | "postsPerDay" | "medViews" | "engagementRate" | "followers";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "followers", label: "粉丝" },
  { key: "posts", label: "发帖" },
  { key: "postsPerDay", label: "日均" },
  { key: "medViews", label: "中位浏览" },
  { key: "engagementRate", label: "互动率" },
];

const REGIONS: Array<Region | "all"> = ["all", "zh", "en", "other"];
const KINDS: Array<PersonKind | "all"> = ["all", "official", "founder", "researcher", "media", "builder", "other"];

export default function PeoplePage() {
  const { people, totals, generatedAt } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "medViews", dir: -1 });

  const rawRegion = params.get("region");
  const rawKind = params.get("kind");
  const region: Region | "all" = REGIONS.includes(rawRegion as Region) ? (rawRegion as Region) : "all";
  const kind: PersonKind | "all" = KINDS.includes(rawKind as PersonKind) ? (rawKind as PersonKind) : "all";

  const setParam = (key: "region" | "kind", value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const inRegion = region === "all" ? people : people.filter((p) => p.region === region);
  const regionCounts = useMemo(() => {
    const count = (value: Region) => people.filter((p) => p.region === value).length;
    return { all: people.length, zh: count("zh"), en: count("en"), other: count("other") };
  }, [people]);
  const kindCounts = useMemo(() => {
    const count = (value: PersonKind) => inRegion.filter((p) => p.kind === value).length;
    return { all: inRegion.length, official: count("official"), founder: count("founder"), researcher: count("researcher"), media: count("media"), builder: count("builder"), other: count("other") };
  }, [inRegion]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = people
      .filter((p) => region === "all" || p.region === region)
      .filter((p) => kind === "all" || p.kind === kind)
      .filter((p) => !needle || p.handle.toLowerCase().includes(needle) || p.author.toLowerCase().includes(needle));
    return [...filtered].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      // 粉丝为 null 时恒排末尾
      if (sort.key === "followers") {
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
      }
      return ((va ?? 0) - (vb ?? 0)) * sort.dir;
    });
  }, [people, region, kind, query, sort]);

  const toggle = (key: SortKey) => setSort((current) => current.key === key ? { key, dir: current.dir === -1 ? 1 : -1 } : { key, dir: -1 });

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">博主画像</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          本站采集的 X 账号数据，按人汇总：发帖节奏、互动表现与内容结构。先分中文区与英文区，再按账号类型筛选；
          互动数是采集那一刻的快照，适合横向比较。共 {totals.people} 个账号、{compact(totals.posts)} 条帖子。
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Link to="/x-people/growth" className="rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            涨粉榜
          </Link>
          <Link to="/x-people/compare" className="rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            账号对比
          </Link>
          <Link to="/x-people/methodology" className="rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            内容方法论
          </Link>
        </div>
      </header>

      {/* 搜索框：补全 id、label 与 aria-label */}
      <div className="mt-4 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
        <label htmlFor="people-search-input" className="sr-only">搜索博主名字或 @handle</label>
        <IconSearch size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
        <input
          id="people-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名字或 @handle"
          aria-label="搜索名字或 @handle"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="min-h-[28px] px-2 text-[12px] text-ink-3 hover:text-ink">
            清除
          </button>
        )}
      </div>

      {/* 区域筛选：使用统一 PillTabs */}
      <div className="mt-3">
        <PillTabs
          layoutId="x-people-regions"
          size="sm"
          active={region}
          items={REGIONS.map((value) => ({
            key: value,
            label: value === "all" ? "全部地区" : REGION_LABEL[value],
            count: regionCounts[value],
          }))}
          onSelect={(val) => setParam("region", val)}
        />
      </div>

      {/* 账号类型筛选：统一 min-h-[32px] 触控区 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {KINDS.map((value) => {
          const active = kind === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setParam("kind", value)}
              className={`min-h-[32px] rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                active ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-ink-3 hover:text-ink"
              }`}
            >
              {value === "all" ? "全部类型" : KIND_LABEL[value]}
              <span className="num ml-1 text-[10.5px] text-ink-4">{kindCounts[value]}</span>
            </button>
          );
        })}
      </div>

      {/* 筛选结果计数提示 */}
      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-4 font-mono">
        <span>已筛选出 <strong className="text-ink">{shown.length}</strong> 位博主（共 {totals.people} 位）</span>
        <span>当前排序：{SORTS.find((s) => s.key === sort.key)?.label}{sort.dir === -1 ? "（降序）" : "（升序）"}</span>
      </div>

      {/* 手机端没有表头，排序收在这里，不然手机上只能看默认顺序 */}
      <div className="mt-2 flex items-center gap-2 text-[12px] lg:hidden">
        <label htmlFor="people-sort" className="text-ink-4">排序</label>
        <select
          id="people-sort"
          value={sort.key}
          onChange={(event) => setSort({ key: event.target.value as SortKey, dir: sort.dir })}
          className="min-h-[32px] rounded-control border border-line bg-surface px-2 text-[12px] text-ink"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSort({ key: sort.key, dir: sort.dir === -1 ? 1 : -1 })}
          className="min-h-[32px] rounded-control border border-line bg-surface px-2.5 text-[12px] text-ink-2"
        >
          {sort.dir === -1 ? "降序 ↓" : "升序 ↑"}
        </button>
      </div>
      {/* 手机端卡片流 (lg:hidden)，避免 393px 下中位浏览滚到屏幕外 */}
      <div className="mt-2.5 space-y-2 lg:hidden">
        {shown.map((p) => (
          <Link
            key={p.sourceId}
            to={`/x-people/${p.handle}`}
            className="block rounded-card border border-line bg-surface p-3.5 transition-colors active:bg-bg-sunk"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <SourceAvatar name={p.author} avatarUrl={p.avatar} size={36} />
                <div className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-ink">{p.author}</span>
                  <span className="num block truncate text-[11.5px] text-ink-3">@{p.handle} · {KIND_LABEL[p.kind]}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="num block text-[15px] font-semibold text-ink">{compact(p.medViews)}</span>
                <span className="text-[10px] text-ink-4">中位浏览</span>
              </div>
            </div>
            <div className="num mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3 border-t border-line-soft pt-2">
              <span>粉丝 {p.followers === null ? "—" : compact(p.followers)}</span>
              <span>发帖 {compact(p.posts)} 条</span>
              <span>日均 {p.postsPerDay} 帖</span>
              <span>互动率 {percent(p.engagementRate)}</span>
              {p.category && <span className="text-ink-4 ml-auto">{CATEGORY_LABEL[p.category]}</span>}
            </div>
          </Link>
        ))}
      </div>

      {/* 桌面端表格 (hidden lg:block) */}
      <div className="mt-2.5 hidden overflow-x-auto rounded-card border border-line bg-surface lg:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">博主列表与多维表现数据</caption>
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              <th scope="col" className="px-4 py-2.5 font-normal">博主</th>
              {SORTS.map((s) => {
                const active = sort.key === s.key;
                return (
                  <th key={s.key} scope="col" aria-sort={active ? (sort.dir === -1 ? "descending" : "ascending") : "none"} className="px-3 py-2.5 text-right font-normal">
                    <button
                      type="button"
                      onClick={() => toggle(s.key)}
                      className={`inline-flex min-h-[32px] items-center gap-0.5 ${active ? "font-semibold text-accent" : "text-ink-3 hover:text-ink"}`}
                    >
                      {s.label}
                      <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
                        {sort.dir === -1 ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-3 py-2.5 text-right font-normal">类型</th>
              <th scope="col" className="px-4 py-2.5 text-right font-normal">主类目</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {shown.map((p) => (
              <tr key={p.sourceId} className="transition-colors hover:bg-bg-sunk">
                <td className="px-4 py-2.5">
                  <Link to={`/x-people/${p.handle}`} className="flex items-center gap-3">
                    <SourceAvatar name={p.author} avatarUrl={p.avatar} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{p.author}</span>
                      <span className="num block truncate text-[11.5px] text-ink-3">@{p.handle}</span>
                    </span>
                  </Link>
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-2" title={p.followers === null ? "暂无快照" : `粉丝 ${p.followers.toLocaleString("en-US")}`}>
                  {p.followers === null ? "—" : compact(p.followers)}
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{compact(p.posts)}</td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{p.postsPerDay}</td>
                <td className="num px-3 py-2.5 text-right font-medium text-ink">{compact(p.medViews)}</td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{percent(p.engagementRate)}</td>
                <td className="px-3 py-2.5 text-right text-[12px] text-ink-3">{KIND_LABEL[p.kind]}</td>
                <td className="px-4 py-2.5 text-right text-[12px] text-ink-3">{p.category ? CATEGORY_LABEL[p.category] : p.topCategory ? categoryName(p.topCategory) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="mt-6 text-center text-[13px] text-ink-3">没有匹配的账号。</p>}
      <p className="mt-4 text-[11.5px] text-ink-4">数据截至 {stamp(generatedAt)}（北京时间）。</p>
    </div>
  );
}
