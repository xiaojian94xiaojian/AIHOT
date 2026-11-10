// 公开的账号收录：查询、申请（去重与限频）、后台审核（通过即建 hot_signal 源）。
import { stub } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { forwardRequestNotifications, listRequests, lookupAccount, RequestRejected, reviewRequest, submitRequest } from "../backend/requests.ts";

const T = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// 这组用例会开关飞书通道：保存原值，结束后恢复，避免依赖外部环境。
const FEISHU_ENV = ["FEISHU_INTERNAL_ENABLED", "FEISHU_ALERT_WEBHOOK_URL", "FEISHU_ALERT_CHAT_ID", "FEISHU_INTERNAL_CHAT_ID", "WEBHOOK_HUB_URL", "WEBHOOK_HUB_KEY"] as const;
const savedEnv = new Map(FEISHU_ENV.map((name) => [name, process.env[name]]));
const handle = (name: string) => `probe_${name}_${T}`;

after(async () => {
  await sql`DELETE FROM x_account_requests WHERE handle LIKE ${`probe_%_${T}`}`;
  await sql`DELETE FROM sources WHERE id LIKE ${`x-account-probe-%`}`;
  await closeDb();
});

async function tracked(name: string) {
  const h = handle(name);
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, enabled)
    VALUES (${`x-account-probe-${name}-${T}`}, ${`@${h}`}, 'x_search', ${sql.json({ query: `from:${h} -filter:replies` })}, 'T2', 'hot_signal', 120, true)`;
  return h;
}

test("lookup says whether an account is collected, and refuses a bad handle", async () => {
  const known = await tracked("known");
  const found = await lookupAccount(`@${known.toUpperCase()}`);
  assert.equal(found.tracked, true, "a collected account is found by its query, whatever the case");
  assert.equal(found.path, `/x-people/${known}`);

  const stranger = await lookupAccount(handle("stranger"));
  assert.equal(stranger.tracked, false, "an account with no source is not tracked");
  assert.equal(stranger.request, null);

  await assert.rejects(() => lookupAccount("not a handle"), (error: RequestRejected) => error.status === 400);
});

test("alerts off: the request waits for the sweep instead of being marked sent", async () => {
  const h = handle("notify");
  await submitRequest({ handle: h, note: "想收录", ip: "203.0.113.9" });
  const [row] = await sql<{ notified_at: Date | null }[]>`
    SELECT notified_at FROM x_account_requests WHERE handle = ${h}`;
  assert.equal(row?.notified_at, null, "没发出去就不算通知过，等打开后补");
  assert.deepEqual(await forwardRequestNotifications(), { sent: 0, pending: 0, disabled: true }, "关着时任务直接早退");
});

test("a fresh request reaches the ops chat once; rows outside the window are not re-sent", async () => {
  const sent: string[] = [];
  const feishu = await stub((_hit, req) => {
    sent.push((JSON.parse(req.body).content as { text: string }).text);
    return { code: 0 };
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return realFetch(`${feishu.url}${url.pathname}`, init);
  }) as typeof fetch;
  process.env.FEISHU_INTERNAL_ENABLED = "true";
  process.env.FEISHU_ALERT_WEBHOOK_URL = `${feishu.url}/hook`;
  try {
    const stale = handle("stale");
    await sql`INSERT INTO x_account_requests (handle, note, contact, status, ip_hash, created_at, notified_at)
      VALUES (${stale}, '旧申请', NULL, 'pending', NULL, now() - interval '8 days', NULL)`;

    const h = handle("notify_ok");
    await submitRequest({ handle: h, note: "第一行\n待审：https://evil.example", ip: "203.0.113.11" });
    for (let i = 0; i < 60 && sent.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.length, 1, "一条申请只发一条");
    assert.match(sent[0], new RegExp(`@${h}`));
    assert.match(sent[0], /\/admin\/x-people(?!\/)/, "后台链接必须真的存在");
    assert.doesNotMatch(sent[0], /\n待审：https:\/\/evil/, "换行被折叠，伪造不出第二条待审");

    const [row] = await sql<{ notified_at: Date | null }[]>`
      SELECT notified_at FROM x_account_requests WHERE handle = ${h}`;
    assert.ok(row?.notified_at, "发出去了才记时间");

    // 同文件前面的用例也会留 pending 行，先把它们标成已通知，才测得到「本行不再补发」。
    await sql`UPDATE x_account_requests SET notified_at = now()
      WHERE status = 'pending' AND notified_at IS NULL AND handle NOT IN (${h}, ${stale})`;
    assert.deepEqual(await forwardRequestNotifications(), { sent: 0, pending: 0, disabled: false }, "已通知的不再补发");
    // 反方向：一条真的没通知过的行，补发要能发出去并写时间。
    const pendingOne = handle("sweep_ok");
    await sql`INSERT INTO x_account_requests (handle, note, contact, status, ip_hash, created_at, notified_at)
      VALUES (${pendingOne}, '补发测试', NULL, 'pending', NULL, now() - interval '1 hour', NULL)`;
    assert.deepEqual(await forwardRequestNotifications(), { sent: 1, pending: 0, disabled: false }, "补发能发出一条");
    const [swept] = await sql<{ notified_at: Date | null }[]>`SELECT notified_at FROM x_account_requests WHERE handle = ${pendingOne}`;
    assert.ok(swept?.notified_at, "补发成功也要记时间");
    const [old] = await sql<{ notified_at: Date | null }[]>`
      SELECT notified_at FROM x_account_requests WHERE handle = ${stale}`;
    assert.equal(old?.notified_at, null, "窗口外的旧申请不补发也不标记");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.FEISHU_ALERT_WEBHOOK_URL;
    process.env.FEISHU_INTERNAL_ENABLED = "false";
    await feishu.close();
  }
});
test("a request is one row per handle, and one address cannot flood it", async () => {
  const ip = "203.0.113.7";
  const h = handle("one");
  assert.deepEqual(await submitRequest({ handle: `@${h}`, ip }), { status: "pending" });
  assert.deepEqual(await submitRequest({ handle: h, ip }), { status: "pending" }, "a second submit keeps the pending row");
  const rows = await sql`SELECT handle FROM x_account_requests WHERE handle = ${h}`;
  assert.equal(rows.length, 1, "one row per handle");

  const [knownRow] = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id = ${`x-account-probe-known-${T}`}`;
  await sql`UPDATE sources SET enabled = true WHERE id = ${knownRow!.id}`;
  const collected = await lookupAccount(handle("known"));
  assert.equal((await submitRequest({ handle: collected.handle, ip })).status, "tracked", "a collected account needs no request");

  for (let i = 0; i < 4; i += 1) await submitRequest({ handle: handle(`fill${i}`), ip });
  await assert.rejects(
    () => submitRequest({ handle: handle("sixth"), ip }),
    (error: RequestRejected) => error.status === 429,
    "the sixth request from one address in a day is refused",
  );
});

