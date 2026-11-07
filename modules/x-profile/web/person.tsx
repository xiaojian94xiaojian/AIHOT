// 单个博主的多维画像：先看三条核心指标，再看节奏、时段、内容与爆款特征。
// 版式按分析类 UI 的常见做法：顶部 KPI 卡片带迷你趋势线，下面才是诊断图表；
// 口径只讲数据里的相关性，不当作因果。
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { CATEGORY_LABEL, KIND_LABEL, REGION_LABEL, type XCount, type XFormat, type XPersonGrowth, type XPersonResponse, type XPost } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDay } from "@aihot/contracts/time";
import { IconArrowUpRight, IconExternal } from "@aihot/web/components/icons";
import { AreaChart, Bars, Heatmap, Rows, Spark } from "./charts";
import { SubscribeButton } from "./subscribe";
import { categoryName, compact, languageName, mediaName, percent, stamp } from "./format";

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
        <span>{label}</span>
        {change && <span className={`num text-[11px] ${change.startsWith("↓") ? "text-ink-3" : "text-accent"}`}>{change}</span>}
      </div>
      <div className="num mt-1.5 text-[30px] font-black leading-none tracking-[-0.03em] text-ink">{value}</div>
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

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${compact(Math.abs(n))}`;
const signedPercent = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(1).replace(/\.0$/, "")}%`;
/** 标签在画像页上的短名，和榜单一致。 */
const SIGNAL_NOTE = { quiet: "本期无发帖", thin: "发帖少", caution: "需核对" } as const;

