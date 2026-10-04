// Codex 重置监控接进后端的插口（packages/backend/src/modules.ts 的 ServerModule）。
//
// 旧版这些路由、定时任务、告警与模型步骤长在框架里（apps/api 的 v1/agent/site/admin 路由、
// apps/worker/src/schedules.ts 的 FEATURES.codexResetMonitor 分支、operations/alerts.ts 的两段、
// editorial/models.ts 的 monitor 步骤），4.0.0 把功能移出框架时一并删掉。这里按 4.0.0 的插口接回：
//   http      -> apps/api/src/app.ts 注册完框架路由后遍历 serverModules()
//   schedules -> apps/worker/src/schedules.ts 与框架的定时任务一起排
//   models    -> editorial/models.ts 的 capabilities()，默认模型从 site/models.ts 取
//   admin     -> 后台导航徽章
//   alerts    -> 健康告警（卡住与需复核）
//   agent     -> Agent 指南的一条地址与 MCP 的一个工具
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ServerModule } from "@aihot/backend/modules";
import { adminHandler, actorOf } from "@aihot/backend/admin/auth";
import { sendJsonWithEtag, sendProblem, looseQuery } from "@aihot/backend/lib/http";
import { cached } from "@aihot/backend/lib/cache";
import { sql } from "@aihot/backend/db";
import { siteUrl } from "@aihot/backend/publication/links";
import { beijingStamp, duration, type Finding } from "@aihot/backend/notify/feishu";
import { CODEX_RESET_SCAN_MINUTES } from "@aihot/contracts/monitor";
import { codexAnswer, codexPageAnswer } from "./backend/answer.ts";
import { awaitingReviewCondition, codexResetPage, codexResetVersion, codexResetsRecent, codexResetsSnapshot } from "./backend/read.ts";
import { loadSiteCodexResetDay, loadSiteCodexResetPage } from "./backend/site-page.ts";
import { monitorTick } from "./backend/scan.ts";
import {
  listMonitorEvents,
  listMonitorPosts,
  relinkPost,
  resolveMonitorPost,
  reviewReceipt,
  setWithdrawn,
  updateMonitorEvent,
} from "./backend/admin.ts";

/** 与旧版一致：页面数据 30 秒，当日明细不缓存。 */
const PAGE_TTL = "public, max-age=30, s-maxage=30";

/**
 * 站点接口的错误处理。旧版每个路由都过 apps/api/src/routes/site.ts 的 siteHandler；模块不能 import
 * apps/，所以这里只写站点接口用得上的那几种（后台路由另有 adminHandler）。
 */
function siteHandler(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (error) {
      req.log.error({ err: error, path: req.url.split("?")[0] }, "codex reset api error");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "temporarily unavailable", retryAfter: 10 });
    }
  };
}

const q = (req: FastifyRequest) => looseQuery(req);

/** 公开 API v1 的只读 JSON：CORS 与用法策略头由框架的 publicHandler 加，这里只负责缓存与 ETag。 */
const V1_CACHE = "public, max-age=300, s-maxage=300, must-revalidate";

