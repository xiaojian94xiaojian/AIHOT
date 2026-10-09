// 知识库接进后端的插口（packages/backend/src/modules.ts 的 ServerModule）。
//
//   http      -> 读取出口：列表 / 单篇 / 搜索 / 标签 / 清单 / 手动导出（只给管理员，不进公开出口）
//   schedules -> 每 KB_INTERVAL_MINUTES 分钟入队一次导出
//   queues    -> kb.export：真正的导出作业（单例，同一时刻只跑一份）
//   admin     -> 后台导航的徽标
//   retention -> 每日保留：过期精选卡、archive/ 超期文件
//   on        -> 撤回传播：报道被撤回/改小时，受影响的事件卡立刻离开 notes/，随后重导一遍
//
// 零模型调用：导出只读库、只写文件。读者打开页面也不会触发任何模型调用。
import type { FastifyReply, FastifyRequest } from "fastify";
import { adminHandler } from "@aihot/backend/admin/auth";
import { enqueueOn, type QueueOptions } from "@aihot/backend/jobs/queue";
import { looseQuery, sendProblem } from "@aihot/backend/lib/http";
import { defineQueue, type ModuleQueue, type ServerModule } from "@aihot/backend/modules";
import { exportCron, kbConfig } from "./backend/config.ts";
import { exportEnabled, exportKb } from "./backend/export.ts";
import type { NoteKind } from "./backend/layout.ts";
import { inboxCount, kbRetention, withdrawStories } from "./backend/prune.ts";
import { listNotes, listTags, loadIndex, readNote, searchNotes, verifyIndex, type ListQuery, type NoteRef } from "./backend/read.ts";

/**
 * 导出队列。单例：每次入队都带 `singletonKey: "kb.export"`，前一份还没跑完时新的入队会被忽略 ——
 * 定时触发与事件触发因此不会同时写盘。重试一次，再失败就留到下一个周期（后台“运行”页能看到）。
 */
const exportQueue: ModuleQueue<{ reason: string }> = defineQueue<{ reason: string }>({
  name: "kb.export",
  options: { policy: "singleton", retryLimit: 1, retryDelay: 60, expireInSeconds: 1800 } satisfies QueueOptions,
  // 一次只跑一份（batchSize 1）：导出是「读一遍库、写一遍盘」，两份同时跑只会互相覆盖。
  worker: { batchSize: 1, pollingIntervalSeconds: 10 },
  run: async (jobs) => {
    const reason = jobs[0]?.reason ?? "scheduled";
    if (!exportEnabled()) return { skipped: "KB_EXPORT_ENABLED is not true" };
    const result = await exportKb();
    return { reason, counts: result.counts, total: result.total, written: result.actions.filter((a) => a !== "unchanged").length };
  },
});

/** 入队一次导出；同一个 singletonKey 只留一份，连着一堆变化也只导一次。 */
async function requestExport(reason: string): Promise<void> {
  await enqueueOn(exportQueue, { reason }, { singletonKey: "kb.export" });
}

/** 后台导航的徽标：最近 24 小时内内容有更新的卡片数（导出每 KB_INTERVAL_MINUTES 分钟刷新一次）。 */
async function freshCount(): Promise<number> {
  const index = await loadIndex();
  if (!index) return 0;
  const since = Date.now() - 86_400_000;
  return index.notes.filter((n) => Date.parse(n.updated_at) >= since).length;
}

/** 卡片类型：写错了当没写（列表页的筛选不该因为手滑打不开）。 */
function kindOf(value: string | undefined): NoteKind | null {
  return value === "event" || value === "report" || value === "item" ? value : null;
}

