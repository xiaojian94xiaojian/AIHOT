// 博主画像接进后端的插口（packages/backend/src/modules.ts 的 ServerModule）。接口只读；
// 定时任务只写本模块自己的表（粉丝快照、每周涨粉报告），不碰引擎的状态。
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { sendJsonWithEtag, sendProblem } from "@aihot/backend/lib/http";
import { actorOf, adminHandler } from "@aihot/backend/admin/auth";
import { peoplePage, personPage } from "./backend/data.ts";
import { loadCompare } from "./backend/compare.ts";
import { loadMethodology } from "./backend/methodology.ts";
import { GROWTH_WINDOWS, growthBoard, loadPersonGrowth, scanFollowerSnapshots } from "./backend/followers.ts";
import { generateGrowthReports, latestReportFor, loadGrowthReports } from "./backend/growth-report.ts";
import { listRequests, lookupAccount, RequestRejected, reviewRequest, submitRequest } from "./backend/requests.ts";
import { growthDigest } from "./backend/digest.ts";
import { todaysTopics } from "./backend/today.ts";
import { algorithmPage } from "./backend/algorithm.ts";
import { loadDailyCard } from "./backend/card.ts";
import { recentCollectStats, snapshotCollectStats } from "./backend/collect-stats.ts";

/** 画像按天变化，站点接口缓存五分钟、共享缓存十分钟。 */
const CACHE = "public, max-age=300, s-maxage=600, stale-while-revalidate=900";
const HANDLE = /^[A-Za-z0-9_]{1,30}$/;

function guarded(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (error) {
      req.log.error({ err: error, path: req.url.split("?")[0] }, "x-profile api error");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "temporarily unavailable", retryAfter: 10 });
    }
  };
}

