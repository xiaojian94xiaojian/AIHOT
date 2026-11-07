// 博主列表：先按语言区（中文/英文/其他）分，再按账号类型（官方、创始人、研究者、媒体、开发者）筛；
// 点进每个人看多维画像。筛选同步到 URL，方便分享。
import { Link, useLoaderData, useSearchParams, type ShouldRevalidateFunction } from "react-router";
import { useMemo, useState } from "react";
import type { PersonKind, Region, XPeopleResponse, XPersonSummary } from "../types";
import { CATEGORY_LABEL, KIND_LABEL, REGION_LABEL } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { IconSearch } from "@aihot/web/components/icons";
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

export function headers() {
  return edgeTtl(600);
}

/**
 * 筛选只改查询参数，列表数据与它无关。默认行为是为这次点击重新跑一遍 loader（一次 SSR 请求，
 * 手机上要等一两秒，看起来像没反应），所以同路径的导航直接放行、不重跑。
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
  currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;

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

function Avatar({ person }: { person: XPersonSummary }) {
  return person.avatar ? (
    <img src={person.avatar} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-full bg-bg-sunk object-cover" />
  ) : (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg-sunk text-[13px] text-ink-3">{person.author.slice(0, 1)}</span>
  );
}

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
    return [...filtered].sort((a, b) => ((a[sort.key] ?? 0) - (b[sort.key] ?? 0)) * sort.dir);
  }, [people, region, kind, query, sort]);

  const toggle = (key: SortKey) => setSort((current) => current.key === key ? { key, dir: current.dir === -1 ? 1 : -1 } : { key, dir: -1 });

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <header className="mt-2">
        <h1 className="text-[26px] font-black tracking-[-0.02em] text-ink lg:text-[32px]">博主画像</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          本站采集的 X 账号数据，按人汇总：发帖节奏、互动表现与内容结构。先分中文区与英文区，再按账号类型筛选；
          互动数是采集那一刻的快照，适合横向比较。共 {totals.people} 个账号、{compact(totals.posts)} 条帖子。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/x-people/growth" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            涨粉榜
          </Link>
          <Link to="/x-people/compare" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            账号对比
          </Link>
          <Link to="/x-people/methodology" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            内容方法论
          </Link>
        </div>
      </header>

      <div className="mt-5 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
        <IconSearch size={16} className="shrink-0 text-ink-4" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名字或 @handle"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
        />
        {query && <button type="button" onClick={() => setQuery("")} className="text-[12px] text-ink-3">清除</button>}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {REGIONS.map((value) => {
          const active = region === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setParam("region", value)}
              className={`rounded-full px-3 py-1 text-[12.5px] transition-colors ${active ? "bg-ink text-bg" : "bg-bg-sunk text-ink-2 hover:text-ink"}`}
            >
              {value === "all" ? "全部" : REGION_LABEL[value]}
              <span className={`num ml-1.5 text-[11px] ${active ? "text-bg/70" : "text-ink-4"}`}>{regionCounts[value]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {KINDS.map((value) => {
          const active = kind === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setParam("kind", value)}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${active ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-3 hover:text-ink"}`}
            >
              {value === "all" ? "全部类型" : KIND_LABEL[value]}
              <span className="num ml-1 text-[10.5px] text-ink-4">{kindCounts[value]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] text-ink-3">
              <th className="px-4 py-2.5 font-normal">博主</th>
              {SORTS.map((s) => (
                <th key={s.key} className="px-3 py-2.5 text-right font-normal">
                  <button type="button" onClick={() => toggle(s.key)} className={sort.key === s.key ? "text-ink" : "text-ink-3 hover:text-ink"}>
                    {s.label}{sort.key === s.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-normal">类型</th>
              <th className="px-4 py-2.5 text-right font-normal">主类目</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {shown.map((p) => (
              <tr key={p.sourceId} className="transition-colors hover:bg-bg-sunk">
                <td className="px-4 py-2.5">
                  <Link to={`/x-people/${p.handle}`} className="flex items-center gap-3">
                    <Avatar person={p} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{p.author}</span>
                      <span className="num block truncate text-[11.5px] text-ink-3">@{p.handle}</span>
                    </span>
                  </Link>
                </td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{p.followers === null ? "—" : compact(p.followers)}</td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{compact(p.posts)}</td>
                <td className="num px-3 py-2.5 text-right text-ink-2">{p.postsPerDay}</td>
                <td className="num px-3 py-2.5 text-right text-ink">{compact(p.medViews)}</td>
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
