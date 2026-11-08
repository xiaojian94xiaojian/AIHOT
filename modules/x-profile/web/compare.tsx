// 账号并排对比：最多三个人，指标一行行对齐；选择写进 URL，方便分享。
import { Link, useLoaderData, useSearchParams } from "react-router";
import { useMemo, useState } from "react";
import type { XCompareResponse, XPeopleResponse, XPersonSummary } from "../types";
import { KIND_LABEL, REGION_LABEL } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { IconSearch } from "@aihot/web/components/icons";
import { Spark } from "./charts";
import { categoryName, compact, percent } from "./format";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const handles = handlesOf(url);
  const valid = handles.length >= 2 && handles.length <= 3;
  const [list, compare] = await Promise.all([
    loadOr404<XPeopleResponse>("/api/site/x-people", { signal: request.signal }),
    valid ? loadOr404<XCompareResponse>(`/api/site/x-people/compare?h=${encodeURIComponent(handles.join(","))}`, { signal: request.signal }) : Promise.resolve(null),
  ]);
  return { people: list.people, handles, compare };
}

/**
 * 已选账号的三种写法都认：`?h=a,b`（页面自己写的）、`?handles=a,b`、`?a=&b=&c=`。
 * 早期只认 h，别人用 a/b/c 打开就是空态，看着像参数不生效。
 */
export function handlesOf(url: URL): string[] {
  const joined =
    url.searchParams.get("h") ??
    url.searchParams.get("handles") ??
    ["a", "b", "c"].map((key) => url.searchParams.get(key)).filter(Boolean).join(",");
  return joined.split(",").map((handle) => handle.trim().replace(/^@/, "").toLowerCase()).filter(Boolean).slice(0, 3);
}

export function meta() {
  return pageMeta({ title: "账号对比", description: "把 2–3 个 X 账号并排对照：发帖节奏、互动、内容结构与最佳时段。", path: "/x-people/compare" });
}

export function headers() {
  return edgeTtl(300);
}
/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "账号对比" } as const;


const ROWS: Array<{ label: string; value: (person: XCompareResponse["people"][number]) => string }> = [
  { label: "语言区 / 类型", value: (p) => `${REGION_LABEL[p.region]} · ${KIND_LABEL[p.kind]}` },
  { label: "帖子", value: (p) => compact(p.posts) },
  { label: "日均发帖", value: (p) => String(p.postsPerDay) },
  { label: "中位浏览", value: (p) => compact(p.medViews) },
  { label: "平均浏览", value: (p) => compact(p.avgViews) },
  { label: "P90 浏览", value: (p) => compact(p.p90Views) },
  { label: "中位赞", value: (p) => compact(p.medLikes) },
  { label: "互动率", value: (p) => percent(p.engagementRate) },
  { label: "带媒体", value: (p) => percent(p.mediaPct) },
  { label: "回复", value: (p) => percent(p.replyPct) },
  { label: "主类目", value: (p) => (p.topCategory ? categoryName(p.topCategory) : "—") },
];

