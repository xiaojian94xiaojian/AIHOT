// 后台的知识库页面：模块的页面真的被注册进后台路由、SSR 能渲染出状态与卡片、搜索走 URL 参数、
// 没登录时被送去登录页。用合成 api 回答页面要的四个接口，所以这个测试不连数据库也不需要卡片文件。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import * as cheerio from "cheerio";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer;

const STATUS = {
  enabled: true,
  root: "/data/kb",
  intervalMinutes: 30,
  itemRetentionDays: 90,
  reportsLookback: 8,
  exportedAt: new Date().toISOString(),
  counts: { event: 12, report: 5, item: 40 },
  total: 57,
  inbox: 0,
  consistent: true,
  missing: [],
  changed: [],
};

const NOTE = {
  id: "kb-event-3f2a91",
  kind: "event",
  path: "notes/events/2026-10/kb-event-3f2a91.md",
  sha256: "0".repeat(64),
  title: "某公司发布某模型",
  tags: ["radar", "event", "ai-models"],
  status: "active",
  created_at: "2026-10-09T03:10:00.000Z",
  updated_at: "2026-10-09T03:10:00.000Z",
  source_refs: 2,
  frontmatter: {
    id: "kb-event-3f2a91",
    title: "某公司发布某模型",
    created_at: "2026-10-09T03:10:00.000Z",
    updated_at: "2026-10-09T03:10:00.000Z",
    tags: ["radar", "event", "ai-models"],
    source_refs: ["https://example.com/news/1", "https://example.com/news/2"],
    status: "active",
    ai_access: "allow",
  },
  body: "# 某公司发布某模型\n\n## 摘要\n\n发布了新模型。",
};

const SESSION = "aihot_admin=test-session";

const api = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://api");
  res.setHeader("Content-Type", "application/json");
  const send = (body: unknown) => res.end(JSON.stringify(body));
  if (url.pathname === "/api/health") return send({ ok: true });
  if (url.pathname === "/api/site/meta") return send({ changelogVersion: "2026-01-01T00:00" });
  // 页面上的每个后台读取都带访客自己的 cookie；没有有效会话时 api 答 401，页面据此送去登录页。
  if (url.pathname.startsWith("/api/admin/") || url.pathname.startsWith("/api/modules/kb/")) {
    if ((req.headers.cookie ?? "") !== SESSION) {
      res.statusCode = 401;
      return send({ code: "unauthorized", detail: "Sign in to the admin first." });
    }
  }
  if (url.pathname === "/api/admin/me") return send({ name: "测试管理员", csrf: "csrf-token", dev: false });
  if (url.pathname === "/api/admin/nav-counts") return send({ kb: 3, sources: 0, runs: 0, feedback: 0 });
  if (url.pathname === "/api/modules/kb/index") return send(STATUS);
  if (url.pathname === "/api/modules/kb/notes") return send({ count: 1, notes: [NOTE] });
  if (url.pathname === "/api/modules/kb/search") return send({ q: url.searchParams.get("q") ?? "", count: 1, hits: [{ note: NOTE, score: 160, matched: ["title", "body"] }] });
  if (url.pathname === "/api/modules/kb/note") return send(NOTE);
  if (url.pathname === "/api/modules/kb/tags") return send({ tags: [{ tag: "radar", count: 57 }] });
  res.statusCode = 404;
  return send({ code: "not_found", detail: `${url.pathname} is not stubbed` });
});

const get = (path: string, cookie = SESSION) => fetch(`${web.origin}${path}`, { headers: { cookie } });

before(async () => {
  web = await startWebServer(api);
});
after(() => web.stop());

test("后台导航里有「知识库」，页面能开", async () => {
  const response = await get("/admin/kb");
  assert.equal(response.status, 200, web.logs());
  const text = cheerio.load(await response.text()).text();
  assert.ok(text.includes("知识库"), "页面标题");
  assert.ok(text.includes("知识库") && text.includes("后台"), "后台导航");
});

test("状态、三类计数与卡片都渲染出来", async () => {
  const text = cheerio.load(await (await get("/admin/kb")).text()).text();
  assert.ok(text.includes("导出已开启"), "安全阀状态");
  assert.ok(text.includes("每 30 分钟一次"), "导出间隔");
  assert.ok(text.includes("清单与文件一致"), "清单校验");
  assert.ok(text.includes("事件卡") && text.includes("报告卡") && text.includes("精选卡"), "三类计数");
  assert.ok(text.includes("某公司发布某模型"), "卡片标题");
  assert.ok(text.includes("kb-event-3f2a91"), "卡片 id");
  assert.ok(text.includes("ai-models"), "标签");
  assert.ok(text.includes("立即导出"), "手动导出按钮");
});

test("搜索走 URL 参数，分数与命中部位一起显示", async () => {
  const text = cheerio.load(await (await get(`/admin/kb?q=${encodeURIComponent("模型")}`)).text()).text();
  assert.ok(text.includes("命中 1 条"), "命中条数");
  assert.ok(text.includes("160"), "加权分数");
  assert.ok(text.includes("标题") && text.includes("正文"), "命中部位");
});

test("点开一篇：Markdown 预览给出路径与正文", async () => {
  const text = cheerio.load(await (await get("/admin/kb?id=kb-event-3f2a91")).text()).text();
  assert.ok(text.includes("Markdown 预览"));
  assert.ok(text.includes("notes/events/2026-10/kb-event-3f2a91.md"), "文件路径");
  assert.ok(text.includes("# 某公司发布某模型"));
  assert.ok(text.includes("不要手改文件"), "提示下一次导出会覆盖");
});

test("没登录时送去登录页，页面本身不泄露内容", async () => {
  const response = await fetch(`${web.origin}/admin/kb`, { redirect: "manual", headers: { cookie: "aihot_admin=stale" } });
  assert.ok([302, 303, 307].includes(response.status), `期望重定向，得到 ${response.status}`);
  assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login/);
});

test("后台其它页面照常（模块没有抢走路由）", async () => {
  // /admin 落到第一个声明 landing 的模块页，没有就落到信源。
  const landing = await fetch(`${web.origin}/admin`, { redirect: "manual", headers: { cookie: SESSION } });
  assert.ok([302, 303, 307].includes(landing.status), `期望重定向，得到 ${landing.status}`);
  assert.match(landing.headers.get("location") ?? "", /^\/admin\//);
});