/** 未处理的帖子数加上需复核的帖子数，给后台导航「Codex 重置」的徽章用（旧版 admin/navigation.ts）。 */
async function pendingCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT (SELECT count(*)::int FROM monitor_posts WHERE ${awaitingReviewCondition()})
         + (SELECT count(*)::int FROM monitor_posts WHERE processed_at IS NULL AND collected_at < now() - interval '20 minutes') AS n`;
  return row?.n ?? 0;
}

/** 卡住与需复核（旧版 operations/alerts.ts 末尾两段）。 */
async function monitorFindings(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  // 帖子按时间顺序识别，一直失败的一条会挡住它之后的所有帖子。
  const [stuck] = await sql<{ url: string; collected_at: Date; failures: { count: number; error?: string } | null }[]>`
    SELECT p.url, p.collected_at, s.value AS failures FROM monitor_posts p LEFT JOIN monitor_state s ON s.key = 'failures:' || p.id
    WHERE p.processed_at IS NULL ORDER BY p.published_at, p.id LIMIT 1`;
  if (stuck && now - stuck.collected_at.getTime() > 60 * 60_000) {
    out.push({
      key: "monitor.stuck",
      level: "today",
      title: "Codex 重置监控卡住了",
      impact: "新的重置消息确认不了，内容群收不到重置通知",
      heals: "暂时没有",
      action: "转给 AI 处理",
      detail: `${stuck.url} 等待 ${duration(now - stuck.collected_at.getTime())}${stuck.failures ? `，识别失败 ${stuck.failures.count} 次：${stuck.failures.error ?? ""}` : ""}；后台“Codex 重置 → 帖子与识别 → 待识别”可跳过`,
      since: stuck.collected_at,
    });
  }
  // 判断没把握、或者引用的帖子找不到的，等人确认。
  const review = await sql<{ url: string }[]>`SELECT url FROM monitor_posts WHERE ${awaitingReviewCondition()} ORDER BY published_at DESC LIMIT 5`;
  if (review.length) {
    out.push({
      key: "monitor.review",
      level: "today",
      title: "有 Codex 重置消息需要你确认",
      impact: "系统对这几条帖子的判断没把握，结论暂时没有生效，也没有推送",
      heals: "不会",
      action: "到后台“Codex 重置 → 帖子与识别 → 需复核”看一下；确认后需要的话在群里说明",
      detail: review.map((h) => h.url).join(" "),
    });
  }
  return out;
}

export const monitorServerModule: ServerModule = {
  name: "monitor",

  http(app) {
    // 公开 API v1：整份快照，以及只看最近一周、还等着落地的那些事件。
    // 完整存档把反复来读的客户端指向更轻的那份。
    app.get("/api/v1/codex-resets", async (req, reply) => {
      reply.header("Link", `<${siteUrl("/api/v1/codex-resets/recent")}>; rel="alternate"; type="application/json"`);
      const body = await codexResetsSnapshot();
      return sendJsonWithEtag(req, reply, body, { etagPrefix: "v1-codex-resets", cacheControl: V1_CACHE });
    });
    app.get("/api/v1/codex-resets/recent", async (req, reply) => {
      const body = await codexResetsRecent();
      return sendJsonWithEtag(req, reply, body, { etagPrefix: "v1-codex-resets-recent", cacheControl: V1_CACHE });
    });

    // 页面数据。前台每个打开的标签页每分钟轮询一次 version：共享缓存替同一 15 秒的请求作答，
    // 进程最多每 5 秒读一次数据库。
    const version = cached(() => codexResetVersion(), { freshMs: 5_000, maxStaleMs: 5_000 });
    app.get("/api/site/codex-reset", siteHandler(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await loadSiteCodexResetPage(), { etagPrefix: "codex-page", cacheControl: PAGE_TTL });
    }));
    app.get("/api/site/codex-reset/days/:date", siteHandler(async (req, reply) => {
      const { date } = req.params as { date: string };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        return sendProblem(req, reply, { status: 404, code: "not_found", detail: "date not found" });
      }
      return sendJsonWithEtag(req, reply, await loadSiteCodexResetDay(date), { etagPrefix: "codex-day", cacheControl: "no-store" });
    }));
    app.get("/api/site/codex-reset/version", siteHandler(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await version.get(), { etagPrefix: "codex-version", cacheControl: "public, max-age=0, s-maxage=15" });
    }));

    // 后台的人工修正：复核、改期、撤回、改挂、跳过与重挂。
    app.get("/api/admin/monitor/events", adminHandler(async (req) => listMonitorEvents({ withdrawn: q(req).withdrawn === "1" })));
    app.get("/api/admin/monitor/posts", adminHandler(async (req) => listMonitorPosts({ filter: q(req).filter as never, page: Math.max(1, Number(q(req).page) || 1) })));
    app.patch("/api/admin/monitor/events/:id", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await updateMonitorEvent(param(req, "id"), (req.body ?? {}) as never, actorOf(admin)))));
    app.post("/api/admin/monitor/events/:id/receipt-review", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await reviewReceipt(param(req, "id"), (req.body ?? {}) as never, actorOf(admin)))));
    app.post("/api/admin/monitor/events/:id/withdrawn", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await setWithdrawn(param(req, "id"), (req.body ?? {}) as never, actorOf(admin)))));
    app.post("/api/admin/monitor/relink", adminHandler(async (req, _reply, admin) => relinkPost((req.body ?? {}) as never, actorOf(admin))));
    app.post("/api/admin/monitor/posts/:id/resolve", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await resolveMonitorPost(param(req, "id"), (req.body ?? {}) as never, actorOf(admin)))));
  },

  // 每十分钟扫一次（页面就是这么写的），每天把最近 48 小时再读一遍；04:40 的两次由 monitorTick 轮流。
  // 它通过 SocialData 读 X，所以没有那个密钥就没什么可跑的。
  schedules: [
    { name: "monitor.tick", cron: `*/${CODEX_RESET_SCAN_MINUTES} * * * *`, run: () => monitorTick() },
    { name: "monitor.lookback", cron: "40 4 * * *", run: () => monitorTick({ lookbackHours: 48 }) },
  ],

  // 识别帖子的那一步调模型，模型选择归本站（site/models.ts 的 DEFAULTS.monitor）。
  models: {
    monitor: { label: "Codex 重置公告识别", env: "MONITOR_MODEL", purposes: ["monitor.recognize", "monitor.context"] },
  },

  admin: { counts: { monitor: pendingCount } },

  alerts: monitorFindings,

  agent: {
    abilities: [{
      path: "/codex-resets",
      title: "Codex 重置",
      ask: "Codex 的额度重置和发卡公告",
      answer: () => codexAnswer(),
      etagPrefix: "agent-codex",
      cacheControl: V1_CACHE,
      mcp: {
        tool: "get_codex_resets",
        use: "for Codex credit resets",
        description: "Codex 的额度重置与发卡公告：确认与公告中的事件、近 90 天次数、监控状态。",
        input: z.object({}),
        run: async () => {
          const page = await codexResetPage();
          return { text: codexPageAnswer(page), structured: page as unknown as Record<string, unknown> };
        },
      },
    }],
  },
};

/** 路径参数，缺了就是空串（旧版 apps/api/src/routes/admin.ts 的 param）。 */
function param(req: FastifyRequest, name: string): string {
  return (req.params as Record<string, string>)[name]!;
}

/** 后台接口的 404（旧版 admin.ts 的 orNotFound）。 */
function orNotFound<T>(req: FastifyRequest, reply: FastifyReply, value: T | null) {
  return value === null || value === undefined
    ? sendProblem(req, reply, { status: 404, code: "not_found", detail: "Not found." })
    : value;
}
