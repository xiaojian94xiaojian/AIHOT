// 本周涨粉观察：worker 每周一给「涨粉前 10 且发帖 ≥5」的账号写一份观察，
// 页面只读结果（不在页面里调模型），每条原因都带依据。
import { Link, useLoaderData } from "react-router";
import type { XGrowthReportResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDay } from "@aihot/contracts/time";
import { signed, stamp } from "./format";

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

      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">本周涨粉观察</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          每周一给中文区、7 日涨粉超过 1000 的账号做一次观察：模型只根据本站抓到的发帖与同期站内报道写，
          每条原因都标出依据。数据不够时会直接说“数据不足以归因”，置信度也会标成低。
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Link to="/x-people/growth" className="min-h-[32px] inline-flex items-center rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            回到涨粉榜
          </Link>
          <Link to="/x-people" className="min-h-[32px] inline-flex items-center rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            博主列表
          </Link>
        </div>
      </header>

      {reports.length === 0 ? (
        <div className="mt-5 rounded-card border border-line bg-surface p-5 text-[13px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">本周还没有生成的观察。</p>
          <p className="mt-1.5">每周一上午，后台会自动为最近一周中文区涨粉最多的账号跑一次分析；如果这周没有账号涨幅超过 1000，就会留空。</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {summary && (
            <div className="rounded-card border border-line-soft bg-bg-sunk/60 p-4 text-[13px] leading-relaxed text-ink-2">
              <h2 className="text-[13px] font-semibold text-ink">本周大盘速览</h2>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
                <span>
                  <span className="text-ink-4">冠军 </span>
                  <Link to={`/x-people/${summary.champion.handle}`} className="text-ink hover:text-accent">
                    {summary.champion.name}
                  </Link>
                  <span className="num ml-1 text-ink-3">{signed(summary.champion.growth)} 粉 · 每千曝光 {summary.champion.perK ?? "—"}</span>
                </span>
                {summary.darkHorse && (
                  <span>
                    <span className="text-ink-4">黑马 </span>
                    <Link to={`/x-people/${summary.darkHorse.handle}`} className="text-ink hover:text-accent">
                      {summary.darkHorse.name}
                    </Link>
                    <span className="num ml-1 text-ink-3">{signed(summary.darkHorse.growth)} 粉 · 每千曝光 {summary.darkHorse.perK ?? "—"}</span>
                  </span>
                )}
                {summary.cautions.length > 0 && (
                  <>
                    <span className="text-ink-3">另有 {summary.cautions.length} 个账号需核对：</span>
                    {summary.cautions.map((row) => (
                      <Link key={row.handle} to={`/x-people/${row.handle}`} className="num rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:border-amber hover:text-amber">
                        {row.name} {signed(row.growth)}
                      </Link>
                    ))}
                  </>
                )}
              </div>
              {summary.moves.length > 0 && (
                <p className="mt-2 text-[12.5px] text-ink-3">可复用：{summary.moves.join("；")}</p>
              )}
            </div>
          )}

          <ol className="space-y-4">
            {reports.map((report) => (
              <li key={report.handle} className="rounded-card border border-line bg-surface p-4 lg:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-3">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <Link to={`/x-people/${report.handle}`} className="text-[17px] font-bold text-ink hover:text-accent">
                      {report.name ?? report.screenName}
                    </Link>
                    <span className="num text-[12.5px] text-ink-3">@{report.handle}</span>
                    <span className="num font-semibold text-accent">{signed(report.growth)} 粉</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px] text-ink-4">
                    <span>置信度：{confidence[report.report.confidence]}</span>
                    <span>·</span>
                    <span>{monthDay(report.periodEnd)}</span>
                  </div>
                </div>

                <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-ink-2">
                  <p className="font-medium text-ink">{report.report.conclusion}</p>

                  <div className="space-y-2">
                    <span className="block text-[12px] font-medium text-ink-4">可能的涨粉原因与依据：</span>
                    <ul className="space-y-2 pl-1">
                      {report.report.drivers.map((driver, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                          <div>
                            <span className="text-ink">{driver.why}</span>
                            {driver.evidence && (
                              <p className="mt-0.5 text-[12px] text-ink-3">
                                依据：{driver.evidence}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {report.report.moves.length > 0 && (
                    <div className="rounded-card bg-bg-sunk/50 p-3 text-[12.5px]">
                      <span className="font-medium text-ink">可复用的运营动作：</span>
                      <p className="mt-1 text-ink-3">{report.report.moves.join("；")}</p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-4 text-[11.5px] text-ink-4">数据截至 {generatedAt ? stamp(generatedAt) : "—"}（北京时间）。模型基于本站采集推文生成，不代表平台定论。</p>
    </div>
  );
}
