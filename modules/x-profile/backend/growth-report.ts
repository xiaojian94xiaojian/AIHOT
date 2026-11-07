// 每周涨粉报告：挑「涨粉靠前、这一周又发了足够多帖子」的账号，把数字、代表帖和同期站内报道交给模型，
// 让它写一份能被核对的观察（哪条原因对应哪条帖），而不是一段无法验证的结论。
// 模型只在 worker 的定时任务里调用，页面只读结果；调用照旧走回执与预算。
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { searchItems } from "@aihot/backend/publication/agent";
import { chatJson, MODELS } from "@aihot/backend/providers/llm";
import { beijingDate, monthDay } from "@aihot/contracts/time";
import { growthBoard, sourceIdsOfHandle } from "./followers.ts";
import type { XGrowthReport, XGrowthReportResponse, XGrowthRow } from "../types.ts";

/** 报告只看 7 天窗口，取中文区、7 日涨粉超过 1000 的账号。 */
const WINDOW = 7;
const MIN_GROWTH = 1000;
const PROMPT_VERSION = "x-growth-report-v2";
/** 给模型的推文条数与每条正文上限：够说明内容形式，又不至于灌满上下文。 */
const POSTS_GIVEN = 6;
const POST_CHARS = 360;

const ReportSchema = z.object({
  conclusion: z.string().min(1).max(600),
  drivers: z.array(z.object({ why: z.string().min(1).max(300), evidence: z.string().max(300) })).min(1).max(3),
  moves: z.array(z.string().min(1).max(200)).max(3),
  confidence: z.enum(["high", "medium", "low"]),
});

type Report = z.infer<typeof ReportSchema>;

const SYSTEM = [
  "你在为一家 AI 行业热点站写「本周涨粉观察」。读者关心的是：这个账号这周为什么涨粉、哪些做法可能可以复用。",
  "只根据给你的数字和推文写，不要补充训练记忆里的新闻，不要编造没给出的事实。",
  "证据不足（比如这周几乎没发帖）就直接写「数据不足以归因」，confidence 给 low。",
  "不要写因果结论，用「可能」「看起来」；每条原因都要指出依据：哪条推文、哪个数字。",
  "不要评价账号的好坏，也不要猜测粉丝真假；涨粉远高于曝光时只提醒读者核对。",
  "moves 是给同行的可复用动作，最多三条，每条一句话。",
  "只输出一个 JSON 对象，不要代码块、不要额外文字，键必须正好是下面这些：",
  '{"conclusion": "一段话结论（不超过 200 字）", "drivers": [{"why": "可能的原因", "evidence": "依据（哪条帖、什么数字）"}], "moves": ["可复用动作"], "confidence": "high 或 medium 或 low"}',
  "drivers 1 到 3 条，moves 0 到 3 条；confidence 只能是 high、medium、low 三个词之一。",
].join("\n");

/** 一个账号的证据：数字 + 代表帖 + 同期站内报道里提到它的标题。 */
async function evidenceOf(row: XGrowthRow): Promise<string> {
  const ids = await sourceIdsOfHandle(row.handle);
  const posts = ids.length
    ? await sql<{ text: string | null; views: string; likes: string; at: Date }[]>`
        SELECT a.x_post->>'text' AS text,
               coalesce((a.raw->>'views')::bigint, 0)::text AS views,
               coalesce((a.raw->>'favorite')::bigint, 0)::text AS likes,
               a.published_at AS at
        FROM articles a
        WHERE a.source_id = ANY(${ids}::text[])
          AND a.published_at > now() - interval '7 days'
        ORDER BY coalesce((a.raw->>'views')::bigint, 0) DESC
        LIMIT ${POSTS_GIVEN}`
    : [];
  const related = await searchItems(row.name ?? row.screenName, "7d", null, 5)
    .then(({ res }) => res.items.slice(0, 5).map((item) => `- ${monthDay(beijingDate(item.publishedAt ?? item.discoveredAt))} ${item.title}`))
    .catch(() => [] as string[]);
  const lines = [
    `账号：${row.name ?? row.screenName}（@${row.screenName}），${row.region === "zh" ? "中文区" : row.region === "en" ? "英文区" : "其他地区"}。`,
    `近 ${WINDOW} 天涨粉：${row.growth}（${row.growthPct}%），现在粉丝 ${row.followers}，${row.spanDays} 天前的基线是 ${row.baseline}。`,
    `同期发帖 ${row.posts} 条，浏览合计 ${row.views}${row.perK === null ? "" : `，每千次曝光约涨 ${row.perK} 粉`}。`,
    ...(posts.length
      ? ["", "这周浏览最高的帖子：", ...posts.map((post, index) => {
          const text = (post.text ?? "").replace(/\s+/g, " ").slice(0, POST_CHARS);
          return `${index + 1}. ${monthDay(beijingDate(post.at))}，浏览 ${post.views}，赞 ${post.likes}：${text}`;
        })]
      : ["", "这一周没有抓到发帖。"]),
    ...(related.length ? ["", "同期站内报道里提到它的标题：", ...related] : []),
  ];
  return lines.join("\n");
}

