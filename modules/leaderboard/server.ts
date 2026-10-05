// 模型榜接进后端的插口（packages/backend/src/modules.ts 的 ServerModule）。
//
// 旧版这些路由、定时任务和告警长在框架里（apps/api/src/routes/leaderboard.ts、
// apps/worker/src/schedules.ts 的 FEATURES.leaderboard 分支、operations/alerts.ts 末尾两段），
// 4.0.0 把功能移出框架时一并删掉。这里按 4.0.0 的插口接回：
//   http         -> apps/api/src/app.ts 注册完框架路由后遍历 serverModules()
//   schedules    -> apps/worker/src/schedules.ts 与框架的定时任务一起排
//   models       -> editorial/models.ts 的 capabilities()，默认模型从 site/models.ts 取
//   http 里的图标路由 -> 用引擎的 sendFile 发本模块 assets/ 下的厂商标志与评测来源标志
//   admin/alerts/agent/llms -> 后台徽章与运行页、健康告警、Agent 指南与 MCP 工具
import type { FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { z } from "zod";
import { sendFile } from "@aihot/api/routes/static";
import type { Finding } from "@aihot/backend/notify/feishu";
import { beijingStamp } from "@aihot/backend/notify/feishu";
import type { ServerModule } from "@aihot/backend/modules";
import { sendJsonWithEtag, sendProblem } from "@aihot/backend/lib/http";
import { sql } from "@aihot/backend/db";
import { LEADERBOARD_PUBLIC_BOARDS, type LeaderboardBoardKey } from "@aihot/contracts/taxonomy";
import { loadBoard, loadModel, loadRulesData, loadSource, loadSources, NoLeaderboardRun, unmarkedBoardModels } from "./backend/read.ts";
import { refreshLeaderboard, type SourceState } from "./backend/fetch/refresh.ts";
import { runLeaderboardRound } from "./backend/method/run.ts";

/** 与旧版一致：站点接口的答案缓存两分钟，共享缓存五分钟。 */
const CACHE = "public, max-age=120, s-maxage=300, stale-while-revalidate=600";
/** 图标几乎不变；旧版服务这两个目录时就是一周。 */
const MARK_CACHE = "public, max-age=604800";
/** 本模块自己带的图标：对外地址 → assets/ 下的目录。 */
const ASSET_DIRS: Record<string, string> = { "/model-providers": "model-providers", "/leaderboard-sources": "leaderboard-sources" };
/** 图标放在模块里，跟着模块走（不是仓库根的 assets/）。 */
const ASSETS = path.join(import.meta.dirname, "assets");

/** 抓取与计算是否真的出网（采集总闸；关掉时只用已经存下的快照算一轮）。 */
const collecting = () => process.env.COLLECT_ENABLED === "true";

/**
 * 站点接口的错误处理。旧版每个路由都过 apps/api/src/routes/site.ts 的 siteHandler；模块不能 import
 * apps/，所以这里只写站点接口用得上的那几种：榜单还没算出来是 503（不是 404），其余是 503 稍后重试。
 */
function guarded(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (error) {
      if (error instanceof NoLeaderboardRun) {
        return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "leaderboard not computed yet", retryAfter: 300 });
      }
      req.log.error({ err: error, path: req.url.split("?")[0] }, "leaderboard api error");
      return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "temporarily unavailable", retryAfter: 10 });
    }
  };
}

const notFound = (req: FastifyRequest, reply: FastifyReply) =>
  sendProblem(req, reply, { status: 404, code: "not_found", detail: "not found", cacheControl: "public, max-age=60" });

/** 榜上有几个模型没有厂商标志（后台徽章与告警都用它）。 */
async function unmarkedCount(): Promise<number> {
  return (await unmarkedBoardModels().catch(() => [] as string[])).length;
}

/** 后台运行页里本模块那块：各评测来源的抓取状态（旧版是 AdminRuns.leaderboard 的模型榜卡片）。 */
async function runsPart() {
  const [lb] = await sql<{ value: { at?: string; sources?: Record<string, SourceState> } }[]>`
    SELECT value FROM settings WHERE key = 'leaderboard.fetch'`;
  if (!lb?.value) return null;
  const sources = Object.entries(lb.value.sources ?? {})
    .map(([key, s]) => ({ key, ...s }))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.key.localeCompare(b.key));
  return { at: lb.value.at ?? new Date().toISOString(), sources };
}

/** 一个评测来源超过一天没抓到：榜单暂用它上一份快照。 */
async function staleSources(now: number): Promise<Finding[]> {
  const [lb] = await sql<{ value: { sources?: Record<string, { ok: boolean; lastOkAt: string | null; error?: string }> } }[]>`
    SELECT value FROM settings WHERE key = 'leaderboard.fetch'`;
  const stale = Object.entries(lb?.value.sources ?? {}).filter(([, s]) => !s.ok && s.lastOkAt && now - Date.parse(s.lastOkAt) > 26 * 3600_000);
  if (!stale.length) return [];
  return [{
    key: "leaderboard.fetch",
    level: "digest",
    title: `模型榜有 ${stale.length} 个评测来源超过一天没抓到，榜单暂用上一份数据`,
    detail: stale.slice(0, 6).map(([k, s]) => `${k}：${s.error ?? "失败"}（上次成功 ${beijingStamp(s.lastOkAt!)}）`).join("；"),
  }];
}

/** 榜上有模型没有厂商标志，页面上只显示首字母。 */
async function unmarkedFinding(): Promise<Finding[]> {
  const models = await unmarkedBoardModels().catch(() => [] as string[]);
  if (!models.length) return [];
  return [{
    key: "leaderboard.marks",
    level: "digest",
    title: `模型榜有 ${models.length} 个模型没有厂商标志，暂时显示首字母`,
    detail: `${models.slice(0, 8).join("、")}；标志文件放本模块的 assets/model-providers，映射在 backend/registry.ts`,
  }];
}