export default function ComparePage() {
  const { people: all, handles, compare } = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const selected = handles;
  const chosen = compare?.people ?? [];

  // 没输入时给「中文区、同粉丝档、效率高」的推荐，而不是发帖榜头部（英区官号对中文作者没参考价值）。
  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const free = all.filter((p) => !selected.some((h) => h.toLowerCase() === p.handle.toLowerCase()));
    if (needle) {
      return free.filter((p) => p.handle.toLowerCase().includes(needle) || p.author.toLowerCase().includes(needle)).slice(0, 12);
    }
    const anchor = selected.length === 1 ? all.find((p) => p.handle.toLowerCase() === selected[0].toLowerCase()) : null;
    const sameTier = (p: XPersonSummary) =>
      !anchor?.followers || !p.followers ? true : p.followers >= anchor.followers / 3 && p.followers <= anchor.followers * 3;
    const efficiency = (p: XPersonSummary) => (p.followers && p.followers > 0 ? p.medViews / p.followers : 0);
    return free
      .filter((p) => p.region === "zh" && p.kind !== "official" && (p.followers ?? 0) >= 500 && p.posts >= 20)
      .filter(sameTier)
      .sort((a, b) => efficiency(b) - efficiency(a))
      .slice(0, 12);
  }, [all, selected, query]);

  const setHandles = (next: string[]) => setParams(next.length ? { h: next.join(",") } : {}, { replace: true });
  const add = (handle: string) => {
    if (selected.length >= 3 || selected.some((h) => h.toLowerCase() === handle.toLowerCase())) return;
    setHandles([...selected, handle]);
  };
  const remove = (handle: string) => setHandles(selected.filter((h) => h.toLowerCase() !== handle.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">账号对比</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[26px] font-black tracking-[-0.02em] text-ink lg:text-[32px]">账号对比</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          选 2–3 个账号并排看：发帖节奏、互动水平、内容结构与近 12 周趋势。选择会写进地址，可直接分享。
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {selected.map((handle) => {
          const person = chosen.find((p) => p.handle.toLowerCase() === handle.toLowerCase());
          return (
            <span key={handle} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 text-[12.5px]">
              {person?.avatar
                ? <img src={person.avatar} alt="" width={22} height={22} className="size-[22px] rounded-full object-cover" />
                : <span className="grid size-[22px] place-items-center rounded-full bg-bg-sunk text-[10px] text-ink-3">{(person?.author ?? handle).slice(0, 1)}</span>}
              <span className="text-ink">{person?.author ?? `@${handle}`}</span>
              <button type="button" onClick={() => remove(handle)} className="text-ink-4 hover:text-ink" aria-label={`移除 ${handle}`}>×</button>
            </span>
          );
        })}
        {selected.length < 3 && (
          <span className="text-[11.5px] text-ink-4">还能加 {3 - selected.length} 个</span>
        )}
      </div>

      {selected.length < 3 && (
        <div className="mt-3 rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2 rounded-control bg-bg-sunk px-3 py-1.5">
            <IconSearch size={15} className="shrink-0 text-ink-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索并添加账号"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
            />
          </div>
          {!query.trim() && (
            <div className="mt-2 text-[11px] text-ink-4">推荐：中文区{selected.length === 1 ? " · 同粉丝档" : ""} · 效率高（中位浏览 / 粉丝）</div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {candidates.map((p) => (
              <button
                key={p.sourceId}
                type="button"
                onClick={() => add(p.handle)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-accent hover:text-ink"
              >
                @{p.handle}
                <span className="text-[10.5px] text-ink-4">{compact(p.posts)} 帖</span>
              </button>
            ))}
            {candidates.length === 0 && <span className="text-[12px] text-ink-4">没有匹配的账号。</span>}
          </div>
        </div>
      )}

      {chosen.length >= 2 ? (
        <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="w-32 px-4 py-3 text-left text-[11px] font-normal text-ink-3">指标</th>
                {chosen.map((p) => (
                  <th key={p.sourceId} className="px-4 py-3 text-left font-normal">
                    <Link to={`/x-people/${p.handle}`} className="flex items-center gap-2.5">
                      {p.avatar
                        ? <img src={p.avatar} alt="" width={34} height={34} className="size-[34px] rounded-full bg-bg-sunk object-cover" />
                        : <span className="grid size-[34px] place-items-center rounded-full bg-bg-sunk text-[13px] text-ink-3">{p.author.slice(0, 1)}</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{p.author}</span>
                        <span className="num block truncate text-[11px] text-ink-3">@{p.handle}</span>
                      </span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {ROWS.map((row) => (
                <tr key={row.label} className="hover:bg-bg-sunk/60">
                  <td className="px-4 py-2.5 text-[12px] text-ink-3">{row.label}</td>
                  {chosen.map((p) => (
                    <td key={p.sourceId} className="num px-4 py-2.5 text-ink">{row.value(p)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2.5 text-[12px] text-ink-3">近 12 周发帖</td>
                {chosen.map((p) => (
                  <td key={p.sourceId} className="px-4 py-2.5"><div className="w-28"><Spark points={p.spark} height={26} /></div></td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 rounded-card border border-dashed border-line px-4 py-10 text-center text-[13px] text-ink-3">
          再选 {2 - chosen.length} 个账号，就能并排对照了。
        </p>
      )}

      <p className="mt-4 text-[11.5px] text-ink-4">
        指标口径与个人页一致；互动数是采集那一刻的快照，不是帖子最终值。
      </p>
    </div>
  );
}
