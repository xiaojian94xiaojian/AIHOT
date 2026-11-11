// 回执的原始请求/响应有保留期限：embedding 的答案用完就不再读（14 天），其余回执的响应还要喂给
// X 涨粉扫描（回看 32 天），所以留 45 天。清掉时同时改写 logical_key，免得几天后的重试命中一条
// 没有答案的旧回执。行本身和花费一直保留，是「付了什么钱」的账。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { dailyRetention } from "@aihot/backend/operations/retention";

const T = tag();
const NOW = new Date("2026-11-11T03:30:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const keys: string[] = [];

async function add(name: string, service: string, purpose: string, days: number): Promise<{ key: string; id: number }> {
  const key = `retention-${T}-${name}`;
  keys.push(key);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, purpose, status, request, response, created_at)
    VALUES (${key}, ${service}, ${purpose}, 'completed', ${sql.json({ q: name })}, ${sql.json({ a: name })}, ${daysAgo(days)})
    RETURNING id`;
  return { key, id: row!.id };
}

after(async () => {
  await sql`DELETE FROM receipts WHERE logical_key LIKE ${`retention-${T}-%`}`;
  await closeDb();
});

test("old payloads are dropped, recent ones stay, and a dropped answer is never replayed", async () => {
  const oldModel = await add("old-model", "deepseek", "score_article", 60);
  const recentModel = await add("recent-model", "deepseek", "score_article", 20);
  const oldVector = await add("old-vector", "embedding", "embedding", 20);
  const recentVector = await add("recent-vector", "embedding", "embedding", 10);
  const oldFetch = await add("old-fetch", "socialdata", "source_fetch", 40);

  const summary = await dailyRetention(NOW) as { prunedReceiptPayloads: number };
  assert.ok(summary.prunedReceiptPayloads >= 2, `expected the old payloads to be pruned, got ${summary.prunedReceiptPayloads}`);

  const row = async (key: string) => (await sql<{ request: unknown; response: unknown; logical_key: string }[]>`
    SELECT request, response, logical_key FROM receipts WHERE logical_key = ${key} OR logical_key LIKE ${`${key}:pruned:%`}`)[0];

  assert.equal((await row(oldModel.key))?.response, null, "a model answer older than the window is dropped");
  assert.notEqual((await row(oldModel.key))?.request, null, "the request stays: it can carry the fallback marker");
  assert.match((await row(oldModel.key))!.logical_key, /:pruned:\d+$/, "the key no longer matches the live request");

  assert.notEqual((await row(recentModel.key))?.response, null, "an answer inside the window is kept");
  assert.equal((await row(recentModel.key))!.logical_key, recentModel.key, "a kept answer keeps its key");

  assert.equal((await row(oldVector.key))?.response, null, "an embedding answer is dropped at its shorter window");
  assert.notEqual((await row(recentVector.key))?.response, null, "a recent embedding answer is kept");

  assert.notEqual((await row(oldFetch.key))?.response, null, "the X fetch answers the growth lookback reads stay longer");
});

test("an unknown receipt handed to a backup stays parked after its response is pruned", async () => {
  const key = `retention-${T}-parked`;
  keys.push(key);
  await sql`
    INSERT INTO receipts (logical_key, service, purpose, status, request, response, created_at)
    VALUES (${key}, 'deepseek', 'score_article', 'unknown',
            ${sql.json({ prompt: "x", fallbackReceiptId: 4242 })}, ${sql.json({ answer: "y" })}, ${daysAgo(60)})`;

  await dailyRetention(NOW);

  // awaitingRelease() 的判据：status='unknown' 且 request 里没有 fallbackReceiptId。
  const [parked] = await sql<{ response: unknown; request: { fallbackReceiptId?: number } | null }[]>`
    SELECT response, request FROM receipts WHERE logical_key LIKE ${`${key}:pruned:%`} OR logical_key = ${key}`;
  assert.equal(parked?.response, null, "the parked receipt's answer is dropped like any other");
  assert.equal(parked?.request?.fallbackReceiptId, 4242, "the marker that keeps it parked is not touched");
});
