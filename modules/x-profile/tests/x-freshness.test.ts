// 数据新鲜度：四种状态各自的边界。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { beijingDateOf, freshnessOf } from "../backend/freshness.ts";

after(closeDb);

const now = new Date("2026-11-07T12:00:00+08:00");

test("没有任何快照：empty，不要说成 0", () => {
  const f = freshnessOf({ latest: null, snapshots: 0, now });
  assert.equal(f.status, "empty");
  assert.equal(f.latest, null);
});

test("快照少于 5 次：insufficient", () => {
  const f = freshnessOf({ latest: "2026-11-07", since: "2026-11-04", snapshots: 4, now });
  assert.equal(f.status, "insufficient");
  assert.match(f.note, /4 天/);
});

test("最近一次超过 2 天：delayed，并写明几天前", () => {
  const f = freshnessOf({ latest: "2026-11-04", since: "2026-10-01", snapshots: 20, now });
  assert.equal(f.status, "delayed");
  assert.match(f.note, /3 天前/);
});

test("正常：给出覆盖天数和今天是哪次", () => {
  const f = freshnessOf({ latest: "2026-11-07", since: "2026-10-03", snapshots: 34, now });
  assert.equal(f.status, "normal");
  assert.equal(f.spanDays, 35);
  assert.match(f.note, /今天/);
  assert.equal(f.snapshots, 34);
});

test("北京时间换算不受机器时区影响", () => {
  // 2026-11-07T16:30Z 已经是北京时间 11-08 00:30。
  assert.equal(beijingDateOf(new Date("2026-11-07T16:30:00Z")), "2026-11-08");
});