/** 每天涨粉的小柱：正的增长用主色，掉粉用灰色，缺快照的日子不画。 */
function DailyDeltas({ daily }: { daily: XPersonGrowth["daily"] }) {
  const points = daily.filter((point): point is { on: string; followers: number; delta: number } => point.delta !== null);
  if (points.length === 0) return <p className="text-[13px] text-ink-3">还没有两次以上的快照。</p>;
  const max = Math.max(1, ...points.map((point) => Math.abs(point.delta)));
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="每日涨粉">
        {points.map((point) => (
          <div key={point.on} className="flex h-full flex-1 items-end" title={`${point.on} ${point.delta >= 0 ? "+" : ""}${point.delta}`}>
            <div
              className={`w-full rounded-t-mark ${point.delta >= 0 ? "bg-accent/70" : "bg-ink-4/40"}`}
              style={{ height: `${Math.max(3, (Math.abs(point.delta) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-ink-4">
        <span>{points[0]!.on.slice(5)}</span>
        <span>每日涨粉（{points.length} 次快照）</span>
        <span>{points[points.length - 1]!.on.slice(5)}</span>
      </div>
    </div>
  );
}

/** 值得借鉴：规则生成的三条，先讲内容结构，再讲效率对比，最后是标签提醒。 */
function copyNotes(person: XPersonResponse["person"], growth: XPersonGrowth, categories: XCount[], formats: XFormat[]): string[] {
  const notes: string[] = [];
  const total = categories.reduce((sum, item) => sum + item.count, 0);
  const top = [...categories].sort((a, b) => b.count - a.count)[0];
  const media = formats.find((format) => format.key === "media");
  const text = formats.find((format) => format.key === "text");
  const form = media && text ? (media.medViews >= text.medViews ? "带图/视频" : "纯文字") : null;
  if (top && total > 0) {
    notes.push(`近 30 天内容以「${categoryName(top.key)}」为主（${Math.round((top.count / total) * 100)}%）${form ? `，爆款样本偏「${form}」` : ""}。`);
  } else if (person.mediaPct > 0 || person.replyPct > 0) {
    // 没有分类数据（氛围源没有经过分析）时，用形式代替，别空着。
    notes.push(`近 120 天带图或视频占 ${person.mediaPct}%、回复占 ${person.replyPct}%，形式以${person.mediaPct >= 50 ? "图文" : "纯文字"}为主。`);
  }
  const d7 = growth.d7;
  if (d7?.perK != null) {
    // 正好等于中位时说「持平」，别写成「高于」。
    const compare = d7.perKMedian === null ? "" : d7.perK > d7.perKMedian ? "，高于中位" : d7.perK === d7.perKMedian ? "，与中位持平" : "，低于中位";
    const peer = d7.perKMedian === null ? "" : `，同粉丝档（${d7.tier}）中位 ${d7.perKMedian}${compare}`;
    notes.push(`每千曝光涨 ${d7.perK} 粉${peer}。`);
  }
  if (d7?.signal === "caution") notes.push("涨粉可能含站外传播、活动或买粉因素，先人工核对，别急着当榜样。");
  else if (d7?.signal === "quiet") notes.push("这一周没抓到它的帖子，涨粉来自外部，不能归因到内容。");
  else if (d7?.signal === "thin") notes.push("这一周只发了 1–2 条，样本太少，只能当参考。");
  else notes.push(`日均 ${person.postsPerDay} 条、浏览中位 ${compact(person.medViews)}，这个节奏可以照抄。`);
  return notes.slice(0, 3);
}

/** 粉丝与涨粉：KPI、值得借鉴、每日涨粉、代表帖、同期报道和每周模型观察。 */
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

      {/* 新鲜度：快照几天、覆盖多久，先说清楚再让人信这张曲线。 */}
      <p className={`mt-2 text-[11.5px] leading-relaxed ${growth.freshness.status === "normal" ? "text-ink-4" : "text-ink-2"}`}>
        {growth.freshness.status !== "normal" && <b className="mr-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-ink-2">{growth.freshness.label}</b>}
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
          <div className="num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] text-ink">{d7?.perPost == null ? "—" : `+${compact(d7.perPost)}`}</div>
          {d7 && <div className="mt-1 text-[11px] text-ink-4">窗口内 {d7.posts} 条原创帖</div>}
        </div>
        <div className="rounded-card border border-line px-3 py-2.5">
          <div className="text-[11.5px] text-ink-3">每千曝光</div>
          <div className={`num mt-1 text-[22px] font-black leading-none tracking-[-0.02em] ${d7?.perK != null ? "text-accent" : "text-ink"}`}>
            {d7?.perK == null ? "—" : d7.perK}
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

      {/* 互动结构：每千次曝光里各动作多少次，和全站中位比。权重只留一句解释，不给读者看数字。 */}
      <div className="mt-3 rounded-card border border-line px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[12.5px] font-medium text-ink">
            互动结构<span className="ml-1.5 text-[11px] font-normal text-ink-4">每千次曝光里，平均有多少人做这个动作</span>
          </h3>
          <Link to="/x-people/methodology#algorithm" className="text-[11.5px] text-accent hover:underline">为什么看回复和引用 →</Link>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          {([
            ["点赞", person.perK.likes, structure.median.likes, false],
            ["转发", person.perK.reposts, structure.median.reposts, false],
            ["回复", person.perK.replies, structure.median.replies, true],
            ["引用", person.perK.quotes, structure.median.quotes, true],
          ] as const).map(([label, value, median, counts]) => (
            <div key={label} className={`rounded-card px-1.5 py-1.5 ${counts ? "bg-accent/5 ring-1 ring-accent/20" : "bg-bg-sunk/60"}`}>
              <div className={`num text-[15px] font-semibold ${counts ? "text-accent" : "text-ink"}`}>{value.toFixed(1)}</div>
              <div className="text-[10.5px] text-ink-3">{label}</div>
              <div className="text-[10px] text-ink-4">中位 {median.toFixed(1)}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 rounded-card bg-bg-sunk/50 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-2">{structure.verdict}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
          「中位」是站内所有账号同一口径的中位数。X 的排序里，回复和引用（高亮的两项）比点赞值钱得多——
          所以看的是它们相对点赞有多少，而不是绝对值大小。
        </p>
      </div>

      <div className="mt-4 rounded-card border border-accent/25 bg-accent/5 p-3.5">
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-medium text-ink">近 7 日代表帖<span className="ml-1.5 text-[11px] font-normal text-ink-4">浏览前 5 + 互动率前 3，最多 10 条</span></h3>
          <div className="mt-2">
            {growth.topPosts.length ? <PostList posts={growth.topPosts} /> : <p className="text-[13px] text-ink-3">这一周还没有抓到它的帖子。</p>}
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-medium text-ink">同期站内报道里提到它</h3>
          {growth.related.length ? (
            <ul className="mt-2 space-y-2">
              {growth.related.map((item) => (
                <li key={item.id} className="text-[12.5px] leading-relaxed">
                  <a href={item.url} target="_blank" rel="noreferrer" className="break-words text-ink hover:text-accent">{item.title}</a>
                  <span className="num ml-1.5 text-[11px] text-ink-4">{monthDay(item.at.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-3">近 7 天的公开报道里没有按名字提到它的。</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-card border border-line-soft bg-bg-sunk/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-medium text-ink">
            本周涨粉观察{growth.report && <span className="ml-2 text-[11px] font-normal text-ink-4">{monthDay(growth.report.periodEnd)} · 置信度{confidence[growth.report.confidence]}</span>}
          </h3>
          <Link to="/x-people/growth/report" className="text-[11.5px] text-accent hover:underline">全部观察</Link>
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

function PostList({ posts }: { posts: XPost[] }) {  if (!posts.length) return <p className="text-[13px] text-ink-3">暂无。</p>;
  return (
    <ol className="divide-y divide-line-soft">
      {posts.map((post, index) => (
        <li key={post.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <span className="num mt-0.5 w-5 shrink-0 text-[12px] text-ink-4">{index + 1}</span>
          <div className="min-w-0">
            <p className="line-clamp-2 break-words text-[13px] leading-relaxed text-ink">{post.text || "（无文字）"}</p>
            <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
              <span className="text-ink-2">浏览 {compact(post.views)}</span>
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
  const { person, structure, weekly, trend, heatmap, formats, hits, best, categories, tags, languages, media, topPosts, growth } = useLoaderData<typeof loader>();
  const [heatMetric, setHeatMetric] = useState<"medViews" | "posts">("medViews");
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
          {person.avatar
            ? <img src={person.avatar} alt="" width={64} height={64} className="size-16 shrink-0 rounded-full bg-bg-sunk object-cover" />
            : <span className="grid size-16 shrink-0 place-items-center rounded-full bg-bg-sunk text-[22px] text-ink-3">{person.author.slice(0, 1)}</span>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[30px]">{person.author}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
              <span className="num">@{person.handle}</span>
              <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{REGION_LABEL[person.region]}</span>
              <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{KIND_LABEL[person.kind]}</span>
              {person.category && <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11px] text-ink-2">{CATEGORY_LABEL[person.category]}</span>}
              <a href={`https://x.com/${person.handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-ink">
                X 主页 <IconArrowUpRight size={12} />
              </a>
              <SubscribeButton handle={person.handle} label="订阅周报" className="hover:text-ink" />
              <Link to={`/x-people/compare?h=${person.handle}`} className="hover:text-ink">
                加入对比
              </Link>
              <span>数据 {stamp(person.firstAt)} — {stamp(person.lastAt)}</span>
            </div>
          </div>
          {/* 手机上这三个数单独一行：否则它们会把标题挤成一条竖线。 */}
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
            {best.hour !== null && <span className="rounded-full bg-bg-sunk px-2 py-0.5">最佳时段 {String(best.hour).padStart(2, "0")}:00</span>}
            {best.weekday !== null && <span className="rounded-full bg-bg-sunk px-2 py-0.5">最佳星期 {WEEKDAYS[best.weekday - 1]}</span>}
            {better && <span className="rounded-full bg-bg-sunk px-2 py-0.5">更优形式 {better}</span>}
          </div>
          <div className="flex gap-1 text-[11.5px]">
            {([["medViews", "中位浏览"], ["posts", "帖子数"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setHeatMetric(key)}
                className={`rounded-full px-2.5 py-0.5 transition-colors ${heatMetric === key ? "bg-accent text-white" : "text-ink-3 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Heatmap cells={heatmap} metric={heatMetric} format={compact} />
      </Section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="爆款 vs 日常" hint="爆款 = 浏览前 10%">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] text-ink-3">
                <th className="pb-1.5 text-left font-normal">指标</th>
                <th className="pb-1.5 text-right font-normal">爆款</th>
                <th className="pb-1.5 text-right font-normal">日常</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-soft">
              <tr><td className="py-1.5 text-ink-2">帖子</td><td className="py-1.5 text-right">{hits.top.posts}</td><td className="py-1.5 text-right text-ink-3">{hits.rest.posts}</td></tr>
              <tr><td className="py-1.5 text-ink-2">带媒体</td><td className="py-1.5 text-right">{percent(hits.top.mediaPct)}</td><td className="py-1.5 text-right text-ink-3">{percent(hits.rest.mediaPct)}</td></tr>
              <tr><td className="py-1.5 text-ink-2">回复</td><td className="py-1.5 text-right">{percent(hits.top.replyPct)}</td><td className="py-1.5 text-right text-ink-3">{percent(hits.rest.replyPct)}</td></tr>
              <tr><td className="py-1.5 text-ink-2">平均字数</td><td className="py-1.5 text-right">{hits.top.avgLength}</td><td className="py-1.5 text-right text-ink-3">{hits.rest.avgLength}</td></tr>
              <tr><td className="py-1.5 text-ink-2">中位浏览</td><td className="py-1.5 text-right">{compact(hits.top.medViews)}</td><td className="py-1.5 text-right text-ink-3">{compact(hits.rest.medViews)}</td></tr>
            </tbody>
          </table>
        </Section>

        <Section title="打法建议" hint="只陈述相关性">
          <ul className="space-y-2.5 text-[12.5px] leading-relaxed text-ink-2">
            {best.hour !== null && (
              <li className="border-l-2 border-accent/40 pl-3">互动最好的时段是 <span className="num text-ink">{String(best.hour).padStart(2, "0")}:00</span> 前后（北京时间），中位浏览 {compact(bestHourViews(best.hour, heatmap))}。</li>
            )}
            {best.weekday !== null && (
              <li className="border-l-2 border-accent/40 pl-3">一周里 <span className="text-ink">{WEEKDAYS[best.weekday - 1]}</span> 的中位浏览最高。</li>
            )}
            {better && (
              <li className="border-l-2 border-accent/40 pl-3">形式上 <span className="text-ink">{better}</span> 的中位浏览更高（{mediaFormat ? `${compact(mediaFormat.medViews)} vs ${compact(textFormat?.medViews ?? 0)}` : ""}）。</li>
            )}
            <li className="border-l-2 border-accent/40 pl-3">爆款里带媒体占 {percent(hits.top.mediaPct)}、回复占 {percent(hits.top.replyPct)}；日常分别是 {percent(hits.rest.mediaPct)}、{percent(hits.rest.replyPct)}。</li>
            <li className="border-l-2 border-accent/40 pl-3">当前节奏约 {person.postsPerDay} 条/天，日均浏览 {compact(person.avgViews)}。</li>
          </ul>
        </Section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Section title="内容结构" hint="按本站分析的分类（近 120 天）">
          {categories.length ? <Rows data={categories.slice(0, 8).map((c) => ({ label: categoryName(c.key), value: c.count }))} /> : <p className="text-[13px] text-ink-3">还没有分类分析。</p>}
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t.key} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{t.key} · {t.count}</span>
              ))}
            </div>
          )}
        </Section>
        <Section title="形式与语言" hint="帖子占比">
          <Rows data={media.map((m) => ({ label: mediaName(m.key), value: m.count }))} />
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

      <Section className="mt-3" title="互动最高的帖子" hint="按浏览排序">
        <PostList posts={topPosts} />
      </Section>

      <p className="mt-5 text-[11.5px] leading-relaxed text-ink-4">
        点赞、转发、浏览是采集那一刻的快照，不是帖子最终数据；时间为北京时间。KPI 卡片里的同比只在账号有 8 周以上数据时显示，
        否则只看近 4 周。“打法建议”只说明数据里的相关性，不代表因果。
      </p>
    </div>
  );
}

/** 热力图里最佳小时的中位浏览（best.hour 已保证样本足够）。 */
function bestHourViews(hour: number, cells: Array<{ weekday: number; hour: number; posts: number; medViews: number }>): number {
  const views = cells.filter((c) => c.hour === hour && c.posts > 0).map((c) => c.medViews);
  if (!views.length) return 0;
  const sorted = [...views].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