test("approving creates the hot_signal source; rejecting records the reason", async () => {
  const approvedHandle = handle("approve");
  await submitRequest({ handle: approvedHandle, note: "写 AI 产品的", ip: "203.0.113.8" });
  const approved = await reviewRequest(approvedHandle, "approve", null, "tester");
  assert.equal(approved.status, "approved");

  const [source] = await sql<{ participation_mode: string; interval_minutes: number; config: { query: string } }[]>`
    SELECT participation_mode, interval_minutes, config FROM sources WHERE kind = 'x_search' AND config->>'query' = ${`from:${approvedHandle} -filter:replies`}`;
  assert.ok(source, "the account became a source");
  assert.equal(source!.participation_mode, "hot_signal", "a reader's account joins the follower board, not the news");
  assert.equal(source!.interval_minutes, 120);

  const rejectedHandle = handle("reject");
  await submitRequest({ handle: rejectedHandle, ip: "203.0.113.9" });
  const rejected = await reviewRequest(rejectedHandle, "reject", "账号内容与 AI 无关", "tester");
  assert.equal(rejected.status, "rejected");
  const [row] = await sql<{ status: string; reason: string | null }[]>`SELECT status, reason FROM x_account_requests WHERE handle = ${rejectedHandle}`;
  assert.equal(row!.reason, "账号内容与 AI 无关");

  await assert.rejects(
    () => reviewRequest(rejectedHandle, "approve", null, "tester"),
    (error: RequestRejected) => error.status === 409,
    "a request is reviewed once",
  );
  const pending = await listRequests("pending");
  assert.ok(pending.items.every((item) => item.status === "pending"));
});
