// 本周涨粉观察：worker 每周一给「涨粉前 10 且发帖 ≥5」的账号写一份观察，
// 页面只读结果（不在页面里调模型），每条原因都带依据。
import { Link, useLoaderData } from "react-router";
import type { XGrowthReportResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDay } from "@aihot/contracts/time";
import { compact, stamp } from "./format";

export async function loader({ request }: { request: Request }) {
  return loadOr404<XGrowthReportResponse>("/api/site/x-people/growth/report", { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "本周涨粉观察：AI 账号为什么涨粉",
    description: "每周根据本站采集的发帖数据和站内同期报道，为涨粉靠前的 AI 账号写一份可核对的观察：可能的原因、依据和可复用动作。",
    path: "/x-people/growth/report",
  });
}

export function headers() {
  return edgeTtl(300);
}
/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "本周观察" } as const;


const confidence = { high: "高", medium: "中", low: "低" } as const;

export default function GrowthReportPage() {
  const { reports, generatedAt, summary } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <Link to="/x-people/growth" className="hover:text-ink">涨粉榜</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">本周观察</span>
      </nav>

      <header className="mt-3">
        <h1 className="text-[26px] font-black tracking-[-0.02em] text-ink lg:text-[32px]">本周涨粉观察</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          每周一给中文区、7 日涨粉超过 1000 的账号做一次观察：模型只根据本站抓到的发帖与同期站内报道写，
          每条原因都标出依据。数据不够时会直接说“数据不足以归因”，置信度也会标成低。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/x-people/growth" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            回到涨粉榜
          </Link>
          <Link to="/x-people" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            博主列表
          </Link>
        </div>
      </header>

      {reports.length === 0 ? (
        <div className="mt-5 rounded-card border border-line bg-surface p-5 text-[13px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">这一期还没有生成。</p>
          <p className="mt-1.5">每周一早上生成一次；第一次会在部署后的下一次任务启动时跑出来。条件：中文区、7 日涨粉超过 1000。</p>
        </div>
      ) : (
        <>
          {summary && (
            <section className="mt-4 rounded-card border border-line bg-surface p-4 lg:p-5">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <span className="block h-3.5 w-[3px] rounded-full bg-accent" />
                本期总览
              </h2>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-card border border-line px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-3">冠军 · 涨粉最多</div>
                  <Link to={`/x-people/${summary.champion.handle}`} className="mt-1 block truncate text-[15px] font-semibold text-ink hover:text-accent">
                    {summary.champion.name}
                  </Link>
                  <div className="num mt-1 text-[12px] text-ink-3">+{compact(summary.champion.growth)} 粉 · 每千曝光 {summary.champion.perK ?? "—"}</div>
                </div>
                <div className="rounded-card border border-line px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-3">黑马 · 同档效率最高</div>
                  {summary.darkHorse ? (
                    <>
                      <Link to={`/x-people/${summary.darkHorse.handle}`} className="mt-1 block truncate text-[15px] font-semibold text-ink hover:text-accent">
                        {summary.darkHorse.name}
                      </Link>
                      <div className="num mt-1 text-[12px] text-ink-3">+{compact(summary.darkHorse.growth)} 粉 · 每千曝光 {summary.darkHorse.perK ?? "—"}</div>
                    </>
                  ) : (
                    <p className="mt-1 text-[13px] text-ink-3">这一期没有粉丝 5 万以下的账号进观察。</p>
                  )}
                </div>
              </div>

              {summary.cautions.length > 0 && (
                <div className="mt-3 rounded-card border border-amber/30 bg-amber/5 px-3 py-2.5">
                  <div className="text-[11.5px] font-medium text-amber">存疑清单 · 先核对再学</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {summary.cautions.map((row) => (
                      <Link key={row.handle} to={`/x-people/${row.handle}`} className="num rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 hover:border-amber hover:text-amber">
                        {row.name} +{compact(row.growth)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {summary.moves.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11.5px] text-ink-3">三条可复用动作</div>
                  <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-ink-2">
                    {summary.moves.map((move, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="mt-[3px] size-1.5 shrink-0 rounded-full bg-accent/70" />
                        <span>{move}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
          <div className="mt-4 space-y-3">
            {reports.map((report) => (
            <article key={report.handle} className="rounded-card border border-line bg-surface p-4 lg:p-5">
              <div className="flex flex-wrap items-center gap-3">
                {report.avatarUrl
                  ? <img src={report.avatarUrl} alt="" width={44} height={44} loading="lazy" className="size-11 shrink-0 rounded-full bg-bg-sunk object-cover" />
                  : <span className="grid size-11 shrink-0 place-items-center rounded-full bg-bg-sunk text-[15px] text-ink-3">{(report.name ?? report.screenName).slice(0, 1)}</span>}
                <div className="min-w-0 flex-1">
                  <Link to={`/x-people/${report.handle}`} className="block truncate text-[15px] font-semibold text-ink hover:text-accent">
                    {report.name ?? report.screenName}
                  </Link>
                  <div className="num text-[11.5px] text-ink-3">@{report.screenName}</div>
                </div>
                <div className="num flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
                  <span><span className="text-ink-4">涨粉 </span><span className="text-accent">+{compact(report.growth)}</span></span>
                  <span><span className="text-ink-4">粉丝 </span>{compact(report.followers)}</span>
                  <span><span className="text-ink-4">发帖 </span>{report.posts}</span>
                  <span><span className="text-ink-4">每千曝光 </span>{report.perK === null ? "—" : report.perK.toFixed(1)}</span>
                  <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">置信度 {confidence[report.report.confidence]}</span>
                </div>
              </div>

              <p className="mt-3 text-[13.5px] leading-relaxed text-ink">{report.report.conclusion}</p>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
                {report.report.drivers.map((driver, index) => (
                  <li key={index}>
                    <span className="text-ink">{driver.why}</span>
                    {driver.evidence && <span className="text-ink-3">（依据：{driver.evidence}）</span>}
                  </li>
                ))}
              </ul>
              {report.report.moves.length > 0 && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
                  <span className="text-ink-4">可复用：</span>{report.report.moves.join("；")}
                </p>
              )}
              <p className="mt-2 text-[11px] text-ink-4">
                {monthDay(report.periodStart)} – {monthDay(report.periodEnd)} · 模型 {report.model ?? "—"} 根据这一周的发帖与同期报道写的观察，不是结论。
              </p>
            </article>
          ))}
        </div>
        </>
      )}

      {generatedAt && <p className="mt-4 text-[11.5px] text-ink-4">生成于 {stamp(generatedAt)}（北京时间）。</p>}
    </div>
  );
}