/** 一个榜单的 Markdown 摘要，给 Agent 与 MCP 工具用。 */
async function boardMarkdown(key: LeaderboardBoardKey): Promise<string> {
  const body = await loadBoard(key);
  if (!body) return `模型榜的「${key}」榜单暂时没有数据。\n`;
  const lines = [
    `# 模型榜 · ${body.board.name}`,
    "",
    body.board.description,
    "",
    `读法：${body.board.howToRead}`,
    "",
    `| 名次 | 模型 | 分数 | 覆盖 |`,
    `|---|---|---|---|`,
    ...body.entries.map((e) => `| ${e.rank} | ${e.model.name}${e.model.provider ? `（${e.model.provider}）` : ""} | ${e.score === null ? "—" : Math.round(e.score)} | ${Math.round(e.coverage * 100)}% |`),
  ];
  return `${lines.join("\n")}\n`;
}

export const leaderboardServerModule: ServerModule = {
  name: "leaderboard",

  http(app) {
    app.get("/api/site/leaderboard/boards/:key", guarded(async (req, reply) => {
      const key = (req.params as { key: string }).key;
      if (!(LEADERBOARD_PUBLIC_BOARDS as readonly string[]).includes(key)) return notFound(req, reply);
      const body = await loadBoard(key as LeaderboardBoardKey);
      if (!body) return notFound(req, reply);
      return sendJsonWithEtag(req, reply, body, { etagPrefix: `lb-${key}`, cacheControl: CACHE });
    }));

    app.get("/api/site/leaderboard/models/:slug", guarded(async (req, reply) => {
      const body = await loadModel((req.params as { slug: string }).slug);
      if (!body) return notFound(req, reply);
      return sendJsonWithEtag(req, reply, body, { etagPrefix: "lb-model", cacheControl: CACHE });
    }));

    app.get("/api/site/leaderboard/sources", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await loadSources(), { etagPrefix: "lb-sources", cacheControl: CACHE });
    }));

    app.get("/api/site/leaderboard/sources/:key", guarded(async (req, reply) => {
      const body = await loadSource((req.params as { key: string }).key);
      if (!body) return notFound(req, reply);
      return sendJsonWithEtag(req, reply, body, { etagPrefix: "lb-source", cacheControl: CACHE });
    }));

    app.get("/api/site/leaderboard/rules", guarded(async (req, reply) => {
      return sendJsonWithEtag(req, reply, await loadRulesData(), { etagPrefix: "lb-rules", cacheControl: CACHE });
    }));

    // 网页上的图标：厂商标志与评测来源标志，放本模块的 assets/ 下（模块自包含）。
    // 发送用引擎的 sendFile（apps/api/src/routes/static.ts 导出，带 ETag/304 与按扩展名定类型）；
    // 地址由 module.ts 的 apiPaths 认领，否则会被网页进程当成页面路由。
    for (const [prefix, dir] of Object.entries(ASSET_DIRS)) {
      app.get(`${prefix}/:file`, (req, reply) => {
        const file = (req.params as { file: string }).file;
        if (!/^[a-z0-9-]+\.(svg|png)$/.test(file)) return reply.code(404).send();
        return sendFile(req, reply, path.join(ASSETS, dir, file), { cacheControl: MARK_CACHE });
      });
    }
  },

  // 每天四次上游检查；只有证据变了才发布新的一轮（runLeaderboardRound 自己判断）。
  // 新站（或表刚建好还没算过）先立刻算一轮，否则要等到下一个整点档（旧版在 apps/worker/src/main.ts 里做这件事）。
  schedules: [{
    name: "leaderboard.round",
    cron: "5 2,8,14,20 * * *",
    missed: "once",
    run: () => (collecting() ? refreshLeaderboard() : runLeaderboardRound()),
    runOnStart: async () => {
      const [published] = await sql`SELECT 1 FROM lb_runs WHERE status = 'published' LIMIT 1`;
      return !published;
    },
  }],

  // 榜单的口径校准会调模型，这一步的模型选择归本站（site/models.ts 的 DEFAULTS）。
  models: {
    leaderboard: { label: "模型榜（证据归纳与口径校准）", env: "LEADERBOARD_MODEL", purposes: ["leaderboard.calibrate"] },
  },

  // 厂商标志与评测来源的标志（本模块的 assets/），由上面的 http 插口发出。

  // 「榜单里有多少模型还没有厂商标志」给后台导航的徽章用（web 侧声明 count: "leaderboard"）。
  admin: {
    counts: { leaderboard: unmarkedCount },
    runs: runsPart,
  },

  alerts: async (now) => [...(await staleSources(now)), ...(await unmarkedFinding())],

  agent: {
    abilities: [{
      path: "/leaderboard",
      title: "模型榜",
      ask: "现在哪些模型排在最前面",
      answer: () => boardMarkdown("overall"),
      etagPrefix: "agent-lb",
      cacheControl: "public, max-age=300, s-maxage=600, must-revalidate",
      mcp: {
        tool: "get_leaderboard",
        use: "for the model leaderboard",
        description: "当前模型榜的综合榜：名次、模型、厂商、分数与覆盖度。",
        input: z.object({}),
        run: async () => {
          const body = await loadBoard("overall");
          return { text: await boardMarkdown("overall"), structured: (body ?? {}) as unknown as Record<string, unknown> };
        },
      },
    }],
  },
};
