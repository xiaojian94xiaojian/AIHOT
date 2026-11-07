// 博主画像：把本站采集到的 X 账号数据（每篇的互动、时间、媒体、分类）按账号聚合，
// 供网页查询。页面与 api 是分开的两个进程，这里只放两边共用的形状。

/** 语言区：按帖子语言占比判定。 */
export type Region = "zh" | "en" | "other";
/** 账号类型：按 handle 维护的映射，未收录的落 other。 */
export type PersonKind = "official" | "founder" | "researcher" | "media" | "builder" | "other";
/** 主类目：和内容方法论页的分类口径对齐。 */
export type PersonCategory = "opinion" | "product" | "model" | "industry" | "paper" | "tip" | "other";

export const REGION_LABEL: Record<Region, string> = { zh: "中文区", en: "英文区", other: "其他" };
export const KIND_LABEL: Record<PersonKind, string> = {
  official: "官方团队", founder: "创始人/高管", researcher: "研究者",
  media: "媒体/分析", builder: "开发者/创作者", other: "其他",
};
export const CATEGORY_LABEL: Record<PersonCategory, string> = {
  opinion: "观点", product: "产品", model: "模型", industry: "产业", paper: "论文", tip: "教程", other: "其他",
};

/** 一个 X 账号的多维汇总。互动数是抓取当时的快照，不是最终值。 */
export interface XPersonSummary {
  sourceId: string;
  handle: string;
  author: string;
  avatar: string | null;
  region: Region;
  /** 类型：代码里的类型表，或模型初标（x_account_meta）覆盖后的结果。 */
  kind: PersonKind;
  /** 主类目：模型初标的结果；没有标注时为 null。 */
  category: PersonCategory | null;
  posts: number;
  /** 有发帖的天数。 */
  activeDays: number;
  /** 首帖到末帖的跨度（天，至少 1）。 */
  days: number;
  postsPerDay: number;
  avgLikes: number;
  medLikes: number;
  topLikes: number;
  avgViews: number;
  medViews: number;
  p90Views: number;
  /** 最近一次粉丝快照；没有快照时为 null。 */
  followers: number | null;
  /** 点赞总数 / 浏览总数，百分比。 */
  engagementRate: number;
  /**
   * 每千次曝光的互动结构：赞、转、评、引。按 X 官方公开的 For You 打分动作拆分——
   * 回复与引用的权重（5.0）远高于点赞（0.708）、转发（1.0）。
   */
  perK: { likes: number; reposts: number; replies: number; quotes: number };
  /** 带图或视频的帖子占比。 */
  mediaPct: number;
  /** 回复他人的帖子占比（这类帖子的互动通常远高于原创）。 */
  replyPct: number;
  quotePct: number;
  topCategory: string | null;
  language: string | null;
  firstAt: string;
  lastAt: string;
}

export interface XPeopleResponse {
  people: XPersonSummary[];
  generatedAt: string;
  totals: { people: number; posts: number };
}

export interface XSeriesPoint {
  label: string;
  posts: number;
  medViews: number;
  likes: number;
  views: number;
}

/** 近 4 周与前 4 周（harken 那种“跟自己基线比”的口径）。 */
export interface XTrend {
  recent: { posts: number; medViews: number; likes: number; views: number; engagementRate: number };
  previous: { posts: number; medViews: number; likes: number; views: number; engagementRate: number };
}

/** 爆款与日常的对照：爆款按该账号浏览量的 P90 切。 */
export interface XHitStats {
  posts: number;
  mediaPct: number;
  replyPct: number;
  avgLength: number;
  medViews: number;
  avgLikes: number;
}

export interface XFormat {
  key: "media" | "text";
  posts: number;
  medViews: number;
}

export interface XCount {
  key: string;
  count: number;
}