/** 本周的候选：中文区、7 日涨粉超过 1000，按涨粉数从多到少。 */
async function candidates(): Promise<XGrowthRow[]> {
  const board = await growthBoard(WINDOW);
  return board.rows
    .filter((row) => row.region === "zh" && row.growth > MIN_GROWTH)
    .sort((a, b) => b.growth - a.growth);
}

/** 生成一批报告并按周期落库；同一个账号同一周期重跑会覆盖。返回写入与跳过的数量。 */
export async function generateGrowthReports(now = new Date()): Promise<{ generated: number; skipped: number; period: string }> {
  const period = beijingDate(now);
  const periodStart = beijingDate(new Date(now.getTime() - (WINDOW - 1) * 86_400_000));
  const rows = await candidates();
  let generated = 0;
  let skipped = 0;
  const model = await modelFor("x_growth_report");
  for (const row of rows) {
    try {
      const answer = await chatJson({
        model,
        purpose: "x_growth.report",
        subject: `x-growth:${row.handle}:${period}`,
        promptVersion: PROMPT_VERSION,
        system: SYSTEM,
        user: await evidenceOf(row),
        schema: ReportSchema,
        temperature: 0.3,
        maxTokens: 1400,
      });
      // 存模型的真名（预设的 key 可能是 default）；页面直接显示它。
      const modelName = MODELS[answer.model]?.model ?? answer.model;
      await sql`
        INSERT INTO x_growth_reports (handle, screen_name, name, avatar_url, window_days, period_start, period_end, model, growth, followers, posts, views, report)
        VALUES (${row.handle}, ${row.screenName}, ${row.name}, ${row.avatarUrl}, ${WINDOW}, ${periodStart}, ${period}, ${modelName},
                ${row.growth}, ${row.followers}, ${row.posts}, ${row.views}, ${sql.json(answer.data)})
        ON CONFLICT (handle, window_days, period_end) DO UPDATE SET
          screen_name = EXCLUDED.screen_name, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
          model = EXCLUDED.model, growth = EXCLUDED.growth, followers = EXCLUDED.followers,
          posts = EXCLUDED.posts, views = EXCLUDED.views, report = EXCLUDED.report, generated_at = now()`;
      generated += 1;
    } catch {
      // 一个账号失败（模型不可用、额度、输出不合 schema）不影响其它账号；下一周会再试。
      skipped += 1;
    }
  }
  return { generated, skipped, period };
}

interface StoredRow {
  handle: string;
  screen_name: string;
  name: string | null;
  avatar_url: string | null;
  growth: string;
  followers: string;
  posts: number;
  views: string;
  period_start: string;
  period_end: string;
  generated_at: Date;
  model: string | null;
  report: Report;
}

function toReport(row: StoredRow): XGrowthReport {
  const views = Number(row.views);
  return {
    handle: row.handle,
    screenName: row.screen_name,
    name: row.name,
    avatarUrl: row.avatar_url,
    growth: Number(row.growth),
    followers: Number(row.followers),
    posts: row.posts,
    views,
    perK: views > 0 ? Math.round((Number(row.growth) / views) * 1000 * 10) / 10 : null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: new Date(row.generated_at).toISOString(),
    model: row.model,
    report: row.report,
  };
}

