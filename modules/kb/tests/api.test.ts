// 模块的读取出口：后台接口（只给管理员）与 module.ts 认领的地址。知识库不进公开出口，
// 所以这里不测 agent/MCP —— 那三条能力已按安全审查的结论移除。
//
// 用引擎自己的 buildApp 注入请求，所以验的是真路由：module.ts 的 apiPaths 有没有认领、adminHandler
// 有没有拦住没登录的人、JSON 的形状是不是后台页面期待的那一份。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const DATA = await mkdtemp(path.join(os.tmpdir(), "kb-api-"));
process.env.AIHOT_DATA_DIR = DATA;
// 这个文件要走通后台接口，所以开开发免登录（生产会拒绝启动，测试里只是拿一个管理员身份）。
// 没有它时 devAdmin 是 null，后台接口一律 401 —— 那正是 tests/private-routes.test.ts 要验的事。
process.env.DEV_AUTH_ROLE = "admin";

import type { ServerModule } from "@aihot/backend/modules";
const { installModules } = await import("@aihot/backend/modules");
const { renderNote, writeNote, kbRoot } = await import("../backend/layout.ts");
const { saveIndex } = await import("../backend/read.ts");
const { kbServerModule } = await import("../server.ts");
const { kbModule } = await import("../module.ts");
const { buildApp } = await import("../../../apps/api/src/app.ts");

installModules([kbServerModule] satisfies ServerModule[]);
const app = await buildApp();

const NOTES = [
  { id: "kb-event-abc", kind: "event", title: "某公司发布某模型", tags: ["radar", "event", "ai-models"], refs: ["https://example.com/a"], at: "2026-10-09T03:00:00.000Z", rel: "notes/events/2026-10/kb-event-abc.md", body: "# 某公司发布某模型\n\n## 摘要\n\n发布了新模型。" },
  { id: "kb-item-def", kind: "item", title: "开源权重的一次更新", tags: ["radar", "item", "open-source"], refs: ["https://github.com/example/repo"], at: "2026-10-08T03:00:00.000Z", rel: "notes/items/2026-10/kb-item-def.md", body: "# 开源权重的一次更新\n\n## 摘要\n\n权重放出来了。" },
] as const;

before(async () => {
  for (const note of NOTES) {
    const text = renderNote({
      frontmatter: { id: note.id, title: note.title, created_at: note.at, updated_at: note.at, tags: [...note.tags], source_refs: [...note.refs], status: "active", ai_access: "allow" },
      body: note.body,
    });
    await writeNote(note.rel, text);
  }
  await saveIndex({
    schemaVersion: 1,
    exportedAt: "2026-10-09T04:00:00.000Z",
    window: { itemRetentionDays: 90, reportsLookback: 8 },
    counts: { event: 1, item: 1 },
    notes: NOTES.map((note) => ({
      id: note.id, kind: note.kind, path: note.rel, sha256: hashOf(note), title: note.title, tags: [...note.tags],
      status: "active", created_at: note.at, updated_at: note.at, source_refs: note.refs.length,
    })),
  });
});

/** 清单里的 sha256 就是渲染后写进文件的那些字节。 */
function hashOf(note: (typeof NOTES)[number]): string {
  const text = renderNote({
    frontmatter: { id: note.id, title: note.title, created_at: note.at, updated_at: note.at, tags: [...note.tags], source_refs: [...note.refs], status: "active", ai_access: "allow" },
    body: note.body,
  });
  return createHash("sha256").update(text, "utf8").digest("hex");
}

after(async () => {
  await app.close();
  await rm(DATA, { recursive: true, force: true });
});

const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
};

test("module.ts 认领了 /api/modules/kb/，后台地址也注册上了", () => {
  assert.ok(kbModule.apiPaths?.some((re) => re.test("/api/modules/kb/notes")), "网页进程据此把请求转给 api");
  assert.equal(kbModule.apiPaths?.some((re) => re.test("/admin/kb")), false, "后台页面不是 api 路径");
  assert.deepEqual(kbModule.adminPages, [{ path: "admin/kb", file: "web/Kb.tsx" }]);
});

test("写操作要 CSRF 令牌，读操作只要管理员身份", async () => {
  const write = await app.inject({ method: "POST", url: "/api/modules/kb/export" });
  assert.equal(write.statusCode, 403, "有管理员身份但没有 CSRF 令牌的写操作一律拒绝（后台页面靠 useAdminAction 带上它）");
  const read = await app.inject({ method: "GET", url: "/api/modules/kb/index" });
  assert.equal(read.statusCode, 200, "读操作放行");
});

test("列表、单篇与清单：形状与后台页面的一致", async () => {
  const list = await get("/api/modules/kb/notes");
  assert.equal(list.json.count, 2);
  assert.deepEqual(list.json.notes.map((n: { id: string }) => n.id), ["kb-event-abc", "kb-item-def"]);
  const note = list.json.notes[0];
  assert.equal(note.frontmatter.title, "某公司发布某模型");
  assert.deepEqual(Object.keys(note.frontmatter), ["id", "title", "created_at", "updated_at", "tags", "source_refs", "status", "ai_access"], "frontmatter 恰好这 9 个字段");
  assert.ok(note.body.startsWith("# 某公司发布某模型"));
  assert.equal(note.sha256.length, 64);

  const filtered = await get("/api/modules/kb/notes?kind=item");
  assert.deepEqual(filtered.json.notes.map((n: { id: string }) => n.id), ["kb-item-def"]);
  assert.deepEqual((await get("/api/modules/kb/notes?kind=不存在")).json.notes.length, 2, "类型写错了当没写");

  const one = await get(`/api/modules/kb/note?id=${encodeURIComponent("kb-item-def")}`);
  assert.equal(one.json.title, "开源权重的一次更新");
  assert.equal((await get("/api/modules/kb/note?id=kb-item-不存在")).status, 404);
  assert.equal((await get("/api/modules/kb/note")).status, 404);

  const index = await get("/api/modules/kb/index");
  assert.equal(index.json.total, 2);
  assert.equal(index.json.consistent, true);
  assert.deepEqual(index.json.counts, { event: 1, item: 1 });
  assert.equal(index.json.enabled, false, "安全阀默认关着");
  assert.equal(index.json.inbox, 0);
  assert.ok(index.json.root.endsWith(path.join("kb")) || index.json.root.endsWith("kb"));
});

test("搜索接口：命中部位与分数一起给出来", async () => {
  const hit = await get(`/api/modules/kb/search?q=${encodeURIComponent("发布")}`);
  assert.equal(hit.json.count, 1);
  assert.equal(hit.json.hits[0].note.id, "kb-event-abc");
  assert.ok(hit.json.hits[0].matched.includes("title"));
  assert.ok(hit.json.hits[0].score >= 100);
  assert.deepEqual((await get("/api/modules/kb/search?q=")).json.hits, []);
});

test("标签接口：给的是库里的主题与分类", async () => {
  const tags = await get("/api/modules/kb/tags");
  assert.equal(tags.json.tags[0].tag, "radar");
  assert.ok(tags.json.tags.some((t: { tag: string }) => t.tag === "ai-models"));
});

test("安全阀默认关着：能看出来，也能照实说", async () => {
  const res = await get("/api/modules/kb/index");
  assert.equal(res.status, 200);
  assert.equal(res.json.enabled, false, "没设 KB_EXPORT_ENABLED 时不导出");
});

test("知识库根目录就在数据目录下（跟着卷走）", () => {
  assert.equal(kbRoot(), path.join(DATA, "kb"));
});