export interface XPost {
  id: string;
  text: string;
  url: string;
  at: string;
  /** 采集时间（帖子落库那一刻）；老数据可能没有。 */
  capturedAt?: string | null;
  /** 按 X 热门池的 8 小时半衰模型反推的 24 小时浏览。 */
  projected24h?: number | null;
  /** 浏览 ÷ max(粉丝, 500)：大于 1 说明推荐系统在往外推。 */
  breakout?: number | null;
  views: number;
  likes: number;
  retweets: number;
  /** 回帖数（发布时的快照）。 */
  replies: number;
  /** 引用数（发布时的快照）。 */
  quotes: number;
  mediaKind: string;
  language: string | null;
  isReply: boolean;
}

export interface XPersonResponse {
  person: XPersonSummary;
  /** 互动结构：全站中位（每千曝光）和一句诊断，和 person.perK 对照着看。 */
  structure: { median: { likes: number; reposts: number; replies: number; quotes: number }; verdict: string };
  /** 最近 12 周：发帖量、中位浏览、点赞合计。 */
  weekly: XSeriesPoint[];
  trend: XTrend;
  /** 北京时间 0–23 点的发帖量与中位浏览。 */
  hours: Array<{ hour: number; posts: number; medViews: number }>;
  /** 周一 = 1。 */
  weekdays: Array<{ weekday: number; posts: number; medViews: number }>;
  /** 7×24 的热力图单元（周几 × 北京时间小时）。 */
  heatmap: Array<{ weekday: number; hour: number; posts: number; medViews: number }>;
  /** 带媒体与纯文字两种形式的效果对照。 */
  formats: XFormat[];
  hits: { top: XHitStats; rest: XHitStats };
  /** 样本足够的时段/周几里，中位浏览最高的一个；没有则 null。 */
  best: { hour: number | null; weekday: number | null };
  categories: XCount[];
  tags: XCount[];
  languages: XCount[];
  media: XCount[];
  topPosts: XPost[];
  /** 粉丝快照与涨粉；这个账号还没有快照时为 null。 */
  growth: XPersonGrowth | null;
}

/** 涨粉榜的一行：一个账号在窗口内的粉丝变化。 */
export interface XGrowthRow {
  handle: string;
  /** 抓到时的大小写写法，显示用。 */
  screenName: string;
  name: string | null;
  avatarUrl: string | null;
  region: Region;
  /** 最近一次快照的粉丝数。 */
  followers: number;
  /** 窗口外最近一次快照的粉丝数（基线的粉丝数）。 */
  baseline: number;
  /** 涨粉数，已按窗口长度折算（基线早于窗口时按比例缩到窗口上）。 */
  growth: number;
  /** 涨粉率，百分比，同样按窗口折算。 */
  growthPct: number;
  /** 两次快照相隔的天数：等于窗口时没有折算。 */
  spanDays: number;
  /** 最近一次快照是北京时间的哪一天。 */
  updatedOn: string;
  /** 全站名次（按涨粉数；筛选不改变名次）。 */
  rank: number;
  /** 全站名次（按涨粉率）。 */
  rankPct: number;
  /** 昨天同一窗口下的名次；昨天不在榜上（新入榜或没有基线）为 null。 */
  rankPrev: number | null;
  rankPctPrev: number | null;
  /** 涨粉区间内发的帖子数与浏览合计（用来算效率）。 */
  posts: number;
  views: number;
  /** 每帖涨粉；没有发帖为 null。 */
  perPost: number | null;
  /** 每千次曝光涨粉；没有曝光为 null。 */
  perK: number | null;
  /**
   * 归因提示：quiet 本期没发帖（涨粉来自外部），thin 发帖太少不足以归因，
   * caution 涨粉远高于曝光或涨粉率异常（清单页显示，可能买粉、抽奖或外部事件，需核对）。
   */
  signal: "quiet" | "thin" | "caution" | null;
}

/** 上周同一窗口的一行：页面按当前筛选重排时，用它算「上周第几名」。 */
export interface XGrowthPrevRow {
  handle: string;
  region: Region;
  followers: number;
  growth: number;
  growthPct: number;
  posts: number;
  views: number;
}

export interface XFreshnessRecord {
  status: "normal" | "delayed" | "insufficient" | "empty";
  /** 短标签：正常 / 延迟 / 样本不足 / 还没有数据。 */
  label: string;
  latest: string | null;
  since: string | null;
  spanDays: number;
  snapshots: number;
  note: string;
}

