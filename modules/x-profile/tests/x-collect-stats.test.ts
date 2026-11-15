// 采集成本看板：按北京时间切天，从回执里数采集调用、空抓、对象和花费。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { beijingToday, budgetSkipsOn, collectStatsFor, emptyRate, snapshotCollectStats } from "../backend/collect-stats.ts";

after(async () => {
  await sql`DELETE FROM receipts WHERE logical_key LIKE 'stats-test-%'`;
  await sql`DELETE FROM x_collect_stats WHERE day = DATE '2026-01-15'`;
  await closeDb();
});

test("只数采集搜索：单帖/监控不计调用，花费含当天全部 SocialData 调用，覆盖按 from:handle 去重", async () => {
  await sql`
    INSERT INTO receipts (logical_key, service, purpose, status, request, response, cost, created_at)
    VALUES
      ('stats-test-1', 'socialdata', 'source_fetch', 'completed', '{"query":"from:alice -filter:replies","type":"Latest"}'::jsonb, '{"tweets":[]}'::jsonb, 0, '2026-01-15T02:00:00+08:00'),
      ('stats-test-2', 'socialdata', 'source_fetch', 'completed', '{"query":"(from:alice OR from:bob) -filter:replies","type":"Latest"}'::jsonb, '{"tweets":[{"id_str":"1"},{"id_str":"2"}]}'::jsonb, 0.002, '2026-01-15T10:00:00+08:00'),
      ('stats-test-3', 'socialdata', 'source_fetch', 'completed', '{"query":"from:carol -filter:replies","type":"Latest"}'::jsonb, '{"tweets":[]}'::jsonb, 0, '2026-01-15T23:30:00+08:00'),
      -- 失败的采集不算调用，但它照样花了钱
      ('stats-test-4', 'socialdata', 'source_fetch', 'failed', '{"query":"from:dave -filter:replies","type":"Latest"}'::jsonb, NULL, 0.001, '2026-01-15T12:00:00+08:00'),
      -- 监控探针不是采集，不混进调用和覆盖
      ('stats-test-5', 'socialdata', 'monitor.scan', 'completed', '{"query":"from:alice","type":"Latest"}'::jsonb, '{"tweets":[]}'::jsonb, 0.003, '2026-01-15T13:00:00+08:00'),
      -- pending 的采集不算调用；大小写不同的同一账号只算一个
      ('stats-test-8', 'socialdata', 'source_fetch', 'pending', '{"query":"from:alice -filter:replies"}'::jsonb, NULL, 0, '2026-01-15T14:00:00+08:00'),
      ('stats-test-9', 'socialdata', 'source_fetch', 'completed', '{"query":"FROM:ALICE -filter:replies"}'::jsonb, '{"tweets":[{"id_str":"5"}]}'::jsonb, 0, '2026-01-15T15:00:00+08:00'),
      -- 前一天与后一天都不该算进来（按北京时间切天）
      ('stats-test-6', 'socialdata', 'source_fetch', 'completed', '{"query":"from:erin -filter:replies","type":"Latest"}'::jsonb, '{"tweets":[{"id_str":"3"}]}'::jsonb, 0.01, '2026-01-14T23:30:00+08:00'),
      ('stats-test-7', 'socialdata', 'source_fetch', 'completed', '{"query":"from:frank -filter:replies","type":"Latest"}'::jsonb, '{"tweets":[{"id_str":"4"}]}'::jsonb, 0.02, '2026-01-16T00:30:00+08:00')`;
  const stat = await collectStatsFor("2026-01-15");
  assert.equal(stat.calls, 4, "四次采集搜索（分片一次；pending、失败与监控不算）");
  assert.equal(stat.emptyCalls, 2);
  assert.equal(stat.objects, 3);
  assert.equal(stat.usd, 0.006, "花费含当天失败的采集与监控探针");
  assert.equal(stat.sources, 3, "alice/bob/carol 三个账号：分片里的 from: 都算，大小写只算一个");
  assert.equal(emptyRate(stat), 50);

  const saved = await snapshotCollectStats("2026-01-15");
  assert.equal(saved.live, false);
  const [row] = await sql<{ calls: number; objects: number; sources: number }[]>`
    SELECT calls, objects, sources FROM x_collect_stats WHERE day = DATE '2026-01-15'`;
  assert.equal(row?.calls, 4);
  assert.equal(row?.objects, 3);
  assert.equal(row?.sources, 3);
});

test("没有调用的一天是 0，不是 NaN", async () => {
  const stat = await collectStatsFor("2020-01-01");
  assert.equal(stat.calls, 0);
  assert.equal(stat.sources, 0);
  assert.equal(emptyRate(stat), 0);
});

test("预算跳过次数只数当天、只数 skipped", async () => {
  const job = `stats-budget-${Date.now()}`;
  await sql`INSERT INTO job_runs (job, status, finished_at) VALUES (${job}, 'skipped', now()), (${`${job}-ok`}, 'ok', now())`;
  assert.equal(await budgetSkipsOn(beijingToday()), 1, "今天的 skipped 任务算一次，ok 的不算");
  await sql`DELETE FROM job_runs WHERE job IN (${job}, ${`${job}-ok`})`;
});