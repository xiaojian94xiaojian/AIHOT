// 单个博主的多维画像：先看三条核心指标，再看节奏、时段、内容与爆款特征。
// 版式按分析类 UI 的常见做法：顶部 KPI 卡片带迷你趋势线，下面才是诊断图表；
// 口径只讲数据里的相关性，不当作因果。
import { Link, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { CATEGORY_LABEL, KIND_LABEL, REGION_LABEL, type XCount, type XFormat, type XPersonGrowth, type XPersonResponse, type XPost } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { beijingTime, monthDay } from "@aihot/contracts/time";
import { IconArrowUpRight, IconExternal } from "@aihot/web/components/icons";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
import { AreaChart, Bars, Heatmap, Rows, Spark } from "./charts";
import { SubscribeButton } from "./subscribe";
import { categoryName, compact, languageName, mediaName, percent, signed, signedPercent, stamp } from "./format";
import { IconClock, IconFlame, IconZap, IconHeart, IconImage, IconMessageCircle, IconQuote, IconRepeat } from "./icons";

export async function loader({ params, request }: { params: { handle?: string }; request: Request }) {
  const handle = params.handle ?? "";
  return loadOr404<XPersonResponse>(`/api/site/x-people/${encodeURIComponent(handle)}`, { signal: request.signal });
}

export function meta({ loaderData }: { loaderData?: XPersonResponse }) {
  if (!loaderData) return pageMeta({ title: "博主画像", path: "/x-people" });
  const { person } = loaderData;
  return pageMeta({
    title: `${person.author}（@${person.handle}）的 X 数据画像`,
    description: `${person.author} 近期的发帖节奏、互动表现与内容结构：共 ${person.posts} 条帖子，中位浏览 ${compact(person.medViews)}。`,
    path: `/x-people/${person.handle}`,
  });
}

export function headers() {
  return edgeTtl(600);
}
/** 手机底栏的「工具」标签：这几个页面都归在它下面。 */
export const handle = { tab: "x-tools", name: "博主" } as const;

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function delta(recent: number, previous: number): string | null {
  if (!previous) return null;
  const pct = ((recent - previous) / previous) * 100;
  if (Math.abs(pct) < 1) return "持平";
  return `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct).toFixed(0)}%`;
}

/** 顶部 KPI 卡片：标签、大数、同比、迷你趋势线、脚注。 */
function Kpi({ label, value, change, spark, footer }: {
  label: string;
  value: string;
  change?: string | null;
  spark: number[];
  footer: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-[12px] text-ink-3">
        <span className="font-medium">{label}</span>
        {change && <span className={`num text-[11px] font-bold ${change.startsWith("↓") ? "text-ink-3" : "text-accent"}`}>{change}</span>}
      </div>
      <div className="num mt-1.5 text-[28px] font-black leading-none tracking-[-0.03em] text-ink lg:text-[30px]">{value}</div>
      <div className="mt-2"><Spark points={spark} height={30} /></div>
      <div className="mt-1 text-[11px] text-ink-4">{footer}</div>
    </div>
  );
}

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

/** 标签在画像页上的短名，和榜单一致。 */
const SIGNAL_NOTE = { quiet: "本期无发帖", thin: "发帖少", caution: "需核对" } as const;

/** 每天涨粉的小柱：正的增长用主色，掉粉用灰色，缺快照的日子不画。 */
function DailyDeltas({ daily }: { daily: XPersonGrowth["daily"] }) {
  const points = daily.filter((point): point is { on: string; followers: number; delta: number } => point.delta !== null);
  const [activePoint, setActivePoint] = useState<{ on: string; followers: number; delta: number } | null>(null);
  if (points.length === 0) return <p className="text-[13px] text-ink-3">还没有两次以上的快照。</p>;
  const max = Math.max(1, ...points.map((point) => Math.abs(point.delta)));
  return (
    <div className="rounded-card border border-line-soft bg-bg-sunk/30 p-3">
      <div className="flex items-center justify-between text-[11.5px] mb-2">
        <span className="font-semibold text-ink">近 {points.length} 次快照每日涨粉变化</span>
        <span aria-live="polite" className="num font-bold text-accent">
          {activePoint
            ? `${activePoint.on} · 净增 ${signed(activePoint.delta)} 粉丝`
            : <span className="text-ink-4 text-[11px] font-normal">点击或悬停柱状图查看单日明细</span>}
        </span>
      </div>
      <div className="flex h-24 items-end gap-[3px]" role="group" aria-label="每日涨粉柱状图，可用方向键逐个查看">
        {points.map((point) => {
          const isActive = activePoint?.on === point.on;
          return (
            <button
              key={point.on}
              type="button"
              onClick={() => setActivePoint((curr) => (curr?.on === point.on ? null : point))}
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setActivePoint(point); }}
              aria-pressed={isActive}
              tabIndex={isActive || (activePoint === null && point === points[0]) ? 0 : -1}
              data-daily={point.on}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const at = points.findIndex((item) => item.on === point.on);
                const next = points[(at + step + points.length) % points.length];
                setActivePoint(next);
                document.querySelector<HTMLElement>(`[data-daily="${next.on}"]`)?.focus();
              }}
              aria-label={`${point.on} 净增 ${signed(point.delta)} 粉丝`}
              className="group relative flex h-full flex-1 items-end focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
              title={`${point.on} ${signed(point.delta)}`}
            >
              <div
                className={`w-full rounded-t-mark transition-all ${
                  isActive
                    ? (point.delta >= 0 ? "bg-accent scale-y-105" : "bg-ink-3 scale-y-105")
                    : point.delta >= 0
                      ? "bg-accent/70 group-hover:bg-accent"
                      : "bg-ink-4/40 group-hover:bg-ink-3"
                }`}
                style={{ height: `${Math.max(3, (Math.abs(point.delta) / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-4 font-mono">
        <span>{points[0]?.on.slice(5)}</span>
        <span>{points[points.length - 1]?.on.slice(5)}</span>
      </div>
    </div>
  );
}

function copyNotes(person: XPersonResponse["person"], growth: XPersonGrowth, categories: XCount[], formats: XFormat[]): string[] {
  const notes: string[] = [];
  // 徽标要有解释，否则读者只看到一个「需核对」。
  if (growth.d7?.signal === "caution") {
    notes.push("涨粉与曝光不匹配，可能含站外传播、活动或买粉因素，先人工核对。");
  } else if (growth.d7?.signal === "quiet") {
    notes.push("这一期没发帖，涨粉不代表内容表现。");
  } else if (growth.d7?.signal === "thin") {
    notes.push("样本偏少，结论先打个折。");
  }
  if (growth.d7 && growth.d7.perK !== null && growth.d7.perK >= 2) {
    notes.push(`涨粉效率高：每千次曝光带来 ${growth.d7.perK.toFixed(1)} 个关注（只说明相关，不代表内容好坏）。`);
  }
  if (person.postsPerDay >= 2 && person.medViews >= 1000) {
    notes.push(`发帖节奏稳定在日均 ${person.postsPerDay} 条，且中位曝光保持在 ${compact(person.medViews)} 以上。`);
  }
  const topCat = categories[0];
  if (topCat && topCat.count >= 5) {
    notes.push(`题材聚焦：${categoryName(topCat.key)} 类内容占比最高（${topCat.count} 条）。`);
  }
  const textF = formats.find((f) => f.key === "text");
  const mediaF = formats.find((f) => f.key === "media");
  if (textF && mediaF) {
    if (textF.medViews > mediaF.medViews * 1.2) notes.push("纯文字帖子中位曝光明显高于带图推文，长文类的浏览中位更高。");
    else if (mediaF.medViews > textF.medViews * 1.2) notes.push("带图/视频推文的浏览中位更高。");
  }
  return notes.length ? notes : ["持续积累发帖数据中，样本足够后将自动生成打法借鉴。"];
}

/** 粉丝与涨粉：KPI、值得借鉴、每日涨粉、代表帖和每周模型观察。 */
function GrowthBlock({ growth, person, structure, categories, formats }: { growth: XPersonGrowth; person: XPersonResponse["person"]; structure: XPersonResponse["structure"]; categories: XCount[]; formats: XFormat[] }) {
  const d7 = growth.d7;
  const d30 = growth.d30;
  const confidence = { high: "高", medium: "中", low: "低" } as const;
  const notes = copyNotes(person, growth, categories, formats);
  return (
    <section className="mt-3 rounded-card border border-line bg-surface p-4 lg:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span className="block h-3.5 w-[3px] rounded-full bg-accent" />
          粉丝与涨粉
          {d7?.signal && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10.5px] font-normal text-ink-3">{SIGNAL_NOTE[d7.signal]}</span>}
        </h2>
        <span className="text-[11px] text-ink-4">
          快照 {monthDay(growth.updatedOn)}
          {d7 && ` · 7 日榜 ${d7.eligible} 个账号可排`}
        </span>
      </div>

      {/* 新鲜度 */}
      <p className={`mt-2 text-[11.5px] leading-relaxed ${growth.freshness.status === "normal" ? "text-ink-4" : "text-ink-2"}`}>
        {growth.freshness.status !== "normal" && <b className="mr-1.5 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] text-amber-ink">{growth.freshness.label}</b>}
        {growth.freshness.note}
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">粉丝</div>
          <div className="num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] text-ink">{compact(growth.followers)}</div>
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">7 日涨粉</div>
          <div className={`num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] ${d7 && d7.growth > 0 ? "text-accent" : "text-ink"}`}>
            {d7 ? signed(d7.growth) : "—"}
          </div>
          {d7 && <div className="mt-1 text-[11px] text-ink-4">{signedPercent(d7.pct)} · 发帖 {d7.posts} 条</div>}
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">7 日名次</div>
          <div className="num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] text-ink">{d7 ? `#${d7.rank}` : "—"}</div>
          <div className="mt-1 text-[11px] text-ink-4">
            {d7 ? `中文区 ${d7.rankZh === null ? "—" : `#${d7.rankZh} / ${d7.eligibleZh}`}` : "还没进榜"}
          </div>
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">每帖涨粉</div>
          <div className="num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] text-ink">{d7?.perPost == null ? "—" : signed(d7.perPost)}</div>
          {d7 && <div className="mt-1 text-[11px] text-ink-4">窗口内 {d7.posts} 条原创帖</div>}
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">每千曝光</div>
          <div className={`num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] ${d7?.perK != null ? "text-accent" : "text-ink"}`}>
            {d7?.perK == null ? "—" : d7.perK.toFixed(1)}
          </div>
          {d7 && <div className="mt-1 text-[11px] text-ink-4">{d7.perKMedian === null ? `同档（${d7.tier}）暂无可比样本` : `同档（${d7.tier}）中位 ${d7.perKMedian}`}</div>}
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">30 日涨粉</div>
          <div className={`num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] ${d30 && d30.growth > 0 ? "text-accent" : "text-ink"}`}>
            {d30 ? signed(d30.growth) : "—"}
          </div>
          <div className="mt-1 text-[11px] text-ink-4">{d30 ? (d30.enough ? `${signedPercent(d30.pct)} · ${d30.eligible} 个可排` : "排名数据积累中") : "快照还不够 30 天"}</div>
        </div>
      </div>

      {/* 近 7 日流量转化漏斗 */}
      {d7 && d7.views > 0 && (
        <div className="mt-3 rounded-card border border-line-soft bg-bg-sunk/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
            <span className="font-semibold text-ink">近 7 日流量转化漏斗</span>
            <span className="text-ink-4">曝光 → 转化率 {d7.growth > 0 ? ((d7.growth / d7.views) * 100).toFixed(2) : 0}% → 净增关注</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-control bg-surface border border-line p-2">
              <div className="text-[10.5px] text-ink-4">窗口曝光合计</div>
              <div className="num mt-0.5 text-[15px] font-bold text-ink">{compact(d7.views)}</div>
            </div>
            <div className="rounded-control bg-surface border border-line p-2">
              <div className="text-[10.5px] text-ink-4">每千曝光转化</div>
              <div className="num mt-0.5 text-[15px] font-bold text-accent">{d7.perK !== null ? `${d7.perK.toFixed(1)} 粉` : "—"}</div>
            </div>
            <div className="rounded-control bg-surface border border-line p-2">
              <div className="text-[10.5px] text-ink-4">净增粉丝沉淀</div>
              <div className="num mt-0.5 text-[15px] font-bold text-ink">{signed(d7.growth)}</div>
            </div>
          </div>
        </div>
      )}

      {/* 互动结构 */}
      <div className="mt-3 rounded-card border border-line px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[12.5px] font-medium text-ink">
            互动结构<span className="ml-1.5 text-[11px] font-normal text-ink-4">每千次曝光里，平均有多少人做这个动作</span>
          </h3>
          <Link to="/x-people/methodology#algorithm" className="text-[11.5px] text-accent hover:underline">为什么看回复和引用 →</Link>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          {([
            ["点赞", person.perK.likes, structure.median.likes, false, <IconHeart size={14} className="text-ink-4" />],
            ["转发", person.perK.reposts, structure.median.reposts, false, <IconRepeat size={14} className="text-ink-4" />],
            ["回复", person.perK.replies, structure.median.replies, true, <IconMessageCircle size={14} className="text-accent" />],
            ["引用", person.perK.quotes, structure.median.quotes, true, <IconQuote size={14} className="text-accent" />],
          ] as const).map(([label, value, median, counts, icon]) => {
            const diffPct = median > 0 ? Math.round(((value - median) / median) * 100) : 0;
            return (
              <div key={label} className={`rounded-card px-2 py-2.5 transition-all ${counts ? "bg-accent-soft/40 ring-1 ring-accent/30" : "bg-bg-sunk/60"}`}>
                <div className="flex items-center justify-center mb-1">{icon}</div>
                <div className={`num text-[16px] font-black ${counts ? "text-accent" : "text-ink"}`}>{value.toFixed(1)}</div>
                <div className="text-[11px] font-medium text-ink-2 mt-0.5">{label}</div>
                <div className="text-[10px] text-ink-4">中位 {median.toFixed(1)}</div>
                <div className={`mt-0.5 text-[9.5px] font-bold ${diffPct >= 0 ? "text-accent" : "text-ink-4"}`}>
                  {diffPct >= 0 ? `+${diffPct}%` : `${diffPct}%`}
                </div>
                {counts && <div className="mt-1 text-[9.5px] font-bold text-accent">权重 5.0×</div>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 rounded-card bg-bg-sunk/50 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-2">{structure.verdict}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
          「中位」是站内所有账号同一口径的中位数。X 的排序里，回复和引用（高亮的两项）比点赞权重大得多——
          所以看的是它们相对点赞有多少，而不是绝对值大小。
        </p>
      </div>

      <div className="mt-4 rounded-card border border-accent/25 bg-accent-soft p-3.5">
        <h3 className="text-[12.5px] font-medium text-accent">值得借鉴</h3>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          {notes.map((note, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-[3px] size-1.5 shrink-0 rounded-full bg-accent/70" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <DailyDeltas daily={growth.daily} />
      </div>

      <div className="mt-4">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-medium text-ink">近 7 日代表帖<span className="ml-1.5 text-[11px] font-normal text-ink-4">浏览前 5 + 互动率前 3，最多 10 条</span></h3>
          <div className="mt-2">
            {growth.topPosts.length ? <PostList posts={growth.topPosts} /> : <p className="text-[13px] text-ink-3">这一周还没有抓到它的帖子。</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-card border border-line-soft bg-bg-sunk/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-medium text-ink">
            本周涨粉观察{growth.report && <span className="ml-2 text-[11px] font-normal text-ink-4">{monthDay(growth.report.periodEnd)} · 置信度{confidence[growth.report.confidence]}</span>}
          </h3>
          <Link to="/x-people/weekly" className="text-[11.5px] text-accent hover:underline">全部观察</Link>
        </div>
        {growth.report ? (
          <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-ink-2">
            <p className="text-ink">{growth.report.conclusion}</p>
            <ul className="space-y-1.5">
              {growth.report.drivers.map((driver, index) => (
                <li key={index}>
                  <span className="text-ink">{driver.why}</span>
                  {driver.evidence && <span className="text-ink-3">（依据：{driver.evidence}）</span>}
                </li>
              ))}
            </ul>
            {growth.report.moves.length > 0 && <p className="text-ink-3">可复用：{growth.report.moves.join("；")}</p>}
            <p className="text-[11px] text-ink-4">模型根据这一周的发帖与同期报道写的观察，不是结论；{growth.report.model ?? ""}</p>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-ink-3">每周一生成；中文区、7 日涨粉超过 1000 的账号会有条目。</p>
        )}
      </div>
    </section>
  );
}

function PostList({ posts }: { posts: XPost[] }) {
  if (!posts.length) return <p className="text-[13px] text-ink-3">暂无。</p>;
  return (
    <ol className="divide-y divide-line-soft">
      {posts.map((post, index) => (
        <li key={post.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <span className="num mt-0.5 w-5 shrink-0 text-[12px] text-ink-4">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 break-words text-[13px] leading-relaxed text-ink">{post.text || "（无文字）"}</p>
            <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
              <span className="text-ink-2">浏览 {compact(post.views)}</span>
              {post.projected24h != null && <span title="按 X 热门池的 8 小时半衰模型，从采集那一刻反推">预计 24h {compact(post.projected24h)}</span>}
              {post.breakout != null && post.breakout >= 1.1 && (<span className="text-accent font-medium" title="看的人比关注它的人多：说明这条被推荐给了没关注它的人">浏览是粉丝的 {post.breakout.toFixed(1)} 倍</span>)}
              <span>赞 {compact(post.likes)}</span>
              <span>转 {compact(post.retweets)}</span>
              {post.replies > 0 && <span>评 {compact(post.replies)}</span>}
              {post.quotes > 0 && <span>引 {compact(post.quotes)}</span>}
              <span>{stamp(post.at)}</span>
              {post.isReply && <span className="text-ink-4">回复</span>}
              <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-ink-3 hover:text-ink">
                原帖 <IconExternal size={11} />
              </a>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function PersonPage() {
  const { person, structure, weekly, trend, hours, weekdays, heatmap, formats, hits, best, categories, tags, languages, media, topPosts, growth } = useLoaderData<typeof loader>();
  const [heatMetric, setHeatMetric] = useState<"medViews" | "posts">("medViews");
  // 当前小时只在客户端算：SSR 和 hydration 跨小时会不一致，页面还被 edge 缓存 10 分钟。
  const [nowHour, setNowHour] = useState<number | null>(null);
  useEffect(() => { setNowHour(Number(beijingTime(new Date()).slice(0, 2))); }, []);
  const hasTrend = person.days >= 56;
  const mediaFormat = formats.find((f) => f.key === "media");
  const textFormat = formats.find((f) => f.key === "text");
  const better = mediaFormat && textFormat ? (mediaFormat.medViews >= textFormat.medViews ? "带图/视频" : "纯文字") : null;
  const weeklyEngagement = weekly.map((w) => (w.views ? (w.likes / w.views) * 100 : 0));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">{person.author}</span>
      </nav>

      <header className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-4 p-4 lg:p-5">
          <SourceAvatar name={person.author} avatarUrl={person.avatar} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">{person.author}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
              <span className="num font-mono">@{person.handle}</span>
              <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{REGION_LABEL[person.region]}</span>
              <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{KIND_LABEL[person.kind]}</span>
              {person.category && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{CATEGORY_LABEL[person.category]}</span>}
              <a href={`https://x.com/${person.handle}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[28px] items-center gap-0.5 hover:text-ink">
                X 主页 <IconArrowUpRight size={12} />
              </a>
              <SubscribeButton handle={person.handle} label="订阅周报" className="hover:text-ink" />
              <Link to={`/x-people/compare?h=${person.handle}`} className="hover:text-ink">
                加入对比
              </Link>
              <span>数据 {stamp(person.firstAt)} — {stamp(person.lastAt)}</span>
            </div>
          </div>
          {/* 手机上这三个数单独一行 */}
          <div className="num flex w-full flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink-3 lg:w-auto lg:text-right">
            <span><span className="text-ink-4">日均 </span>{person.postsPerDay} 条</span>
            <span><span className="text-ink-4">活跃 </span>{person.activeDays} 天</span>
            <span><span className="text-ink-4">带媒体 </span>{percent(person.mediaPct)}</span>
          </div>
        </div>
      </header>

      {growth && <GrowthBlock growth={growth} person={person} structure={structure} categories={categories} formats={formats} />}

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <Kpi
          label="帖子"
          value={compact(person.posts)}
          change={hasTrend ? delta(trend.recent.posts, trend.previous.posts) : null}
          spark={weekly.map((w) => w.posts)}
          footer={`活跃 ${person.activeDays} 天 / 跨度 ${person.days} 天`}
        />
        <Kpi
          label="中位浏览"
          value={compact(person.medViews)}
          change={hasTrend ? delta(trend.recent.medViews, trend.previous.medViews) : null}
          spark={weekly.map((w) => w.medViews)}
          footer={`P90 ${compact(person.p90Views)} · 平均 ${compact(person.avgViews)}`}
        />
        <Kpi
          label="互动率"
          value={percent(person.engagementRate)}
          change={hasTrend ? delta(trend.recent.engagementRate, trend.previous.engagementRate) : null}
          spark={weeklyEngagement}
          footer={`中位赞 ${compact(person.medLikes)} · 最高 ${compact(person.topLikes)}`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="发布节奏" hint="最近 12 周">
          {weekly.length
            ? <Bars data={weekly.map((w) => ({ label: w.label, value: w.posts }))} height={92} format={(n) => `${n} 条`} />
            : <p className="text-[13px] text-ink-3">暂无。</p>}
        </Section>
        <Section title="每周中位浏览" hint="最近 12 周">
          {weekly.length
            ? <AreaChart data={weekly.map((w) => ({ label: w.label, value: w.medViews }))} height={132} format={compact} />
            : <p className="text-[13px] text-ink-3">暂无。</p>}
        </Section>
      </div>

      <Section
        className="mt-3"
        title="发布时间"
        hint={heatMetric === "medViews" ? "颜色 = 中位浏览" : "颜色 = 帖子数"}
      >
        {best.hour !== null && (
          <div className="mb-3 rounded-control border border-accent/30 bg-accent-soft/20 px-3 py-2 text-[12px] text-ink-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="inline-block size-2 rounded-full bg-accent animate-pulse" />
              <span>
                {nowHour === null
                  ? `历史黄金发布期：北京时间 ${String(best.hour).padStart(2, "0")}:00 前后（基于近 120 天中位曝光，样本 ≥3 帖）`
                  : nowHour === best.hour
                    ? `当前正处于历史黄金发布期（北京时间 ${String(best.hour).padStart(2, "0")}:00 前后）`
                    : `下一个黄金发布窗口约在 ${String(best.hour).padStart(2, "0")}:00 前后（北京时间，距离约 ${(best.hour - nowHour + 24) % 24} 小时）`}
              </span>
            </div>
            <span className="text-ink-4 text-[11px]">基于近 120 天中位曝光</span>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
            {best.hour !== null && <span className="rounded-full bg-bg-sunk px-2 py-0.5">最佳时段 {String(best.hour).padStart(2, "0")}:00</span>}
            {best.weekday !== null && <span className="rounded-full bg-bg-sunk px-2 py-0.5">最佳星期 {WEEKDAYS[best.weekday - 1]}</span>}
            {better && <span className="rounded-full bg-bg-sunk px-2 py-0.5">更优形式 {better}</span>}
          </div>
          <div className="flex gap-1 text-[11.5px]">
            {([["medViews", "中位浏览"], ["posts", "帖子数"]] as const).map(([key, label]) => {
              const active = heatMetric === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setHeatMetric(key)}
                  aria-pressed={active}
                  className={`min-h-[28px] rounded-full px-3 py-0.5 transition-colors ${
                    active ? "bg-accent text-accent-contrast font-medium" : "text-ink-3 hover:text-ink bg-bg-sunk/60"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <Heatmap cells={heatmap} metric={heatMetric} format={compact} />
      </Section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="爆款 vs 日常" hint="爆款 = 浏览前 10%">
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">爆款（浏览前 10%）与日常帖子的多维指标对比</caption>
            <thead>
              <tr className="border-b border-line-soft text-[11px] text-ink-3">
                <th scope="col" className="pb-2 text-left font-normal">指标</th>
                <th scope="col" className="pb-2 text-right font-normal">爆款 (前10%)</th>
                <th scope="col" className="pb-2 text-right font-normal">日常 (后90%)</th>
                <th scope="col" className="pb-2 text-right font-normal">反差提升 (Lift)</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              <tr>
                <td className="py-2 text-ink-2 font-medium">帖子数</td>
                <td className="py-2 text-right font-bold text-ink">{hits.top.posts}</td>
                <td className="py-2 text-right text-ink-3">{hits.rest.posts}</td>
                <td className="py-2 text-right text-ink-4">按 P90 切点</td>
              </tr>
              <tr>
                <td className="py-2 text-ink-2 font-medium">带媒体</td>
                <td className="py-2 text-right font-bold text-ink">{percent(hits.top.mediaPct)}</td>
                <td className="py-2 text-right text-ink-3">{percent(hits.rest.mediaPct)}</td>
                <td className={`py-2 text-right font-medium ${hits.top.mediaPct >= hits.rest.mediaPct ? "text-accent" : "text-ink-3"}`}>
                  {hits.top.mediaPct >= hits.rest.mediaPct ? "+" : ""}
                  {(hits.top.mediaPct - hits.rest.mediaPct).toFixed(1)} 个百分点
                  {hits.rest.mediaPct > 0 ? ` (${hits.top.mediaPct >= hits.rest.mediaPct ? "高出" : "仅为"} ${(hits.top.mediaPct / hits.rest.mediaPct).toFixed(1)}×)` : ""}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-ink-2 font-medium">回复占比</td>
                <td className="py-2 text-right font-bold text-ink">{percent(hits.top.replyPct)}</td>
                <td className="py-2 text-right text-ink-3">{percent(hits.rest.replyPct)}</td>
                <td className="py-2 text-right text-ink-3">
                  {hits.top.replyPct >= hits.rest.replyPct ? "+" : ""}
                  {(hits.top.replyPct - hits.rest.replyPct).toFixed(1)} 个百分点
                  {hits.rest.replyPct > 0 ? ` (${hits.top.replyPct >= hits.rest.replyPct ? "高出" : "仅为"} ${(hits.top.replyPct / hits.rest.replyPct).toFixed(1)}×)` : ""}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-ink-2 font-medium">平均字数</td>
                <td className="py-2 text-right font-bold text-ink">{hits.top.avgLength}</td>
                <td className="py-2 text-right text-ink-3">{hits.rest.avgLength}</td>
                <td className="py-2 text-right text-ink-2">
                  {hits.top.avgLength >= hits.rest.avgLength ? "+" : ""}
                  {hits.top.avgLength - hits.rest.avgLength} 字
                  {hits.rest.avgLength > 0 ? ` (${hits.top.avgLength >= hits.rest.avgLength ? "长" : "短"} ${(Math.max(hits.top.avgLength, hits.rest.avgLength) / Math.max(1, Math.min(hits.top.avgLength, hits.rest.avgLength))).toFixed(1)}×)` : ""}
                </td>
              </tr>
              <tr>
                <td className="py-2 text-ink-2 font-medium">中位浏览</td>
                <td className="py-2 text-right font-black text-accent">{compact(hits.top.medViews)}</td>
                <td className="py-2 text-right text-ink-3">{compact(hits.rest.medViews)}</td>
                <td className="py-2 text-right font-black text-accent">
                  {hits.rest.medViews > 0 ? `×${(hits.top.medViews / hits.rest.medViews).toFixed(1)} 倍` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="打法建议" hint="只陈述相关性">
          <div className="space-y-2">
            {best.hour !== null && (
              <div className="rounded-control border border-line-soft bg-bg-sunk/30 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                  <IconClock size={13} className="shrink-0" />
                  <span>黄金发布时段</span>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-2">
                  互动最好的时段是北京时间 <b className="num text-ink">{String(best.hour).padStart(2, "0")}:00</b> 前后，中位浏览 <b className="num text-ink">{compact(hours.find((h) => h.hour === best.hour)?.medViews ?? 0)}</b>。
                </p>
              </div>
            )}
            {best.weekday !== null && (
              <div className="rounded-control border border-line-soft bg-bg-sunk/30 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                  <IconClock size={13} className="shrink-0" />
                  <span>最佳星期窗口</span>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-2">
                  一周里 <b className="text-ink">{WEEKDAYS[best.weekday - 1]}</b> 的中位浏览最高（<span className="num text-ink">{compact(weekdays.find((w) => w.weekday === best.weekday)?.medViews ?? 0)}</span>）。
                </p>
              </div>
            )}
            {better && (
              <div className="rounded-control border border-line-soft bg-bg-sunk/30 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                  <IconImage size={13} className="shrink-0" />
                  <span>内容载体建议</span>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-2">
                  形式上 <b className="text-ink">{better}</b> 的中位浏览更高{mediaFormat ? `（${compact(mediaFormat.medViews)} vs ${compact(textFormat?.medViews ?? 0)}）` : ""}。
                </p>
              </div>
            )}
            <div className="rounded-control border border-line-soft bg-bg-sunk/30 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                <IconFlame size={13} className="shrink-0" />
                <span>爆款共性特征</span>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-2">
                爆款里带媒体占 <b className="text-ink">{percent(hits.top.mediaPct)}</b>、回复占 <b className="text-ink">{percent(hits.top.replyPct)}</b>（日常分别为 {percent(hits.rest.mediaPct)}、{percent(hits.rest.replyPct)}）。
              </p>
            </div>
            <div className="rounded-control border border-line-soft bg-bg-sunk/30 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-3">
                <IconZap size={13} className="shrink-0" />
                <span>发布节奏与规模</span>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-2">
                当前节奏约 <b className="num text-ink">{person.postsPerDay}</b> 条/天，日均浏览 <b className="num text-ink">{compact(person.avgViews)}</b>。
              </p>
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="内容结构" hint="按本站分析的分类（近 120 天）">
          <p className="mb-2 text-[11.5px] text-ink-4">近 120 天内容结构与题材偏好（占比 = 该题材帖数 ÷ 全部帖子（含未分类））：</p>
          {categories.length ? (
            <Rows
              data={categories.slice(0, 8).map((c) => {
                // 分母用全部帖子：categories 只含已分类的，未分类的不能从分母里消失。
                const total = person.posts || 1;
                const pct = Math.round((c.count / total) * 100);
                return {
                  label: categoryName(c.key),
                  value: c.count,
                  formatted: `${c.count} 帖 (${pct}%)`,
                };
              })}
            />
          ) : (
            <p className="text-[13px] text-ink-3">还没有分类分析。</p>
          )}
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t.key} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{t.key} · {t.count}</span>
              ))}
            </div>
          )}
        </Section>
        <Section title="形式与语言" hint="帖子占比">
          <Rows
            data={media.map((m) => {
              const total = media.reduce((sum, item) => sum + item.count, 0) || 1;
              const pct = Math.round((m.count / total) * 100);
              return {
                label: mediaName(m.key),
                value: m.count,
                formatted: `${m.count} 帖 (${pct}%)`,
              };
            })}
          />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {languages.map((l) => (
              <span key={l.key} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{languageName(l.key)} · {l.count}</span>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-4">
            回复占比 {percent(person.replyPct)} · 引用 {percent(person.quotePct)} · 带媒体 {percent(person.mediaPct)}
          </p>
        </Section>
      </div>

      <Section className="mt-3" title="浏览最高的帖子" hint="按浏览排序">
        <PostList posts={topPosts} />
      </Section>

      <p className="mt-5 text-[11.5px] leading-relaxed text-ink-4">
        点赞、转发、浏览是采集那一刻的快照，不是帖子最终数据；时间为北京时间。KPI 卡片里的同比只在账号有 8 周以上数据时显示，
        否则只看近 4 周。“打法建议”只说明数据里的相关性，不代表因果。
      </p>
    </div>
  );
}
