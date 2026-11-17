// 涨粉异常日：按账号自己的每日净增找尖峰，样本太少时不硬找。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { growthAnomalies } from "../backend/followers.ts";
import type { XPersonGrowth } from "../types.ts";

after(closeDb);

const day = (n: number, delta: number | null): XPersonGrowth["daily"][number] => ({
  on: `2026-11-${String(n).padStart(2, "0")}`,
  followers: 1000 + n,
  delta,
});

test("日常 5 人、尖峰 30 人：只标尖峰", () => {
  const anomalies = growthAnomalies([day(1, null), day(2, 4), day(3, 6), day(4, 5), day(5, 30)]);
  assert.equal(anomalies.length, 1);
  assert.deepEqual(anomalies[0], { on: "2026-11-05", delta: 30, kind: "up" });
});

test("掉粉尖峰也会标出来，按幅度排序", () => {
  const anomalies = growthAnomalies([day(1, null), day(2, 5), day(3, 5), day(4, 4), day(5, 5), day(6, 6), day(7, 5), day(8, -60), day(9, 80)]);
  assert.deepEqual(anomalies.map((row) => [row.delta, row.kind]), [
    [80, "up"],
    [-60, "down"],
  ]);
});

test("小号日常 1 人、尖峰 15 人：低于 20 的底线，不算异常", () => {
  assert.deepEqual(growthAnomalies([day(1, null), day(2, 1), day(3, 1), day(4, 15)]), []);
});

test("变化日少于 3 个时返回空，最多 5 天", () => {
  assert.deepEqual(growthAnomalies([day(1, null), day(2, 50)]), []);
  const many = growthAnomalies([day(1, null), day(2, 5), day(3, 5), day(4, 5), day(5, 100), day(6, -90), day(7, 80), day(8, -70), day(9, 60), day(10, 5), day(11, 5), day(12, 5)]);
  assert.equal(many.length, 5);
});
