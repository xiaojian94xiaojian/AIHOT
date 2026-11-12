// 公开周报：每周一期的中文 AI 圈涨粉周报，把「数字」和「能照着做的事」放在一页里。
// 数据段（榜单/黑马/爆款/形态/比上周）只读本站采集；账号观察是 worker 周一生成的模型结果，
// 页面只读存储，不调模型。只列已经过完的周；快照不够就直说，不拿相邻周凑数。
import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { XWeeklyResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDay } from "@aihot/contracts/time";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
import { signed } from "./format";
import { IconClock, IconTarget, IconTrophy, IconZap } from "./icons";

export async function loader({ request }: { request: Request }) {
  const week = new URL(request.url).searchParams.get("week");
  return loadOr404<XWeeklyResponse>(`/api/site/x-people/weekly${week ? `?week=${encodeURIComponent(week)}` : ""}`, { signal: request.signal });
}

export function meta() {
  return [
    ...pageMeta({
      title: "中文 AI 圈涨粉周报",
      description: "每周一期：中文 AI 圈这一周谁涨粉最多、哪条帖子最火、大家发的是什么形态，以及能照着做的几件事。数字来自本站自己的采集与粉丝快照，可核对。",
      path: "/x-people/weekly",
    }),
    { tagName: "link", rel: "alternate", type: "application/rss+xml", title: "涨粉周报 RSS", href: "/feed/x-people/weekly.xml" } as const,
  ];
}

export function headers() {
  return edgeTtl(600);
}

/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "涨粉周报" } as const;

const compact = (n: number) => (n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : n.toLocaleString("en-US"));
const confidence = { high: "高", medium: "中", low: "低" } as const;

function RankMove({ prev, rank }: { prev: number | null; rank: number }) {
  if (prev == null) return <span className="ml-1 text-[10px] text-emerald-600">新</span>;
  if (prev > rank) return <span className="ml-1 text-[10px] text-emerald-600">↑{prev - rank}</span>;
  if (prev < rank) return <span className="ml-1 text-[10px] text-rose-500">↓{rank - prev}</span>;
  return null;
}