export const xProfileServerModule: ServerModule = {
  name: "x-profile",
  http(app) {
    // 每个账号的涨粉周报订阅源（RSS）：不登录、不留邮箱，阅读器里直接订阅。
    app.get("/feed/x/:handle.xml", guarded(async (req, reply) => {
      const raw = String((req.params as { handle?: string }).handle ?? "").replace(/\.xml$/, "");
      if (!HANDLE.test(raw)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no such account" });
      const xml = await growthDigest(raw.toLowerCase());
      if (!xml) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no snapshots yet" });
      return reply.header("Cache-Control", "public, max-age=600, s-maxage=1800").type("application/rss+xml; charset=utf-8").send(xml);
    }));
    app.get("/api/site/x-people", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await peoplePage.get(undefined), { etagPrefix: "xp-list", cacheControl: CACHE });
    }));
    // 静态段要在 :handle 之前注册，避免被当成一个 handle。
    app.get("/api/site/x-people/growth", guarded(async (req, reply) => {
      const window = Number((req.query as { window?: string }).window ?? 7);
      if (!(GROWTH_WINDOWS as readonly number[]).includes(window)) {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "window must be 7 or 30" });
      }
      return sendJsonWithEtag(req, reply, await growthBoard(window), { etagPrefix: `xp-growth-${window}`, cacheControl: CACHE });
    }));
    app.get("/api/site/x-people/growth/report", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await loadGrowthReports(), { etagPrefix: "xp-growth-report", cacheControl: CACHE });
    }));
    app.get("/api/site/x-people/compare", guarded(async (req, reply) => {
      const raw = String((req.query as { h?: string }).h ?? "");
      const handles = raw.split(",").map((h) => h.trim()).filter(Boolean);
      if (handles.length < 2 || handles.length > 3 || handles.some((h) => !HANDLE.test(h))) {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "pick 2–3 handles" });
      }
      return sendJsonWithEtag(req, reply, await loadCompare(handles), { etagPrefix: `xp-cmp-${handles.map((h) => h.toLowerCase()).join("-")}`, cacheControl: CACHE });
    }));
    app.get("/api/site/x-people/methodology", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await loadMethodology(), { etagPrefix: "xp-method", cacheControl: CACHE });
    }));
    // 算法视角：用本站数据回测「连发衰减 / 外链限流 / 讨论率涨粉」三个说法，10 分钟缓存。
    app.get("/api/site/x-people/algorithm", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await algorithmPage.get(undefined), { etagPrefix: "xp-algorithm", cacheControl: CACHE });
    }));    // 每日一张卡：今天写什么。带头像/诊断的那版带 ?handle=。
    app.get("/api/site/x-people/card", guarded(async (req, reply) => {
      const handle = String((req.query as { handle?: string }).handle ?? "").trim();
      const card = await loadDailyCard(handle || null);
      if (!card) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "热点榜还没有数据" });
      return sendJsonWithEtag(req, reply, card, { etagPrefix: `xp-card-${handle.toLowerCase()}`, cacheControl: CACHE });
    }));    // 今天发什么：热点榜 + 48 小时里的 X 讨论量，只读本站数据。
    app.get("/api/site/x-people/today", guarded(async (req, reply) => {
      const raw = Number((req.query as { limit?: string }).limit ?? 6);
      const limit = Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.trunc(raw))) : 6;
      return sendJsonWithEtag(req, reply, await todaysTopics(limit), { etagPrefix: `xp-today-${limit}`, cacheControl: CACHE });
    }));
    // 公开的「查我的账号」：只看本地库，不调付费接口。静态段要在 :handle 之前注册。
    app.get("/api/site/x-people/lookup", guarded(async (req, reply) => {
      const handle = String((req.query as { handle?: string }).handle ?? "");
      try {
        return reply.header("Cache-Control", "no-store").send(await lookupAccount(handle));
      } catch (error) {
        if (error instanceof RequestRejected) {
          return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
        }
        throw error;
      }
    }));
    // 申请收录：限频在 submitRequest 里（同一 IP 每天 5 次、待审总量 500）。
    app.post("/api/site/x-people/requests", guarded(async (req, reply) => {
      const body = (req.body ?? {}) as { handle?: string; note?: string; contact?: string };
      try {
        const result = await submitRequest({ handle: String(body.handle ?? ""), note: body.note ?? null, contact: body.contact ?? null, ip: req.ip });
        return reply.header("Cache-Control", "no-store").code(201).send(result);
      } catch (error) {
        if (error instanceof RequestRejected) {
          return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message, retryAfter: error.retryAfter });
        }
        throw error;
      }
    }));
    // 后台：采集成本看板（近 14 天，今天实时算）。
    app.get("/api/admin/x-collect", adminHandler(async () => ({ days: await recentCollectStats(14) })));
    // 后台：待审列表与通过/驳回。
    app.get("/api/admin/x-people/requests", adminHandler(async (req) => {
      const status = String((req.query as { status?: string }).status ?? "pending");
      if (!["pending", "approved", "rejected"].includes(status)) {
        throw new RequestRejected(400, "invalid_request", "status 只能是 pending / approved / rejected。");
      }
      return listRequests(status);
    }));
    app.post("/api/admin/x-people/requests/:handle", adminHandler(async (req, reply, admin) => {
      const handle = String((req.params as { handle?: string }).handle ?? "");
      const body = (req.body ?? {}) as { action?: string; reason?: string };
      if (body.action !== "approve" && body.action !== "reject") {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "action 只能是 approve 或 reject" });
      }
      try {
        return await reviewRequest(handle, body.action, body.reason?.trim() || null, actorOf(admin));
      } catch (error) {
        if (error instanceof RequestRejected) {
          return sendProblem(req, reply, { status: error.status, code: error.code, detail: error.message });
        }
        throw error;
      }
    }));
    app.get("/api/site/x-people/:handle", guarded(async (req, reply) => {
      const handle = String((req.params as { handle?: string }).handle ?? "");
      if (!HANDLE.test(handle)) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no such account" });
      const body = await personPage(handle);
      if (!body) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "no such account" });
      const [growth, report] = await Promise.all([loadPersonGrowth(handle), latestReportFor(handle)]);
      if (growth && report) {
        growth.report = {
          conclusion: report.report.conclusion,
          drivers: report.report.drivers,
          moves: report.report.moves,
          confidence: report.report.confidence,
          periodEnd: report.periodEnd,
          generatedAt: report.generatedAt,
          model: report.model,
        };
      }
      body.growth = growth;
      return sendJsonWithEtag(req, reply, body, { etagPrefix: `xp-${handle.toLowerCase()}`, cacheControl: CACHE });
    }));
  },

  // 这里两处模型步骤只属于本模块：涨粉报告每周跑，账号初标是一次性脚本。
  models: {
    x_growth_report: { label: "每周涨粉报告（根据发帖与同期报道写观察）", env: "X_GROWTH_REPORT_MODEL", purposes: ["x_growth.report"] },
    x_account_label: { label: "账号初标（类型 + 主类目，一次性脚本用）", env: "X_ACCOUNT_LABEL_MODEL", purposes: ["x_account.label"] },
  },

  // 后台导航的徽章：待审的收录申请（web.tsx 的 admin.content 用 count: "x-requests"）。
  admin: {
    counts: {
      "x-requests": async () => {
        const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM x_account_requests WHERE status = 'pending'`;
        return row?.n ?? 0;
      },
    },
  },

  schedules: [
    // 每五分钟把新回执里的粉丝数记成当天的快照；一次最多二十秒，回填没追完的下一轮接着来。
    { name: "x-followers.scan", cron: "*/5 * * * *", run: () => scanFollowerSnapshots() },
    // 每天把前一天的采集账记一行（成本看板）；排在 04:20 的分档之后，看到的是调完档的结果。
    { name: "x-profile.collect-stats", cron: "10 5 * * *", missed: "once", run: () => snapshotCollectStats() },
    // 每周一早上给「涨粉靠前且发帖够多」的账号出一份观察；表还空时进程启动就跑一次。
    {
      name: "x-growth.report",
      cron: "10 6 * * 1",
      missed: "once",
      run: () => generateGrowthReports(),
      runOnStart: async () => {
        const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM x_growth_reports`;
        return (row?.n ?? 0) === 0;
      },
    },
  ],
};
