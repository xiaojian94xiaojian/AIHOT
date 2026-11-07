// 公开的账号收录：查询、申请（去重与限频）、后台审核（通过即建 hot_signal 源）。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { listRequests, lookupAccount, RequestRejected, reviewRequest, submitRequest } from "../backend/requests.ts";

const T = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