export default function WeeklyPage() {
  const { week, weeks, rows, darkHorses, observations, patterns, compare, viral, shape, summary } = useLoaderData<typeof loader>();
  const at = weeks.indexOf(week.start);
  const older = at >= 0 && at < weeks.length - 1 ? weeks[at + 1]! : null;
  const newer = at > 0 ? weeks[at - 1]! : null;
  const lead = rows[0];
  const moves = [...new Set(observations.flatMap((report) => report.report.moves))].slice(0, 3);
  // 观察通常有十几到二十条，默认先放前 6 条，免得整页被长文淹没。
  const [showAll, setShowAll] = useState(false);
  const shownObservations = showAll ? observations : observations.slice(0, 6);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people/growth" className="hover:text-ink">涨粉榜</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">涨粉周报</span>
      </nav>

      {/* 刊头：一期周报的「封面」 */}
      <header className="mt-3 border-b border-line pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          <span className="rounded-full border border-accent/30 bg-accent-soft/50 px-2.5 py-0.5 font-medium text-accent">第 {weekNumber(week.start)} 周</span>
          <span className="num">{monthDay(week.start)} – {monthDay(week.end)}</span>
          <span>中文 AI 圈</span>
        </div>
        <h1 className="mt-2 text-[26px] font-black tracking-[-0.02em] text-ink lg:text-[34px]">涨粉周报</h1>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-2">
          {lead ? (
            <>
              本周 <Link to={`/x-people/${lead.handle}`} className="font-semibold text-ink hover:text-accent">@{lead.handle}</Link> 领跑（{signed(lead.growth)} 粉）；
              {patterns[0] ? ` ${patterns[0].title}。` : ""}下面是这一周的中文 AI 圈涨粉榜、爆款帖、内容形态，以及几条能照着做的事。
            </>
          ) : (
            <>这一周的快照还不够，涨粉榜暂缺；下面的爆款与形态仍按已采集到的帖子统计。</>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
          {weeks.map((w) => (
            <Link
              key={w}
              to={`/x-people/weekly?week=${w}`}
              className={`min-h-[30px] inline-flex items-center rounded-full border px-2.5 py-1 transition-colors ${w === week.start ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-accent hover:text-ink"}`}
            >
              {w.slice(5).replace("-", "/")}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-3">
          {older && <Link to={`/x-people/weekly?week=${older}`} className="hover:text-ink">← 更早一周</Link>}
          {newer && <Link to={`/x-people/weekly?week=${newer}`} className="hover:text-ink">更新一周 →</Link>}
          {week.start !== weeks[0] && <Link to="/x-people/weekly" className="text-accent hover:underline">回到本周</Link>}
        </div>
      </header>

      {/* 四个数：放在刊头下面当「本期摘要」 */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
        {[
          { label: "在发账号", value: summary.accounts.toLocaleString("en-US") },
          { label: "本周帖子", value: summary.posts.toLocaleString("en-US") },
          { label: "总浏览", value: compact(summary.views) },
          { label: "带图/视频", value: `${summary.mediaPct}%` },
        ].map((card) => (
          <div key={card.label} className="bg-surface px-3 py-3">
            <div className="text-[11px] text-ink-3">{card.label}</div>
            <div className="num mt-0.5 text-[19px] font-bold text-ink">{card.value}</div>
          </div>
        ))}
      </section>

      {patterns.length > 0 && (
        <section className="mt-7">
          <h2 className="flex items-center gap-1.5 text-[17px] font-bold text-ink"><IconTarget className="size-4 text-accent" />本周看点</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {patterns.map((pattern, index) => (
              <li key={pattern.title} className="rounded-card border border-line bg-surface px-3 py-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="num text-[11px] font-bold text-accent">0{index + 1}</span>
                  <span className="text-[13px] font-semibold text-ink">{pattern.title}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{pattern.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">看点只从本周采集到的帖子里算，不调模型；爆款样本没采满时不写爆款观察。全周基线包含回复和引用。</p>
        </section>
      )}

      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[17px] font-bold text-ink"><IconTrophy className="size-4 text-accent" />涨粉榜 TOP 10</h2>
          <span className="text-[11px] text-ink-3">按净增粉丝排序 · 每千曝光涨粉 = 涨粉 ÷ 本周浏览 × 1000</span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface px-3 py-8 text-center text-[13px] text-ink-3">
            这一周的快照不够，涨粉榜暂缺。等采集补齐后会自动出现。
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-ink-3">
                  <th className="w-14 px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">账号</th>
                  <th className="hidden px-3 py-2 font-normal text-right sm:table-cell">粉丝</th>
                  <th className="px-3 py-2 font-normal text-right">本周涨粉</th>
                  <th className="hidden px-3 py-2 font-normal text-right sm:table-cell">涨幅</th>
                  <th className="hidden px-3 py-2 font-normal text-right sm:table-cell">本周帖</th>
                  <th className="px-3 py-2 font-normal text-right">千曝涨粉</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.handle} className="border-b border-line/60 last:border-0">
                    <td className="num px-3 py-2 text-ink-3">
                      {row.rank}
                      <RankMove prev={row.rankPrev} rank={row.rank} />
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/x-people/${row.handle}`} className="group inline-flex min-w-0 items-center gap-2">
                        <SourceAvatar avatarUrl={row.avatarUrl} name={row.name ?? row.handle} size={26} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink group-hover:text-accent">{row.name ?? `@${row.handle}`}</span>
                          <span className="block truncate text-[11px] text-ink-3">@{row.handle}<span className="sm:hidden"> · {compact(row.followers)} 粉</span></span>
                        </span>
                      </Link>
                    </td>
                    <td className="num hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{compact(row.followers)}</td>
                    <td className="num px-3 py-2 text-right font-semibold text-emerald-600">{signed(row.growth)}</td>
                    <td className="num hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{row.growthPct}%</td>
                    <td className="num hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{row.posts}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.perK == null ? "—" : row.perK}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-7 grid gap-3 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface p-3.5">
          <div className="flex items-end justify-between">
            <h2 className="text-[15px] font-bold text-ink">小账号黑马</h2>
            <span className="text-[11px] text-ink-3">粉丝 1 千–5 万、本周涨粉 ≥300</span>
          </div>
          {darkHorses.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-ink-3">这一周没有符合条件的小账号。</p>
          ) : (
            <ol className="mt-2.5 space-y-2">
              {darkHorses.map((row) => (
                <li key={row.handle} className="flex items-center justify-between gap-2">
                  <Link to={`/x-people/${row.handle}`} className="group inline-flex min-w-0 items-center gap-2">
                    <SourceAvatar avatarUrl={row.avatarUrl} name={row.name ?? row.handle} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-accent">{row.name ?? `@${row.handle}`}</span>
                      <span className="block truncate text-[11px] text-ink-3">{compact(row.followers)} 粉 · {row.posts} 帖</span>
                    </span>
                  </Link>
                  <span className="num shrink-0 text-right">
                    <span className="block text-[13px] font-bold text-emerald-600">{signed(row.growth)}</span>
                    <span className="block text-[11px] text-ink-3">{row.growthPct}%</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-card border border-line bg-surface p-3.5">
          <div className="flex items-end justify-between">
            <h2 className="text-[15px] font-bold text-ink">比上周</h2>
            <span className="text-[11px] text-ink-3">同口径 · 只算中文</span>
          </div>
          <div className="mt-2.5 space-y-2">
            {[
              { label: "帖子", now: compare.posts, prev: compare.prevPosts },
              { label: "浏览", now: compare.views, prev: compare.prevViews },
              { label: "在发账号", now: compare.accounts, prev: compare.prevAccounts },
            ].map((item) => {
              const delta = item.prev > 0 ? Math.round(((item.now - item.prev) / item.prev) * 1000) / 10 : null;
              return (
                <div key={item.label} className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-ink-3">{item.label}</span>
                  <span className="num">
                    <span className="font-semibold text-ink">{compact(item.now)}</span>
                    {delta != null && <span className={`ml-1.5 ${delta >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{delta >= 0 ? "+" : ""}{delta}%</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 border-t border-line-soft pt-2 text-[12px] text-ink-2">上榜账号合计涨粉 {compact(compare.topGrowth)}，上周 {compact(compare.prevTopGrowth)}。</p>
        </section>
      </div>

      <section className="mt-7">
        <h2 className="flex items-center gap-1.5 text-[17px] font-bold text-ink"><IconZap className="size-4 text-accent" />本周爆款帖</h2>
        {viral.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface px-3 py-8 text-center text-[13px] text-ink-3">这一周没有采到带浏览数的帖子。</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {viral.map((post, index) => (
              <li key={post.url} className="rounded-card border border-line bg-surface px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 text-[12px] text-ink-3">
                  <Link to={`/x-people/${post.handle}`} className="hover:text-ink">
                    <span className="num mr-1.5 text-ink-4">{index + 1}</span>@{post.handle}
                  </Link>
                  <span className="num">{compact(post.views)} 浏览 · {compact(post.likes)} 赞</span>
                </div>
                <a href={post.url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-[13.5px] leading-relaxed text-ink hover:text-accent">
                  {post.text.length > 160 ? `${post.text.slice(0, 160)}…` : post.text}
                </a>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1"><IconClock className="size-3" />{post.weekday} {post.hour} 时</span>
                  <span>{post.chars} 字</span>
                  <span>{post.media > 0 ? "带图/视频" : "纯文字"}</span>
                  <span className="num">互动率 {post.likeRate}%</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-[17px] font-bold text-ink">内容形态</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {shape.map((item) => (
            <div key={item.key} className="rounded-card border border-line bg-surface px-3 py-2.5">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-ink-2">{item.label}</span>
                <span className="num text-ink-3">{item.posts.toLocaleString("en-US")} 条 · {item.share}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, item.share)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-ink-3">形态按帖子本身的字段统计（媒体、引用、回复），不是模型判断。</p>
      </section>

      {/* 本周观察：模型每周一给涨粉靠前的账号写的观察，原来单独一页，现在合并进周报 */}
      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-[17px] font-bold text-ink">本周观察</h2>
          <span className="text-[11px] text-ink-3">后台每周一生成，统计窗口到周一（比榜单晚一天结束）</span>
        </div>
        {observations.length === 0 ? (
          <p className="mt-2 rounded-card border border-line bg-surface px-3 py-8 text-center text-[13px] text-ink-3">
            这一周还没有生成账号观察。每周一上午后台会给涨粉靠前的账号跑一次分析；没有账号涨幅超过 1000 时留空。
          </p>
        ) : (
          <>
            {moves.length > 0 && (
              <div className="mt-2 rounded-card border border-accent/25 bg-accent-soft/30 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">可复用的动作：</span>{moves.join("；")}
              </div>
            )}
            <div className="mt-2 space-y-3">
              {shownObservations.map((report) => (
                <article key={report.handle} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SourceAvatar name={report.name ?? report.screenName} avatarUrl={report.avatarUrl} size={34} />
                      <div className="min-w-0">
                        <Link to={`/x-people/${report.handle}`} className="block truncate text-[15px] font-bold text-ink hover:text-accent">
                          {report.name ?? report.screenName}
                        </Link>
                        <span className="num block truncate text-[11.5px] text-ink-3">@{report.handle}</span>
                      </div>
                      <span className="num shrink-0 text-[13px] font-semibold text-emerald-600">{signed(report.growth)} 粉</span>
                    </div>
                    <span className="text-[11px] text-ink-4">置信度 {confidence[report.report.confidence]} · {monthDay(report.periodStart)} – {monthDay(report.periodEnd)}</span>
                  </div>
                  <p className="mt-2.5 text-[13.5px] font-medium leading-relaxed text-ink">{report.report.conclusion}</p>
                  <ul className="mt-2 space-y-1.5">
                    {report.report.drivers.map((driver, index) => (
                      <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                        <div>
                          <span className="text-ink-2">{driver.why}</span>
                          {driver.evidence && <p className="mt-0.5 text-[11.5px] text-ink-3">依据：{driver.evidence}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {observations.length > 6 && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowAll((open) => !open)}
                  className="min-h-[34px] rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
                >
                  {showAll ? "收起" : `展开全部 ${observations.length} 条观察`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-ink-3">
        <span>
          订阅：<a href="/feed/x-people/weekly.xml" className="text-accent hover:underline">RSS</a> · 数据每周一更新 · 本页只读本站采集
        </span>
        <span>数据截至 {monthDay(week.end)}（北京时间）</span>
      </footer>
    </div>
  );
}

/** 这一周是当年的第几周（ISO 周号），只用于刊头。 */
function weekNumber(start: string): number {
  const date = new Date(`${start}T00:00:00Z`);
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