export interface XGrowthResponse {
  /** 7 或 30。 */
  window: number;
  rows: XGrowthRow[];
  /** 上周同一窗口的行（页面按当前筛选重排后，用它算每行的名次变化）。 */
  prev: XGrowthPrevRow[];
  generatedAt: string;
  /** 这页数据的新鲜度：哪天的数、覆盖多少天、够不够下结论。 */
  freshness: XFreshnessRecord;
  coverage: {
    /** 有快照的账号数。 */
    accounts: number;
    /** 快照行数。 */
    rows: number;
    /** 最早、最近一次快照的日期（北京时间）。 */
    since: string | null;
    latest: string | null;
    /** 已有多少天的历史；不足一个窗口时，那一档只能积累。 */
    days: number;
    /** 本期能排行的账号数。 */
    eligible: number;
  };
}

/** 画像页上的粉丝与涨粉。 */
export interface XPersonGrowth {
  /** 这个账号粉丝快照的新鲜度。 */
  freshness: XFreshnessRecord;
  /** 最近一次快照的粉丝数。 */
  followers: number;
  /** 最近一次快照的日期。 */
  updatedOn: string;
  /** 近 30 天每天的最后一次粉丝数；delta 是相邻两次快照的差（缺天时为 null）。 */
  daily: Array<{ on: string; followers: number; delta: number | null }>;
  d7: {
    growth: number;
    pct: number;
    rank: number;
    /** 中文区内的名次；不是中文区或没有中文区数据时为 null。 */
    rankZh: number | null;
    eligible: number;
    eligibleZh: number;
    posts: number;
    views: number;
    perK: number | null;
    perPost: number | null;
    /** 同地区、同粉丝档里够得上效率样本的账号的每千曝光中位数。 */
    perKMedian: number | null;
    /** 粉丝档的显示名，如「1–5 万」。 */
    tier: string;
    /** 归因提示，与榜单同一口径。 */
    signal: "quiet" | "thin" | "caution" | null;
  } | null;
  d30: {
    growth: number;
    pct: number;
    eligible: number;
    /** 历史还不足 31 天：只有涨粉，不排名。 */
    enough: boolean;
  } | null;
  /** 涨粉区间内浏览最高的几条帖子。 */
  topPosts: XPost[];
  /** 站内近 7 天的报道里提到这个账号（按名字匹配）的前几条。 */
  related: Array<{ id: string; title: string; url: string; at: string }>;
  /** 最近一期的模型观察（每周一次）；没有生成过时为 null。 */
  report: {
    conclusion: string;
    drivers: Array<{ why: string; evidence: string }>;
    moves: string[];
    confidence: "high" | "medium" | "low";
    periodEnd: string;
    generatedAt: string;
    model: string | null;
  } | null;
}

/** 每周涨粉报告：模型根据发帖与报道写的观察。 */
export interface XGrowthReport {
  handle: string;
  screenName: string;
  name: string | null;
  avatarUrl: string | null;
  growth: number;
  followers: number;
  posts: number;
  views: number;
  perK: number | null;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  model: string | null;
  report: {
    conclusion: string;
    drivers: Array<{ why: string; evidence: string }>;
    moves: string[];
    confidence: "high" | "medium" | "low";
  };
}

export interface XGrowthReportResponse {
  window: number;
  generatedAt: string | null;
  reports: XGrowthReport[];
  /** 顶部的冠军 / 黑马 / 存疑 / 可复用动作；没有报告时为 null。 */
  summary: {
    champion: { handle: string; name: string; growth: number; perK: number | null };
    darkHorse: { handle: string; name: string; growth: number; perK: number | null } | null;
    cautions: Array<{ handle: string; name: string; growth: number; perK: number | null }>;
    moves: string[];
  } | null;
}

/** 对比页：多个账号的汇总 + 各自近 12 周发帖量的迷你趋势。 */
export interface XCompareEntry extends XPersonSummary {
  spark: number[];
}

export interface XCompareResponse {
  people: XCompareEntry[];
}

