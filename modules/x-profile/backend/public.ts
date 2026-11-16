// 版本化公开接口（/api/v1/x-people/*）的数据整形与 Agent Markdown。
// 页面接口（/api/site/x-people/*）为网页服务，字段多、随时会加；这一层只暴露承诺稳定的字段。
import { growthBoard, loadPersonGrowth } from "./followers.ts";
import { methodologyPage } from "./methodology.ts";
import { personPage } from "./data.ts";
import { beijingToday } from "./collect-stats.ts";
import type {
  XGrowthV1,
  XMethodologyV1,
  XPersonV1,
  XMethodologyResponse,
} from "../types.ts";

const int = new Intl.NumberFormat("zh-CN");
const fmt = (value: number | null | undefined): string => (value === null || value === undefined ? "—" : int.format(Math.round(value)));
const signed = (value: number, digits = 0): string => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

/** 涨粉榜：只保留榜单需要的列，去掉头像、名次等页面字段。 */
export async function growthV1(window: 7 | 30): Promise<XGrowthV1> {
  const board = await growthBoard(window);
  return {
    window,
    asOf: board.freshness.latest,
    generatedAt: board.generatedAt,
    freshness: board.freshness,
    accounts: board.rows.map((row) => ({
      handle: row.handle,
      name: row.name,
      region: row.region,
      followers: row.followers,
      growth: row.growth,
      growthPct: row.growthPct,
      spanDays: row.spanDays,
      fromOn: row.fromOn,
      toOn: row.toOn,
      posts: row.posts,
      views: row.views,
      perPost: row.perPost,
      perK: row.perK,
    })),
  };
}

/** 方法论：聚合统计 + 示例链接；示例正文（外部内容）不进契约，避免被当成事实转述。 */
export async function methodologyV1(): Promise<XMethodologyV1> {
  const page: XMethodologyResponse = await methodologyPage.get(undefined);
  return {
    asOf: beijingToday(),
    windowDays: 120,
    totals: page.totals,
    overall: page.overall,
    formats: page.formats,
    lengths: page.lengths,
    hours: page.hours,
    weekdays: page.weekdays,
    languages: page.languages,
    categories: page.categories,
    regions: page.regions,
    examples: page.exemplars.slice(0, 6).map((item) => ({
      handle: item.handle,
      author: item.author,
      url: item.url,
      views: item.views,
      likes: item.likes,
      ratio: item.ratio,
      at: item.at,
    })),
  };
}

/** 单个账号：画像摘要 + 粉丝涨粉；没有这个账号时返回 null。 */
export async function personV1(handle: string): Promise<XPersonV1 | null> {
  const [page, growth] = await Promise.all([personPage(handle), loadPersonGrowth(handle)]);
  if (!page) return null;
  const person = page.person;
  return {
    handle: person.handle,
    author: person.author,
    region: person.region,
    followers: growth?.followers ?? person.followers,
    updatedOn: growth?.updatedOn ?? null,
    growth: growth ? { freshness: growth.freshness, d7: growth.d7, d30: growth.d30 } : null,
    coverage: {
      posts: person.posts,
      activeDays: person.activeDays,
      days: person.days,
      postsPerDay: person.postsPerDay,
    },
    engagement: {
      avgLikes: person.avgLikes,
      medLikes: person.medLikes,
      topLikes: person.topLikes,
      avgViews: person.avgViews,
      medViews: person.medViews,
      p90Views: person.p90Views,
      engagementRate: person.engagementRate,
      perK: person.perK,
      mediaPct: person.mediaPct,
      replyPct: person.replyPct,
      quotePct: person.quotePct,
    },
    structure: page.structure,
    best: page.best,
    formerHandles: page.formerHandles,
    topPosts: page.topPosts.slice(0, 5).map((post) => ({
      id: post.id,
      url: post.url,
      at: post.at,
      views: post.views,
      likes: post.likes,
      retweets: post.retweets,
      replies: post.replies,
      quotes: post.quotes,
      text: post.text.slice(0, 500),
    })),
  };
}

