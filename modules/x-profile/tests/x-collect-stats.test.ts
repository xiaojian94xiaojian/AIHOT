// 采集成本看板：按北京时间切天，从回执里数调用、空抓、对象和花费。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { collectStatsFor, emptyRate, snapshotCollectStats } from "../backend/collect-stats.ts";

after(async () => {
  await sql`DELETE FROM receipts WHERE logical_key LIKE 'stats-test-%'`;
  await sql`DELETE FROM x_collect_stats WHERE day = DATE '2026-01-15'`;
  await closeDb();
});

test("一天的空抓、对象和花费按回执算，空抓率按比例", async () => {
  await sql`
    INSERT INTO receipts (logical_key, service, purpose, status, response, cost, created_at)
    VALUES
      ('stats-test-1', 'socialdata', 'test', 'completed', '{"tweets":[]}'::jsonb, 0, '2026-01-15T02:00:00+08:00'),
      ('stats-test-2', 'socialdata', 'test', 'completed', '{"tweets":[{"id_str":"1"},{"id_str":"2"}]}'::jsonb, 0.002, '2026-01-15T10:00:00+08:00'),
      ('stats-test-3', 'socialdata', 'test', 'completed', '{"tweets":[]}'::jsonb, 0, '2026-01-15T23:30:00+08:00'),
      -- 前一天与后一天都不该算进来（按北京时间切天）
      ('stats-test-4', 'socialdata', 'test', 'completed', '{"tweets":[{"id_str":"3"}]}'::jsonb, 0.001, '2026-01-15T00:30:00+08:00')`;
  const stat = await collectStatsFor("2026-01-15");
  assert.equal(stat.calls, 4, "北京时间 1 月 15 日零点后的都算这一天");
  assert.equal(stat.emptyCalls, 2);
  assert.equal(stat.objects, 3);
  assert.equal(stat.usd, 0.003);
  assert.equal(emptyRate(stat), 50);

  const saved = await snapshotCollectStats("2026-01-15");
  assert.equal(saved.live, false);
  const [row] = await sql<{ calls: number; objects: number }[]>`SELECT calls, objects FROM x_collect_stats WHERE day = DATE '2026-01-15'`;
  assert.equal(row?.calls, 4);
  assert.equal(row?.objects, 3);
});

test("没有调用的一天是 0，不是 NaN", async () => {
  const stat = await collectStatsFor("2020-01-01");
  assert.equal(stat.calls, 0);
  assert.equal(emptyRate(stat), 0);
});