/** 最近一期的报告；没有生成过时返回空列表。 */
export async function loadGrowthReports(): Promise<XGrowthReportResponse> {
  const [latest] = await sql<{ on: string | null }[]>`
    SELECT to_char(max(period_end), 'YYYY-MM-DD') AS on FROM x_growth_reports`;
  if (!latest?.on) return { window: WINDOW, generatedAt: null, reports: [], summary: null };
  const rows = await sql<StoredRow[]>`
    SELECT handle, screen_name, name, avatar_url, growth::text AS growth, followers::text AS followers,
           posts, views::text AS views, to_char(period_start, 'YYYY-MM-DD') AS period_start,
           to_char(period_end, 'YYYY-MM-DD') AS period_end, generated_at, model, report
    FROM x_growth_reports
    WHERE window_days = ${WINDOW} AND period_end = ${latest.on}::date
    ORDER BY x_growth_reports.growth DESC`;
  const reports = rows.map(toReport);
  return {
    window: WINDOW,
    generatedAt: rows.length ? new Date(rows[0]!.generated_at).toISOString() : null,
    reports,
    summary: await summaryOf(reports),
  };
}

/**
 * 顶部总览：冠军按涨粉数，黑马按每千曝光（且粉丝不到 5 万）；报告里挑不出来时，
 * 退到中文区、非需核对、粉丝不到 1 万的同档效率第一（见 fallbackDarkHorse）。
 * 存疑来自榜单，三条建议取各账号观察里出现过的可复用动作（去重、短的在前）。
 */
async function summaryOf(reports: XGrowthReport[]): Promise<XGrowthReportResponse["summary"]> {
  if (reports.length === 0) return null;
  const champion = reports[0]!;
  const board = await growthBoard(WINDOW);
  const fromReports = [...reports]
    .filter((report) => report.handle !== champion.handle && report.followers < 50_000 && report.perK !== null)
    .sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))[0] ?? null;
  // 报告只覆盖少数账号，粉丝都在 5 万以上是常态；这时用榜单现算一个，避免「黑马」常年空着。
  const darkHorse = fromReports
    ? { handle: fromReports.handle, name: fromReports.name ?? fromReports.screenName, growth: fromReports.growth, perK: fromReports.perK }
    : fallbackDarkHorse(board, champion.handle);
  const cautions = board.rows
    .filter((row) => row.signal === "caution")
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 5)
    .map((row) => ({ handle: row.handle, name: row.name ?? row.screenName, growth: row.growth, perK: row.perK }));
  const moves = [...new Set(reports.flatMap((report) => report.report.moves.map((move) => move.trim())).filter(Boolean))]
    .sort((a, b) => a.length - b.length)
    .slice(0, 3);
  return {
    champion: { handle: champion.handle, name: champion.name ?? champion.screenName, growth: champion.growth, perK: champion.perK },
    darkHorse,
    cautions,
    moves,
  };
}

/** 画像页用：这个账号最近一期报告的结论部分；没有就返回 null。 */
export async function latestReportFor(handle: string): Promise<XGrowthReport | null> {
  const [row] = await sql<StoredRow[]>`
    SELECT handle, screen_name, name, avatar_url, growth::text AS growth, followers::text AS followers,
           posts, views::text AS views, to_char(period_start, 'YYYY-MM-DD') AS period_start,
           to_char(period_end, 'YYYY-MM-DD') AS period_end, generated_at, model, report
    FROM x_growth_reports
    WHERE handle = ${handle.toLowerCase()} AND window_days = ${WINDOW}
    ORDER BY period_end DESC LIMIT 1`;
  return row ? toReport(row) : null;
}

/**
 * 报告里挑不出黑马时的兜底：从榜单现算——中文区、非需核对、粉丝不到 1 万、有每千曝光的，取最高。
 * 上限先 1 万，没有再放宽到 5 万；都没有就返回 null（页面照旧显示空态）。
 */
function fallbackDarkHorse(board: Awaited<ReturnType<typeof growthBoard>>, championHandle: string) {
  const pick = (maxFollowers: number) =>
    board.rows
      .filter(
        (row) =>
          row.handle !== championHandle &&
          row.region === "zh" &&
          row.signal !== "caution" &&
          row.followers < maxFollowers &&
          row.perK !== null,
      )
      .sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))[0] ?? null;
  const row = pick(10_000) ?? pick(50_000);
  return row ? { handle: row.handle, name: row.name ?? row.screenName, growth: row.growth, perK: row.perK } : null;
}