/** 给 Agent 看的涨粉榜：前 N 个账号，带口径与「不要下结论」的提示。 */
export function growthMarkdown(board: XGrowthV1, limit = 20): string {
  const rows = [...board.accounts].sort((a, b) => b.growth - a.growth).slice(0, Math.max(1, limit));
  const lines = [
    `# X 涨粉榜（${board.window} 天）`,
    "",
    `截至 ${board.asOf ?? "未知"}；快照覆盖 ${board.freshness.spanDays} 天（${board.freshness.since ?? "?"} 起）。`,
    "",
    "| # | 账号 | 粉丝 | 涨粉 | 涨幅 | 帖子 | 浏览 |",
    "|---|------|------|------|------|------|------|",
    ...rows.map((row, index) => `| ${index + 1} | @${row.handle}（${row.name ?? row.handle}） | ${fmt(row.followers)} | ${signed(row.growth)} | ${signed(row.growthPct, 1)}% | ${fmt(row.posts)} | ${fmt(row.views)} |`),
    "",
    "## 口径",
    `- 涨粉是本站粉丝快照的差值，按窗口折算；不是 X 官方数据。快照新鲜度：${board.freshness.label}——${board.freshness.note}`,
    "- 账号名和 handle 来自 X 公开资料，可能有误；涨粉也可能来自外部事件或买粉，不要把它当成人气或内容质量的结论。",
    "",
    "## 回答提示",
    "- 按用户问的窗口和数量回答；没有要求时按涨粉排序给前 10。",
    "- 要链接时用 https://x.com/<handle>；不要展示本站接口地址或参数。",
    "- 先说明数据截至哪一天；快照跨度不足 7 天时，提醒「样本不足，只能看方向」。",
  ];
  return `${lines.join("\n").trim()}\n`;
}

/** 给 Agent 看的方法论：聚合结论 + 示例链接 + 相关性声明。 */
export function methodologyMarkdown(page: XMethodologyV1): string {
  const formats = [...page.formats].sort((a, b) => b.hitRate - a.hitRate);
  const lengths = [...page.lengths].sort((a, b) => b.hitRate - a.hitRate);
  const hours = [...page.hours].filter((row) => row.posts >= 100).sort((a, b) => b.hitRate - a.hitRate).slice(0, 3);
  const categories = [...page.categories].sort((a, b) => b.hitRate - a.hitRate).slice(0, 3);
  const lines = [
    `# X 内容方法论（近 ${page.windowDays} 天）`,
    "",
    `截至 ${page.asOf}：${fmt(page.totals.accounts)} 个账号、${fmt(page.totals.posts)} 篇原创帖；爆款（账号自己浏览前 10%）共 ${fmt(page.totals.hits)} 篇，爆款率 ${page.totals.hitRate}%。`,
    "",
    "## 形式与长度",
    ...formats.map((row) => `- ${row.key === "media" ? "带媒体" : "纯文字"}：${fmt(row.posts)} 篇，爆款率 ${row.hitRate}%，中位浏览 ${fmt(row.medViews)}。`),
    ...lengths.map((row) => `- 字数 ${row.key}：${fmt(row.posts)} 篇，爆款率 ${row.hitRate}%，中位浏览 ${fmt(row.medViews)}。`),
    "",
    "## 发布时间（北京时间）",
    ...(hours.length
      ? hours.map((row) => `- ${String(row.hour).padStart(2, "0")}:00：${fmt(row.posts)} 篇，爆款率 ${row.hitRate}%，中位浏览 ${fmt(row.medViews)}。`)
      : ["- 样本不足，暂不列时段。"]),
    "",
    "## 题材",
    ...categories.map((row) => `- ${row.key}：${fmt(row.posts)} 篇，爆款率 ${row.hitRate}%。`),
    "",
    "## 示例（只给链接，正文请点开原文核对）",
    ...page.examples.slice(0, 3).map((item) => `- @${item.handle}：浏览 ${fmt(item.views)}、赞 ${fmt(item.likes)}，${item.url}`),
    "",
    "## 口径与测不了",
    "- 爆款 = 账号自己浏览的前 10%；互动是采集瞬间的快照，不是最终值。",
    "- 这里只描述相关性（哪些特征更常一起出现），不能证明「这样做就会火」；发帖时间、题材和账号本身的影响力混在一起。",
    "- 我们没有每条帖子的曝光曲线和负向信号（举报、静音），看不到限流。",
    "- 回答时不要说「保证有效」；样本少或差异小就直说看不准。",
  ];
  return `${lines.join("\n").trim()}\n`;
}
