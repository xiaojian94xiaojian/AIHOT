// 跨账号内容方法论：把 335 个账号按各自 P90 切出的“爆款”放到一起，看共性，给可执行的发布建议。
// 只描述数据里的相关性，不当作因果。
import { Link, useLoaderData } from "react-router";
import type { XMethodologyResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { Bars } from "./charts";
import { categoryName, compact, languageName, mediaName, percent } from "./format";

export async function loader({ request }: { request: Request }) {
  return loadOr404<XMethodologyResponse>("/api/site/x-people/methodology", { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "内容方法论：AI 博主的爆款共性",
    description: "把本站采集的 AI 账号按各自浏览 P90 切出爆款，跨账号汇总形式、字数、时段与题材的规律。",
    path: "/x-people/methodology",
  });
}

export function headers() {
  return edgeTtl(600);
}
/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "内容方法论" } as const;


const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function Section({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 lg:p-5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span className="block h-3.5 w-[3px] rounded-full bg-accent" />
          {title}
        </h2>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num mt-1 text-[26px] font-black leading-none tracking-[-0.03em] text-ink">{value}</div>
      <div className="mt-1 text-[11px] text-ink-4">{sub}</div>
    </div>
  );
}

function RateTable({ rows }: { rows: Array<{ label: string; posts: number; hitRate: number; extra?: string }> }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-[11px] text-ink-3">
          <th className="pb-1.5 text-left font-normal">类别</th>
          <th className="pb-1.5 text-right font-normal">帖子</th>
          <th className="pb-1.5 text-right font-normal">爆款率</th>
          <th className="pb-1.5 text-right font-normal">对比</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="py-1.5 text-ink-2">{row.label}</td>
            <td className="num py-1.5 text-right text-ink-3">{compact(row.posts)}</td>
            <td className="num py-1.5 text-right text-ink">{percent(row.hitRate)}</td>
            <td className="py-1.5 pl-3">
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-bg-sunk">
                <span className="block h-full rounded-full bg-accent/75" style={{ width: `${Math.min(100, Math.max(2, row.hitRate * 5))}%` }} />
              </span>
              {row.extra && <span className="num mt-0.5 block text-right text-[10.5px] text-ink-4">{row.extra}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MethodologyPage() {
  const { totals, overall, formats, lengths, hours, weekdays, languages, categories, regions, exemplars } = useLoaderData<typeof loader>();
  const lift = (rate: number) => `×${(rate / Math.max(1, totals.hitRate)).toFixed(2)}`;
  const mediaFormats = formats.filter((f) => f.key !== "text");
  const textFormat = formats.find((f) => f.key === "text");
  const mediaHit = mediaFormats.length
    ? mediaFormats.reduce((sum, f) => sum + f.hits, 0) / Math.max(1, mediaFormats.reduce((sum, f) => sum + f.posts, 0))
    : 0;
  const mediaPosts = mediaFormats.reduce((sum, f) => sum + f.posts, 0);
  const mediaViews = Math.round(mediaFormats.reduce((sum, f) => sum + f.medViews * f.posts, 0) / Math.max(1, mediaPosts));
  const bestLength = [...lengths].sort((a, b) => b.hitRate - a.hitRate)[0];
  const enoughHours = hours.filter((h) => h.posts >= 200).sort((a, b) => b.hitRate - a.hitRate);
  const bestHours = enoughHours.slice(0, 2);
  const bestWeekday = [...weekdays].filter((w) => w.posts >= 500).sort((a, b) => b.hitRate - a.hitRate)[0];
  const bestCategory = [...categories].filter((c) => c.posts >= 300).sort((a, b) => b.hitRate - a.hitRate)[0];
  const bestLanguage = [...languages].sort((a, b) => b.hitRate - a.hitRate)[0];
  const hourBars = hours.map((h) => ({ label: String(h.hour), value: h.hitRate }));
  const weekdayBars = weekdays.map((w) => ({ label: WEEKDAYS[w.weekday - 1]?.replace("周", "") ?? String(w.weekday), value: w.hitRate }));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">内容方法论</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[26px] font-black tracking-[-0.02em] text-ink lg:text-[32px]">内容方法论</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
          每个账号按自己的浏览 P90 切出爆款，再把 {totals.accounts} 个账号的 {compact(totals.posts)} 条帖子放到一起看：
          爆款在形式、字数、时段、题材上有什么共性。大号不会因为绝对浏览高而淹没小号的相对爆款。
        </p>
        <p className="mt-1.5 text-[12px] text-ink-4">
          只统计发布满 {totals.matureDays} 天的帖子：浏览是采集快照，新帖还没攒够曝光；回复字段数据源没有给，不参与对比。
        </p>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="参与账号" value={String(totals.accounts)} sub="至少 20 帖" />
        <Stat label="样本帖子" value={compact(totals.posts)} sub="近 120 天" />
        <Stat label="爆款" value={compact(totals.hits)} sub="各账号浏览前 10%" />
        <Stat label="整体爆款率" value={percent(totals.hitRate)} sub="10% 是切点本身" />
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="带媒体 vs 纯文字" value={`${percent((mediaHit || 0) * 100)} / ${percent(textFormat?.hitRate ?? 0)}`} sub={`${compact(mediaPosts)} 条媒体帖 · 中位浏览 ${compact(mediaViews)}`} />
        <Stat label="最稳的字数段" value={bestLength ? `${bestLength.key} 字` : "—"} sub={bestLength ? `爆款率 ${percent(bestLength.hitRate)}` : ""} />
        <Stat label="最佳时段" value={bestHours.length ? bestHours.map((h) => `${String(h.hour).padStart(2, "0")}:00`).join(" / ") : "—"} sub={bestWeekday ? `${WEEKDAYS[bestWeekday.weekday - 1]} 最高（${percent(bestWeekday.hitRate)}）` : ""} />
        <Stat label="最稳的题材" value={bestCategory ? categoryName(bestCategory.key) : "—"} sub={bestCategory ? `爆款率 ${percent(bestCategory.hitRate)}` : ""} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="爆款 vs 日常" hint="跨账号汇总">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-ink-3">
                <th className="pb-1.5 text-left font-normal">指标</th>
                <th className="pb-1.5 text-right font-normal">爆款</th>
                <th className="pb-1.5 text-right font-normal">日常</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              <tr><td className="py-1.5 text-ink-2">帖子</td><td className="py-1.5 text-right">{compact(overall.top.posts)}</td><td className="py-1.5 text-right text-ink-3">{compact(overall.rest.posts)}</td></tr>
              <tr><td className="py-1.5 text-ink-2">带媒体</td><td className="py-1.5 text-right">{percent(overall.top.mediaPct)}</td><td className="py-1.5 text-right text-ink-3">{percent(overall.rest.mediaPct)}</td></tr>
              <tr><td className="py-1.5 text-ink-2">平均字数</td><td className="py-1.5 text-right">{overall.top.avgLength}</td><td className="py-1.5 text-right text-ink-3">{overall.rest.avgLength}</td></tr>
              <tr><td className="py-1.5 text-ink-2">中位浏览</td><td className="py-1.5 text-right">{compact(overall.top.medViews)}</td><td className="py-1.5 text-right text-ink-3">{compact(overall.rest.medViews)}</td></tr>
            </tbody>
          </table>
        </Section>

        <Section title="形式" hint="爆款率 = 该形式里进前 10% 的比例">
          <RateTable rows={formats.map((f) => ({ label: mediaName(f.key), posts: f.posts, hitRate: f.hitRate, extra: `${lift(f.hitRate)} · 中位 ${compact(f.medViews)}` }))} />
        </Section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="字数" hint="按帖子字符数分段">
          <RateTable rows={lengths.map((l) => ({ label: `${l.key} 字`, posts: l.posts, hitRate: l.hitRate, extra: `${lift(l.hitRate)} · 中位 ${compact(l.medViews)}` }))} />
        </Section>
        <Section title="语言区" hint="按帖子语言">
          <RateTable rows={languages.map((l) => ({ label: languageName(l.key), posts: l.posts, hitRate: l.hitRate, extra: lift(l.hitRate) }))} />
          <div className="mt-4 border-t border-line-soft pt-3">
            <RateTable rows={regions.map((r) => ({ label: r.key === "zh" ? "中文区" : r.key === "en" ? "英文区" : "其他", posts: r.posts, hitRate: r.hitRate, extra: `${lift(r.hitRate)} · 带媒体 ${percent(r.mediaPct)}` }))} />
          </div>
        </Section>
      </div>

      <Section className="mt-3" title="发布时间" hint="颜色/高度 = 爆款率（该时段帖子数的占比）">
        <Bars data={hourBars} height={110} labelEvery={3} format={(n) => `${n}%`} />
        <div className="mt-4 border-t border-line-soft pt-3">
          <Bars data={weekdayBars} height={70} format={(n) => `${n}%`} />
        </div>
      </Section>

      <Section className="mt-3" title="题材" hint="按本站分析的分类，样本 ≥100 条">
        <RateTable rows={categories.map((c) => ({ label: categoryName(c.key), posts: c.posts, hitRate: c.hitRate, extra: lift(c.hitRate) }))} />
      </Section>

      <Section className="mt-3" title="爆款样本" hint="按“浏览 / 该账号中位”的倍数排序">
        <ol className="divide-y divide-line-soft">
          {exemplars.map((post, index) => (
            <li key={`${post.handle}-${index}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="num mt-0.5 w-5 shrink-0 text-[12px] text-ink-4">{index + 1}</span>
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px] leading-relaxed text-ink">{post.text}</p>
                <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
                  <a href={`/x-people/${post.handle}`} className="text-ink-2 hover:text-ink">@{post.handle}</a>
                  <span>浏览 {compact(post.views)}</span>
                  <span>赞 {compact(post.likes)}</span>
                  <span className="text-accent">×{post.ratio.toFixed(1)} 中位</span>
                  <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto text-ink-3 hover:text-ink">原帖</a>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <div id="algorithm" className="mt-3 scroll-mt-20">
        <Section title="X 官方公开的排序权重" hint="For You 算法，2026-11 版">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            X 把 For You 的排序代码公开在{" "}
            <a href="https://github.com/xai-org/x-algorithm" target="_blank" rel="noreferrer" className="text-accent hover:underline">xai-org/x-algorithm</a>
            ：最终分是「每个动作的预测概率 × 权重」相加。权重乘的是概率而不是互动计数，所以不能换算成「1 个举报抵消 468 个赞」——官方专门说明过这一点。
          </p>
          <div className="mt-3 overflow-hidden rounded-card border border-line-soft">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line-soft text-[11px] text-ink-3">
                  <th className="px-3 py-1.5 text-left font-normal">动作</th>
                  <th className="px-3 py-1.5 text-right font-normal">权重</th>
                  <th className="px-3 py-1.5 text-left font-normal">动作</th>
                  <th className="px-3 py-1.5 text-right font-normal">权重</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                <tr><td className="px-3 py-1.5 text-ink-2">复制链接分享</td><td className="num px-3 py-1.5 text-right text-ink">20.0</td><td className="px-3 py-1.5 text-ink-2">点赞</td><td className="num px-3 py-1.5 text-right text-ink">0.708</td></tr>
                <tr><td className="px-3 py-1.5 text-ink-2">回复 / 引用</td><td className="num px-3 py-1.5 text-right text-ink">5.0</td><td className="px-3 py-1.5 text-ink-2">点击帖子</td><td className="num px-3 py-1.5 text-right text-ink">0.274</td></tr>
                <tr><td className="px-3 py-1.5 text-ink-2">DM 分享</td><td className="num px-3 py-1.5 text-right text-ink">5.0</td><td className="px-3 py-1.5 text-ink-2">打开外链</td><td className="num px-3 py-1.5 text-right text-ink">0.2</td></tr>
                <tr><td className="px-3 py-1.5 text-ink-2">关注作者</td><td className="num px-3 py-1.5 text-right text-ink">4.0</td><td className="px-3 py-1.5 text-ink-2">停留 / 停留时长</td><td className="num px-3 py-1.5 text-right text-ink">0.05 / 0.0075</td></tr>
                <tr><td className="px-3 py-1.5 text-ink-2">转发</td><td className="num px-3 py-1.5 text-right text-ink">1.0</td><td className="px-3 py-1.5 text-ink-2">举报</td><td className="num px-3 py-1.5 text-right text-hot">−234</td></tr>
                <tr><td className="px-3 py-1.5 text-ink-2">分享</td><td className="num px-3 py-1.5 text-right text-ink">2.118</td><td className="px-3 py-1.5 text-ink-2">静音 / 不想看 / 屏蔽</td><td className="num px-3 py-1.5 text-right text-hot">−58.8 / −53.1 / −31.2</td></tr>
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
            <li className="border-l-2 border-accent/40 pl-3">回复和引用比点赞值钱得多，结尾留一个能接话的问题，比「求赞」有用。</li>
            <li className="border-l-2 border-accent/40 pl-3">外链权重很低（打开外链 0.2），正文讲完再放链接，别一上来甩链接。</li>
            <li className="border-l-2 border-accent/40 pl-3">超过 48 小时的帖子不再进推荐，所以新闻类内容要当天发。</li>
            <li className="border-l-2 border-accent/40 pl-3">同一作者在同一屏里的第 2、3 条会被衰减——这是同一批人一屏内的折扣，不是账号整体的流量衰减：<a href="/x-people/algorithm" className="text-accent hover:underline">我们用数据回测过</a>，同日连发在账号层面看不到下降。</li>
            <li className="border-l-2 border-accent/40 pl-3">负向权重是正向的几十倍：标题党、引战、搬运争议内容，一次举报要几百个赞才能拉回来。</li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-4">来源：xai-org/x-algorithm 的 home-mixer/params/param.rs（2026-11-04 同步）。</p>
        </Section>
      </div>

      <Section className="mt-3" title="可执行清单" hint="只陈述相关性，不保证因果">
        <ul className="space-y-2 text-[13px] leading-relaxed text-ink-2">
          {mediaHit > 0 && textFormat && (
            <li className="border-l-2 border-accent/40 pl-3">
              带媒体的爆款率是 <span className="text-ink">{percent(mediaHit * 100)}</span>，纯文字是 <span className="text-ink">{percent(textFormat.hitRate)}</span>
              {mediaHit * 100 > textFormat.hitRate ? "——配图/视频在数据上更容易起量。" : "——纯文字并不吃亏，长文/观点反而稳。"}
            </li>
          )}
          {bestLength && <li className="border-l-2 border-accent/40 pl-3">字数上 <span className="text-ink">{bestLength.key}</span> 的爆款率最高（{percent(bestLength.hitRate)}），可以先按这个区间写。</li>}
          {bestHours.length > 0 && (
            <li className="border-l-2 border-accent/40 pl-3">发布时间上，<span className="text-ink">{bestHours.map((h) => `${String(h.hour).padStart(2, "0")}:00`).join("、")}</span>（北京时间）的爆款率最高。</li>
          )}
          {bestCategory && <li className="border-l-2 border-accent/40 pl-3">题材上 <span className="text-ink">{categoryName(bestCategory.key)}</span> 最稳（{percent(bestCategory.hitRate)}），适合作为日常主线。</li>}
          {bestLanguage && <li className="border-l-2 border-accent/40 pl-3">语言区里 <span className="text-ink">{languageName(bestLanguage.key)}</span> 的爆款率最高（{percent(bestLanguage.hitRate)}），跨区发布时可以据此分配精力。</li>}
          <li className="border-l-2 border-accent/40 pl-3">样本与口径：爆款 = 账号自己浏览前 10%，互动是采集瞬间的快照；不同赛道差异很大，建议先用自己账号的画像对照再抄。</li>
        </ul>
      </Section>
    </div>
  );
}
