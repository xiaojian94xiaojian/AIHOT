// 跨账号内容方法论：把 335 个账号按各自 P90 切出的“爆款”放到一起，看共性，给可执行的发布建议。
// 只描述数据里的相关性，不当作因果。
import { Link, useLoaderData } from "react-router";
import type { XMethodologyResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { Bars } from "./charts";
import { categoryName, compact, languageName, mediaName, percent } from "./format";
import { IconAlertTriangle, IconClock, IconDoc, IconFlame, IconImage, IconLink, IconMessageCircle, IconSend, IconShieldAlert, IconTag, IconUsers, IconZap } from "./icons";

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
function getHookTag(text: string): string {
  if (text.includes("？") || text.includes("?")) return "互动发问";
  if (text.includes("：") || text.includes(":")) return "结构拆解";
  if (text.includes("1.") || text.includes("1、") || text.includes("一、")) return "清单盘点";
  return "高价值观点";
}


function Section({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-4 lg:p-5 shadow-sm ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-2.5">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-ink">
          <span className="block h-3.5 w-[3px] rounded-full bg-accent" />
          {title}
        </h2>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Stat({ label, value, sub, highlight, icon }: { label: string; value: string; sub: string; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-card border bg-surface p-3.5 shadow-sm transition-all ${highlight ? "border-accent/40 bg-accent-soft/20 ring-1 ring-accent/20" : "border-line"}`}>
      <div className="flex items-center justify-between gap-1 text-[11.5px] font-medium text-ink-3">
        <span>{label}</span>
        {icon && <span className="text-ink-4 shrink-0">{icon}</span>}
      </div>
      <div className={`num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] ${highlight ? "text-accent" : "text-ink"}`}>{value}</div>
      <div className="mt-1 text-[11px] text-ink-4">{sub}</div>
    </div>
  );
}

function RateTable({ caption, rows }: { caption: string; rows: Array<{ label: string; posts: number; hitRate: number; extra?: string }> }) {
  return (
    <table className="w-full text-[12.5px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line-soft text-[11px] text-ink-3">
          <th scope="col" className="pb-2 text-left font-semibold">类别</th>
          <th scope="col" className="pb-2 text-right font-semibold">帖子</th>
          <th scope="col" className="pb-2 text-right font-semibold">爆款率</th>
          <th scope="col" className="pb-2 text-right font-semibold">相对基准 (10%)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {rows.map((row) => (
          <tr key={row.label} className="transition-colors hover:bg-bg-sunk/40">
            <td className="py-2.5 font-medium text-ink-2">{row.label}</td>
            <td className="num py-2.5 text-right text-ink-3">{compact(row.posts)}</td>
            <td className="num py-2.5 text-right font-bold text-ink">{percent(row.hitRate)}</td>
            <td className="py-2.5 pl-3">
              <span className="block h-2 w-full overflow-hidden rounded-full bg-bg-sunk">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(2, row.hitRate * 5))}%` }} />
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
  const lift = (rate: number) => {
    const mult = (rate / Math.max(1, totals.hitRate)).toFixed(2);
    const diff = rate - totals.hitRate;
    const pct = Math.round((diff / Math.max(1, totals.hitRate)) * 100);
    return `×${mult} (${diff >= 0 ? "+" : ""}${pct}%)`;
  };
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
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6 space-y-4">
      <nav className="text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2 font-medium">内容方法论</span>
      </nav>

      <header>
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">内容方法论</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
          每个账号按自己的浏览 P90 切出爆款，再把 {totals.accounts} 个账号的 {compact(totals.posts)} 条帖子放到一起看：
          爆款在形式、字数、时段、题材上有什么共性。大号不会因为绝对浏览高而淹没小号的相对爆款。
        </p>
        <p className="mt-1 text-[12px] text-ink-4">
          只统计发布满 {totals.matureDays} 天的帖子：浏览是采集快照，新帖还没攒够曝光；回复字段数据源没有给，不参与对比。
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Link to="/x-people/growth" className="min-h-[32px] inline-flex items-center rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            回到涨粉榜
          </Link>
          <Link to="/x-people" className="min-h-[32px] inline-flex items-center rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            博主列表
          </Link>
          <Link to="/x-people/algorithm" className="min-h-[32px] inline-flex items-center rounded-full border border-line px-3 py-1 text-ink-2 transition-colors hover:border-accent hover:text-ink">
            算法视角
          </Link>
        </div>
      </header>

      {/* 核心盘面统计 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="参与账号" value={String(totals.accounts)} sub="至少 20 帖" icon={<IconUsers size={14} />} />
        <Stat label="样本帖子" value={compact(totals.posts)} sub="近 120 天" icon={<IconDoc size={14} />} />
        <Stat label="爆款样本" value={compact(totals.hits)} sub="各账号浏览前 10%" icon={<IconFlame size={14} className="text-accent" />} />
        <Stat label="基准爆款率" value={percent(totals.hitRate)} sub="10% 是切点本身" highlight icon={<IconZap size={14} className="text-accent" />} />
      </div>

      {/* 关键驱动统计 */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="带媒体 vs 纯文字" value={`${percent((mediaHit || 0) * 100)} / ${percent(textFormat?.hitRate ?? 0)}`} sub={`${compact(mediaPosts)} 条媒体帖 · 中位 ${compact(mediaViews)}`} icon={<IconImage size={14} />} />
        <Stat label="最稳字数段" value={bestLength ? `${bestLength.key} 字` : "—"} sub={bestLength ? `爆款率 ${percent(bestLength.hitRate)}` : ""} icon={<IconDoc size={14} />} />
        <Stat label="最佳发布时段" value={bestHours.length ? bestHours.map((h) => `${String(h.hour).padStart(2, "0")}:00`).join(" / ") : "—"} sub={bestWeekday ? `${WEEKDAYS[bestWeekday.weekday - 1]} 最高（${percent(bestWeekday.hitRate)}）` : ""} highlight icon={<IconClock size={14} className="text-accent" />} />
        <Stat label="最稳内容题材" value={bestCategory ? categoryName(bestCategory.key) : "—"} sub={bestCategory ? `爆款率 ${percent(bestCategory.hitRate)}` : ""} icon={<IconTag size={14} />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="爆款 vs 日常" hint="跨账号汇总">
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">爆款帖子与日常帖子的多维指标对比汇总</caption>
            <thead>
              <tr className="border-b border-line-soft text-[11px] text-ink-3">
                <th scope="col" className="pb-2 text-left font-semibold">指标</th>
                <th scope="col" className="pb-2 text-right font-semibold">爆款</th>
                <th scope="col" className="pb-2 text-right font-semibold">日常</th>
                <th scope="col" className="pb-2 text-right font-semibold">反差提升 (Lift)</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              <tr className="hover:bg-bg-sunk/40 transition-colors">
                <td className="py-2.5 text-ink-2 font-medium">帖子数</td>
                <td className="py-2.5 text-right font-bold text-ink">{compact(overall.top.posts)}</td>
                <td className="py-2.5 text-right text-ink-3">{compact(overall.rest.posts)}</td>
                <td className="py-2.5 text-right text-ink-4">按 P90 切点</td>
              </tr>
              <tr className="hover:bg-bg-sunk/40 transition-colors">
                <td className="py-2.5 text-ink-2 font-medium">带媒体</td>
                <td className="py-2.5 text-right font-bold text-accent">{percent(overall.top.mediaPct)}</td>
                <td className="py-2.5 text-right text-ink-3">{percent(overall.rest.mediaPct)}</td>
                <td className={`py-2.5 text-right font-bold ${overall.top.mediaPct >= overall.rest.mediaPct ? "text-accent" : "text-ink-3"}`}>
                  {(overall.top.mediaPct - overall.rest.mediaPct) >= 0 ? "+" : ""}{(overall.top.mediaPct - overall.rest.mediaPct).toFixed(1)} 个百分点
                  {overall.rest.mediaPct > 0 ? ` (${overall.top.mediaPct >= overall.rest.mediaPct ? "高出" : "仅为"} ${(overall.top.mediaPct / overall.rest.mediaPct).toFixed(1)}×)` : ""}
                </td>
              </tr>
              <tr className="hover:bg-bg-sunk/40 transition-colors">
                <td className="py-2.5 text-ink-2 font-medium">平均字数</td>
                <td className="py-2.5 text-right font-bold text-ink">{overall.top.avgLength}</td>
                <td className="py-2.5 text-right text-ink-3">{overall.rest.avgLength}</td>
                <td className="py-2.5 text-right text-ink-2">
                  {(overall.top.avgLength - overall.rest.avgLength) >= 0 ? "+" : ""}{overall.top.avgLength - overall.rest.avgLength} 字
                  {overall.rest.avgLength > 0 ? ` (${overall.top.avgLength >= overall.rest.avgLength ? "长" : "短"} ${(Math.max(overall.top.avgLength, overall.rest.avgLength) / Math.max(1, Math.min(overall.top.avgLength, overall.rest.avgLength))).toFixed(1)}×)` : ""}
                </td>
              </tr>
              <tr className="hover:bg-bg-sunk/40 transition-colors">
                <td className="py-2.5 text-ink-2 font-medium">中位浏览</td>
                <td className="py-2.5 text-right font-black text-accent">{compact(overall.top.medViews)}</td>
                <td className="py-2.5 text-right text-ink-3">{compact(overall.rest.medViews)}</td>
                <td className="py-2.5 text-right font-black text-accent">
                  {overall.rest.medViews > 0 ? `×${(overall.top.medViews / overall.rest.medViews).toFixed(1)} 倍` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="形式" hint="爆款率 = 该形式里进前 10% 的比例">
          <RateTable caption="各内容形式的帖子数与爆款率" rows={formats.map((f) => ({ label: mediaName(f.key), posts: f.posts, hitRate: f.hitRate, extra: `${lift(f.hitRate)} · 中位 ${compact(f.medViews)}` }))} />
        </Section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="字数" hint="按帖子字符数分段">
          <RateTable caption="不同字数区间的帖子数与爆款率" rows={lengths.map((l) => ({ label: `${l.key} 字`, posts: l.posts, hitRate: l.hitRate, extra: `${lift(l.hitRate)} · 中位 ${compact(l.medViews)}` }))} />
        </Section>
        <Section title="语言区" hint="按帖子语言">
          <RateTable caption="不同语言区域的帖子数与爆款率" rows={languages.map((l) => ({ label: languageName(l.key), posts: l.posts, hitRate: l.hitRate, extra: lift(l.hitRate) }))} />
          <div className="mt-4 border-t border-line-soft pt-3">
            <RateTable caption="地区维度的帖子数与爆款率对比" rows={regions.map((r) => ({ label: r.key === "zh" ? "中文区" : r.key === "en" ? "英文区" : "其他", posts: r.posts, hitRate: r.hitRate, extra: `${lift(r.hitRate)} · 带媒体 ${percent(r.mediaPct)}` }))} />
          </div>
        </Section>
      </div>

      <Section title="发布时间" hint="高度 = 爆款率（该时段帖子数的占比）">
        {bestHours.length > 0 && (
          <div className="mb-3 rounded-control border border-accent/30 bg-accent-soft/20 px-3 py-2 text-[12px] text-ink-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="inline-block size-2 rounded-full bg-accent animate-pulse" />
              <span>全盘最高爆款率时段：北京时间 <b>{bestHours.map((h) => `${String(h.hour).padStart(2, "0")}:00`).join(" / ")}</b></span>
            </div>
            <span className="text-ink-4 text-[11px]">样本 ≥200 帖 · 均值高出 {lift(bestHours[0].hitRate)}</span>
          </div>
        )}
        <Bars data={hourBars} height={110} labelEvery={3} format={(n) => `${n}%`} />
        <div className="mt-4 border-t border-line-soft pt-3">
          <Bars data={weekdayBars} height={70} format={(n) => `${n}%`} />
        </div>
      </Section>

      <Section title="题材" hint="按本站分析的分类，样本 ≥100 条">
        <RateTable caption="不同题材分类的帖子数与爆款率" rows={categories.map((c) => ({ label: categoryName(c.key), posts: c.posts, hitRate: c.hitRate, extra: lift(c.hitRate) }))} />
      </Section>

      <Section title="爆款样本" hint="按「浏览 / 该账号 P90 切点」的倍数排序">
        <ol className="divide-y divide-line-soft">
          {exemplars.map((post, index) => (
            <li key={`${post.handle}-${index}`} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
              <span className={`num mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${index < 3 ? "bg-accent/15 text-accent" : "bg-bg-sunk text-ink-4"}`}>
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="line-clamp-2 text-[13px] leading-relaxed text-ink font-medium">{post.text}</p>
                <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                  <Link to={`/x-people/${post.handle}`} className="text-ink font-semibold hover:text-accent">@{post.handle}</Link>
                  <span>浏览 <b className="text-ink">{compact(post.views)}</b></span>
                  <span>赞 <b className="text-ink">{compact(post.likes)}</b></span>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 font-bold text-accent">×{post.ratio.toFixed(1)} P90</span><span title="按句式粗分，不是模型判断" className="rounded-mark bg-bg-sunk px-1.5 py-0.5 text-[10px] text-ink-3 font-medium">{getHookTag(post.text)}</span>
                  <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto text-ink-4 hover:text-accent font-medium">原帖 →</a>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <div id="algorithm" className="scroll-mt-20">
        <Section title="X 官方公开的排序权重" hint="For You 算法，2026-11 版">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            X 把 For You 的排序代码公开在{" "}
            <a href="https://github.com/xai-org/x-algorithm" target="_blank" rel="noreferrer" className="text-accent hover:underline font-medium">xai-org/x-algorithm</a>
            ：最终分是「每个动作的预测概率 × 权重」相加。权重乘的是概率而不是互动计数，所以不能换算成「1 个举报抵消 468 个赞」——官方专门说明过这一点。
          </p>
          <div className="mt-3 overflow-hidden rounded-card border border-line shadow-xs">
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">X 官方公开的 For You 算法排序动作与对应权重表</caption>
              <thead>
                <tr className="border-b border-line bg-bg-sunk/60 text-[11px] text-ink-3">
                  <th scope="col" className="px-3.5 py-2.5 text-left font-semibold">正向动作</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">算法权重</th>
                  <th scope="col" className="px-3.5 py-2.5 text-left font-semibold">其他 / 负向动作</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">算法权重</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconLink size={13} className="text-accent shrink-0" />复制链接分享</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-accent text-[13px]">+20.0</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">点赞</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink">+0.708</td>
                </tr>
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconMessageCircle size={13} className="text-accent shrink-0" />回复 / 引用</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-accent text-[13px]">+5.0</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">点击帖子</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink">+0.274</td>
                </tr>
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconSend size={13} className="text-accent shrink-0" />DM 分享</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-accent text-[13px]">+5.0</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">打开外链</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink">+0.2</td>
                </tr>
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconUsers size={13} className="text-accent shrink-0" />关注作者</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-accent text-[13px]">+4.0</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">停留 / 停留时长</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink">+0.05 / +0.0075</td>
                </tr>
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">转发</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink font-semibold">+1.0</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconAlertTriangle size={13} className="text-hot shrink-0" />举报</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-hot text-[13px]">−234</td>
                </tr>
                <tr className="hover:bg-bg-sunk/40 transition-colors">
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium">分享</td>
                  <td className="num px-3.5 py-2.5 text-right text-ink font-semibold">+2.118</td>
                  <td className="px-3.5 py-2.5 text-ink-2 font-medium"><span className="flex items-center gap-1.5"><IconShieldAlert size={13} className="text-hot shrink-0" />静音 / 不想看 / 屏蔽</span></td>
                  <td className="num px-3.5 py-2.5 text-right font-black text-hot text-[13px]">−58.8 / −53.1 / −31.2</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="mt-3.5 space-y-2 text-[12.5px] leading-relaxed text-ink-2">
            <li className="border-l-2 border-accent pl-3.5 py-0.5">
              <b className="text-ink">回复与引用价值极高：</b>回复和引用（5.0）比点赞（0.708）值钱得多，结尾留一个能接话的问题，比「求赞」有用得多。
            </li>
            <li className="border-l-2 border-accent pl-3.5 py-0.5">
              <b className="text-ink">外链后置原则：</b>外链权重极低（打开外链 0.2），正文讲完整观点后再在评论区或文末放链接，别一上来甩链接。
            </li>
            <li className="border-l-2 border-accent pl-3.5 py-0.5">
              <b className="text-ink">48 小时时效性：</b>超过 48 小时的帖子不再进入推荐流，新闻与热点类内容必须当天抓紧发。
            </li>
            <li className="border-l-2 border-accent pl-3.5 py-0.5">
              <b className="text-ink">同屏连发折扣：</b>同一作者在同一屏里的第 2、3 条会被折扣衰减——这是同批人在一屏内的显示折扣，非账号整体流量降权：<Link to="/x-people/algorithm" className="text-accent hover:underline font-medium">我们用数据回测过</Link>，同日多发在账号总浏览层面看不到下降。
            </li>
            <li className="border-l-2 border-hot pl-3.5 py-0.5">
              <b className="text-hot">负向惩罚严厉：</b>举报、屏蔽、静音的权重是正向互动的几十倍（见上表）：标题党、引战搬运争议要付出的代价，远高于一次点赞。
            </li>
          </ul>
          <p className="mt-2.5 text-[11px] text-ink-4">来源：xai-org/x-algorithm 的 home-mixer/params/param.rs（2026-11-04 同步）。</p>
        </Section>
      </div>

      <Section title="可执行清单" hint="只陈述相关性，不保证因果">
        <ul className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
          {mediaHit > 0 && textFormat && (
            <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">
              带媒体的爆款率是 <span className="text-ink font-semibold">{percent(mediaHit * 100)}</span>，纯文字是 <span className="text-ink font-semibold">{percent(textFormat.hitRate)}</span>
              {mediaHit * 100 > textFormat.hitRate ? "——配图/视频在数据上更容易起量。" : "——纯文字并不吃亏，长文/观点反而稳。"}
            </li>
          )}
          {bestLength && <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">字数上 <span className="text-ink font-semibold">{bestLength.key}</span> 的爆款率最高（{percent(bestLength.hitRate)}），可以先按这个区间写。</li>}
          {bestHours.length > 0 && (
            <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">发布时间上，<span className="text-ink font-semibold">{bestHours.map((h) => `${String(h.hour).padStart(2, "0")}:00`).join("、")}</span>（北京时间）的爆款率最高。</li>
          )}
          {bestCategory && <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">题材上 <span className="text-ink font-semibold">{categoryName(bestCategory.key)}</span> 最稳（{percent(bestCategory.hitRate)}），适合作为日常主线。</li>}
          {bestLanguage && <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">语言区里 <span className="text-ink font-semibold">{languageName(bestLanguage.key)}</span> 的爆款率最高（{percent(bestLanguage.hitRate)}），跨区发布时可以据此分配精力。</li>}
          <li className="border-l-2 border-accent/40 pl-3.5 py-0.5">样本与口径：爆款 = 账号自己浏览前 10%，互动是采集瞬间的快照；不同赛道差异很大，建议先用自己账号的画像对照再抄。</li>
        </ul>
      </Section>
    </div>
  );
}
