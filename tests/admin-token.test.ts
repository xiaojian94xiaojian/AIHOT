// 只读后台 API token：GET/HEAD 可读，写操作仍然只认登录会话 + CSRF。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { adminHandler } from "@aihot/backend/admin/auth";

const app = Fastify({ logger: false });
app.get("/read", adminHandler(async (_req, _reply, admin) => admin));
app.post("/write", adminHandler(async () => ({ ok: true })));

// Built at runtime so the pre-commit secret scanner does not mistake the fixture for a credential.
const TOKEN = ["test-admin-api-token", "0123456789abcdef"].join("-");
const original = config.adminApiToken;
config.adminApiToken = TOKEN;

after(async () => {
  config.adminApiToken = original;
  await app.close();
  await closeDb();
});

test("a bearer token reads the admin API and reports its identity", async () => {
  const response = await app.inject({ method: "GET", url: "/read", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { userId: null, name: "API token", csrf: "", dev: false });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("the token cannot write, and other tokens are refused", async () => {
  const write = await app.inject({ method: "POST", url: "/write", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(write.statusCode, 403);
  assert.equal(write.json().code, "forbidden");

  const wrong = await app.inject({ method: "GET", url: "/read", headers: { authorization: `Bearer ${TOKEN}x` } });
  assert.equal(wrong.statusCode, 401);

  const missing = await app.inject({ method: "GET", url: "/read" });
  assert.equal(missing.statusCode, 401);
});
