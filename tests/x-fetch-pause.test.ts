// X_FETCH_PAUSED：暂停所有 X 抓取（采集、分片、监控、改名），RSS/网页不受影响。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { collectSource, collectXShard } from "@aihot/backend/sources/collect";

const T = tag();
const ID = `test-xpause-${T}`;
const original = config.xFetchPaused;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, enabled)
            VALUES (${ID}, '@paused', 'x_search', ${sql.json({ query: "from:paused -filter:replies" })}, 'T2', 'editorial', true)`;
  config.xFetchPaused = true;
});

after(async () => {
  config.xFetchPaused = original;
  await sql`DELETE FROM sources WHERE id = ${ID}`;
  await closeDb();
});

test("paused X sources are skipped without a fetch", async () => {
  const one = await collectSource(ID, { force: true });
  assert.equal(one.status, "skipped");
  assert.match(one.error ?? "", /x fetch paused/);

  const shard = await collectXShard(`test-pause-${T}`, [ID]);
  assert.equal(shard.status, "skipped");
  assert.equal(shard.accounts, 0);
  assert.match(shard.error ?? "", /x fetch paused/);
});