/** 方法论页：把各账号按自己的 P90 切成爆款，再跨账号聚合。 */
export interface XHitSummary {
  posts: number;
  mediaPct: number;
  replyPct: number;
  avgLength: number;
  medViews: number;
}

export interface XMethodologyResponse {
  totals: { accounts: number; posts: number; hits: number; hitRate: number; matureDays: number };
  overall: { top: XHitSummary; rest: XHitSummary };
  formats: Array<{ key: string; posts: number; hits: number; hitRate: number; medViews: number }>;
  lengths: Array<{ key: string; posts: number; hitRate: number; medViews: number }>;
  hours: Array<{ hour: number; posts: number; hitRate: number; medViews: number }>;
  weekdays: Array<{ weekday: number; posts: number; hitRate: number }>;
  languages: Array<{ key: string; posts: number; hitRate: number }>;
  categories: Array<{ key: string; posts: number; hitRate: number }>;
  regions: Array<{ key: string; posts: number; hitRate: number; mediaPct: number }>;
  exemplars: Array<{ handle: string; author: string; text: string; url: string; views: number; likes: number; ratio: number; at: string }>;
}

/** 公开的账号收录：查一个 handle 的结果（未收录时 path 为 null，request 是已有申请的状态）。 */
export interface XAccountLookup {
  handle: string;
  tracked: boolean;
  path: string | null;
  request: XAccountRequestStatus | null;
}

export type XAccountRequestStatus = "pending" | "approved" | "rejected";

/** 一条收录申请（后台列表用）。 */
export interface XAccountRequest {
  handle: string;
  note: string | null;
  contact: string | null;
  status: XAccountRequestStatus;
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface XAccountRequestList {
  items: XAccountRequest[];
}
/** 可评帖：选题下一条「现在接一句」的候选，口径见 backend/today.ts。 */
export interface XCommentable {
  id: string;
  handle: string;
  author: string;
  text: string;
  url: string;
  at: string;
  views: number;
  replies: number;
  likes: number;
  /** 距现在多少分钟。 */
  minutesAgo: number;
  /** 一句「接一句」的理由。 */
  reason: string;
  /** 剩余机会分：窗口内预计剩余浏览 ÷（已有回复 + 平滑），越大越值得现在回。 */
  opportunity?: number | null;
}

/** 今天发什么：一条可以现在写的选题（站内热度 + 48 小时里的 X 讨论量）。 */
export interface XTodayTopic {
  storyId: number;
  publicId: string;
  title: string;
  url: string;
  rank: number;
  heat: number;
  posts: number;
  reports: number;
  sources: number;
  latestAt: string;
  repliesPerK: number;
  quotesPerK: number;
  angle: string;
  why: string;
  refs: XPost[];
  /** 2–3 条现在就能接一句的中文帖；没有就空数组。 */
  commentables: XCommentable[];
}

export interface XTodayResponse {
  windowHours: number;
  generatedAt: string;
  topics: XTodayTopic[];
}
/** 算法视角：拿官方权重回测几个常见说法，每个结论都带本站的数字。 */
export interface XAlgorithmCheck {
  key: "decay" | "link" | "discuss";
  claim: string;
  verdict: "成立" | "不成立" | "看不清";
  summary: string;
  rows: Array<{ label: string; value: string; hint?: string }>;
}

export interface XAlgorithmResponse {
  checks: XAlgorithmCheck[];
  generatedAt: string;
}
/** 采集成本看板：一天一行（北京时间）。 */
export interface XCollectStat {
  day: string;
  calls: number;
  emptyCalls: number;
  objects: number;
  usd: number;
  sources: number;
  enabledSources: number;
  /** 今天这行是实时算的，还没落库。 */
  live?: boolean;
}
/** 每日一张卡：今天写什么。 */
export interface XDailyCard {
  generatedAt: string;
  topic: XTodayTopic;
  angle: string;
  numbers: Array<{ label: string; value: string }>;
  commentable: (XCommentable & { hoursLeft: number | null; remainingViews: number | null }) | null;
  me: { handle: string; followers: number | null; verdict: string } | null;
  links: { post: string; reply: string | null; story: string };
}