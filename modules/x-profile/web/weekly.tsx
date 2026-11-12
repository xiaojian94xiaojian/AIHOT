// 公开周报：每周一期的中文 AI 圈涨粉周报。数字来自本站采集的快照与帖子，页面只读结果，不调模型。
// 只列已经过完的周；某一周快照不够就直说数据不足，不拿相邻周凑趋势。
import { Link, useLoaderData } from "react-router";
import type { XWeeklyResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDay } from "@aihot/contracts/time";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
import { signed } from "./format";
import { IconClock, IconTarget, IconTrendingUp, IconTrophy, IconZap } from "./icons";

export async function loader({ request }: { request: Request }) {
  const week = new URL(request.url).searchParams.get("week");
  return loadOr404<XWeeklyResponse>(`/api/site/x-people/weekly${week ? `?week=${encodeURIComponent(week)}` : ""}`, { signal: request.signal });
}

export function meta() {
  return [
    ...pageMeta({
      title: "中文 AI 圈涨粉周报",
      description: "每周一期：中文 AI 圈这一周谁涨粉最多、哪条帖子最火、大家发的是什么形态。数字来自本站自己的采集与粉丝快照，可核对。",
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

export default function WeeklyPage() {
  const { week, weeks, rows, darkHorses, patterns, compare, viral, shape, summary } = useLoaderData<typeof loader>();
  const at = weeks.indexOf(week.start);
  const older = at >= 0 && at < weeks.length - 1 ? weeks[at + 1]! : null;
  const newer = at > 0 ? weeks[at - 1]! : null;
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people/growth" className="hover:text-ink">涨粉榜</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">涨粉周报</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">中文 AI 圈涨粉周报</h1>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          {monthDay(week.start)} – {monthDay(week.end)}：本周涨粉前十、这一周最火的帖子、
          大家发的是什么形态。只算中文账号（近 120 天抓到的帖子里中文占一半以上）；涨粉按本周快照与基线快照相减、
          稀疏基线折算成一周，基线超过 14 天的不进榜。
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

      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "在发账号", value: summary.accounts.toLocaleString("en-US") },
          { label: "本周帖子", value: summary.posts.toLocaleString("en-US") },
          { label: "总浏览", value: compact(summary.views) },
          { label: "带图/视频", value: `${summary.mediaPct}%` },
        ].map((card) => (
          <div key={card.label} className="rounded-card border border-line bg-surface px-3 py-2.5">
            <div className="text-[11px] text-ink-3">{card.label}</div>
            <div className="num mt-0.5 text-[17px] font-bold text-ink">{card.value}</div>
          </div>
        ))}
      </section>

      {patterns.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink"><IconTarget className="size-4 text-accent" />本周观察：能照着做的几件事</h2>
          <ul className="mt-2 space-y-2">
            {patterns.map((pattern) => (
              <li key={pattern.title} className="rounded-card border border-line bg-surface px-3 py-2.5">
                <div className="text-[13px] font-semibold text-ink">{pattern.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{pattern.detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">观察只从本周采集到的帖子里算，不调模型；爆款样本没采满时不写爆款观察。全周基线包含回复和引用，爆款基本是原帖。</p>
        </section>
      )}

      <section className="mt-6">
        <div className="flex items-end justify-between">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink"><IconTrophy className="size-4 text-accent" />本周涨粉 TOP 10</h2>
          <span className="text-[11px] text-ink-3">按净增粉丝排序 · 每千曝光涨粉 = 涨粉 ÷ 本周浏览 × 1000</span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface px-3 py-6 text-center text-[13px] text-ink-3">
            这一周的快照不够，涨粉榜暂缺。等采集补齐后会自动出现。
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-ink-3">
                  <th className="w-10 px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">账号</th>
                  <th className="px-3 py-2 font-normal text-right">粉丝</th>
                  <th className="px-3 py-2 font-normal text-right">本周涨粉</th>
                  <th className="hidden px-3 py-2 font-normal text-right sm:table-cell">涨幅</th>
                  <th className="px-3 py-2 font-normal text-right">本周帖</th>
                  <th className="px-3 py-2 font-normal text-right">千曝涨粉</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.handle} className="border-b border-line/60 last:border-0">
                    <td className="num px-3 py-2 text-ink-3">
                      {row.rank}
                      {row.rankPrev == null ? (
                        <span className="ml-1 text-[10px] text-emerald-600">新</span>
                      ) : row.rankPrev > row.rank ? (
                        <span className="ml-1 text-[10px] text-emerald-600">↑{row.rankPrev - row.rank}</span>
                      ) : row.rankPrev < row.rank ? (
                        <span className="ml-1 text-[10px] text-rose-500">↓{row.rank - row.rankPrev}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/x-people/${row.handle}`} className="group inline-flex min-w-0 items-center gap-2">
                        <SourceAvatar avatarUrl={row.avatarUrl} name={row.name ?? row.handle} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink group-hover:text-accent">{row.name ?? `@${row.handle}`}</span>
                          <span className="block truncate text-[11px] text-ink-3">@{row.handle}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="num px-3 py-2 text-right text-ink-2">{compact(row.followers)}</td>
                    <td className="num px-3 py-2 text-right font-semibold text-emerald-600">{signed(row.growth)}</td>
                    <td className="num hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{row.growthPct}%</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.posts}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{row.perK == null ? "—" : row.perK}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-end justify-between">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink"><IconTrendingUp className="size-4 text-accent" />小账号黑马</h2>
          <span className="text-[11px] text-ink-3">粉丝 1 千–5 万、本周涨粉 ≥300 · 按涨幅排序（按快照跨度折算成 7 天）</span>
        </div>
        {darkHorses.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface px-3 py-6 text-center text-[13px] text-ink-3">这一周没有符合条件的小账号。</p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {darkHorses.map((row) => (
              <div key={row.handle} className="rounded-card border border-line bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/x-people/${row.handle}`} className="group inline-flex min-w-0 items-center gap-2">
                    <SourceAvatar avatarUrl={row.avatarUrl} name={row.name ?? row.handle} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-accent">{row.name ?? `@${row.handle}`}</span>
                      <span className="block truncate text-[11px] text-ink-3">{compact(row.followers)} 粉 · 本周 {row.posts} 帖</span>
                    </span>
                  </Link>
                  <span className="num shrink-0 text-right">
                    <span className="block text-[14px] font-bold text-emerald-600">{signed(row.growth)}</span>
                    <span className="block text-[11px] text-ink-3">{row.growthPct}%</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-ink"><IconZap className="size-4 text-accent" />本周爆款帖</h2>
        {viral.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface px-3 py-6 text-center text-[13px] text-ink-3">这一周没有采到带浏览数的帖子。</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {viral.map((post) => (
              <li key={post.url} className="rounded-card border border-line bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 text-[12px] text-ink-3">
                  <Link to={`/x-people/${post.handle}`} className="hover:text-ink">@{post.handle}</Link>
                  <span className="num">{compact(post.views)} 浏览 · {compact(post.likes)} 赞</span>
                </div>
                <a href={post.url} target="_blank" rel="noreferrer noopener" className="mt-1 block text-[13.5px] leading-relaxed text-ink hover:text-accent">
                  {post.text.length > 140 ? `${post.text.slice(0, 140)}…` : post.text}
                </a>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
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

      <section className="mt-6">
        <h2 className="text-[15px] font-bold text-ink">本周内容形态</h2>
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

      <section className="mt-6 rounded-card border border-line bg-surface px-3 py-2.5">
        <div className="flex items-end justify-between">
          <h2 className="text-[15px] font-bold text-ink">比上周</h2>
          <span className="text-[11px] text-ink-3">同口径 · 只算中文</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: "帖子", now: compare.posts, prev: compare.prevPosts },
            { label: "浏览", now: compare.views, prev: compare.prevViews },
            { label: "在发账号", now: compare.accounts, prev: compare.prevAccounts },
          ].map((item) => {
            const delta = item.prev > 0 ? Math.round(((item.now - item.prev) / item.prev) * 1000) / 10 : null;
            return (
              <div key={item.label} className="text-[12px]">
                <span className="text-ink-3">{item.label}</span>
                <span className="num ml-1.5 font-semibold text-ink">{compact(item.now)}</span>
                {delta != null && (
                  <span className={`num ml-1.5 ${delta >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{delta >= 0 ? "+" : ""}{delta}%</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-2">上榜账号合计涨粉 {compact(compare.topGrowth)}，上周 {compact(compare.prevTopGrowth)}。</p>
      </section>

      <footer className="mt-8 text-[12px] text-ink-3">
        订阅：<a href="/feed/x-people/weekly.xml" className="text-accent hover:underline">RSS</a> · 数据每周一更新；本页只读本站采集。
      </footer>
    </div>
  );
}