function limitOf(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

/** 知识库的整体状态：后台页面读它，agent 也能看出来有没有内容。 */
async function kbStatus() {
  const config = kbConfig();
  const index = await loadIndex();
  const check = index ? await verifyIndex() : null;
  return {
    enabled: config.exportEnabled,
    root: config.root,
    intervalMinutes: config.intervalMinutes,
    itemRetentionDays: config.itemRetentionDays,
    reportsLookback: config.reportsLookback,
    exportedAt: index?.exportedAt ?? null,
    counts: index?.counts ?? { event: 0, report: 0, item: 0 },
    total: index?.notes.length ?? 0,
    inbox: await inboxCount(),
    /** 清单与磁盘是否一致；不一致时后台页面提示重新导出。 */
    consistent: check ? check.missing.length === 0 && check.changed.length === 0 : null,
    missing: check?.missing ?? [],
    changed: check?.changed ?? [],
  };
}

/** 后台页面读的卡片形状：清单里的一行（含 frontmatter 与正文），摊平成一个对象。 */
function wireNote(note: NoteRef) {
  return { ...note };
}

export const kbServerModule: ServerModule = {
  name: "kb",

  http(app) {
    const orNotFound = (req: FastifyRequest, reply: FastifyReply, value: unknown) =>
      value === null || value === undefined ? sendProblem(req, reply, { status: 404, code: "not_found", detail: "No such note." }) : value;

    app.get("/api/modules/kb/index", adminHandler(() => kbStatus()));

    app.get("/api/modules/kb/notes", adminHandler(async (req) => {
      const q = looseQuery(req);
      const notes = await listNotes({
        kind: kindOf(q.kind),
        tag: q.tag?.trim() || null,
        status: q.status?.trim() || null,
        limit: limitOf(q.limit, 100, 500),
      } satisfies ListQuery);
      return { count: notes.length, notes: notes.map(wireNote) };
    }));

    app.get("/api/modules/kb/note", adminHandler(async (req, reply) => {
      const note = await readNote(looseQuery(req).id ?? "");
      return note ? wireNote(note) : orNotFound(req, reply, null);
    }));

    app.get("/api/modules/kb/search", adminHandler(async (req) => {
      const q = looseQuery(req);
      const hits = await searchNotes({ q: q.q ?? "", kind: kindOf(q.kind), tag: q.tag?.trim() || null, limit: limitOf(q.limit, 50, 200) });
      return { q: q.q ?? "", count: hits.length, hits };
    }));

    app.get("/api/modules/kb/tags", adminHandler(async () => ({ tags: await listTags() })));

    // 手动导出：后台页面上的按钮。走同一条队列，所以不会和定时任务撞车。
    app.post("/api/modules/kb/export", adminHandler(async (req, reply) => {
      if (!exportEnabled()) return sendProblem(req, reply, { status: 409, code: "disabled", detail: "KB_EXPORT_ENABLED is not true." });
      await requestExport("admin");
      return { queued: true };
    }));
  },

  // 每 KB_INTERVAL_MINUTES 分钟入队一次导出。安全阀关着时定时任务照常跑，作业立刻返回「没开」，
  // 这样后台“运行”页能看到它的执行记录。
  schedules: [{ name: "kb.export", cron: exportCron(), run: () => requestExport("scheduled") }],

  queues: [exportQueue],

  admin: { counts: { kb: freshCount } },

  // 每日保留：过期精选卡、archive/ 里超过 7 天的文件、inbox/ 的兜底清理。
  retention: async (now) => {
    const result = await kbRetention(now);
    return { kbDeletedItems: result.deletedItems, kbDeletedArchived: result.deletedArchived, kbClearedInbox: result.clearedInbox };
  },

  on: {
    /**
     * 一条报道的公开内容变了。撤回或展示变少（`reduced`）时，受影响的事件卡**立刻**离开 notes/ 进 archive/，
     * 再入队重导一遍；其余变化（更正、补译、重新分组）只重导。
     *
     * 事件卡的 id 用公开 id，`previousStoryIds` 给的是数字 id，所以要查一次库换算。这个钩子跑在
     * 调用方的事务里，查的是 stories 主键，很轻；文件操作不参与事务，事务回滚时卡片已经被移走，
     * 下一次导出会把它按新的事实写回来（幂等，不丢内容）。
     */
    async articleChanged(change) {
      if (change.reduced && change.previousStoryIds?.length) await withdrawStories(change.previousStoryIds);
      await requestExport(`article:${change.reason}`);
    },
    /** 报告被发布或改写：整批重导一遍，受影响的报告卡会被覆盖成新的。 */
    async reportsChanged(change) {
      await requestExport(`reports:${change.reason}`);
    },
  },
};
