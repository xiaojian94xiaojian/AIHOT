// 热点 poke 的挑选规则：冷却时间内跳过，总源数有上限。
import assert from "node:assert/strict";
import { test } from "node:test";
import { planPokes, type PokeCandidate } from "../packages/backend/src/sources/poke.ts";

const now = new Date("2026-11-19T12:00:00Z");

test("冷却中的源跳过，其余按上限挑出", () => {
  const candidates: PokeCandidate[] = [
    { storyId: 1, title: "事件一", signals: 5, sources: ["a", "b"] },
    { storyId: 2, title: "事件二", signals: 4, sources: ["c"] },
  ];
  const cooldowns = new Map([["b", new Date(now.getTime() - 10 * 60_000).toISOString()]]);
  const plan = planPokes(candidates, cooldowns, now, 30, 20);
  assert.deepEqual(plan.map((item) => [item.storyId, item.due, item.cooling]), [
    [1, ["a"], ["b"]],
    [2, ["c"], []],
  ]);
});

test("总源数上限优先给排在前面的热点，后面的源不再抓", () => {
  const candidates: PokeCandidate[] = [
    { storyId: 1, title: "事件一", signals: 9, sources: ["a", "b", "c"] },
    { storyId: 2, title: "事件二", signals: 3, sources: ["d"] },
  ];
  const plan = planPokes(candidates, new Map(), now, 30, 2);
  assert.deepEqual(plan[0]?.due, ["a", "b"]);
  assert.deepEqual(plan[1]?.due, []);
});

test("冷却时间过了就可以再抓", () => {
  const cooldowns = new Map([["a", new Date(now.getTime() - 31 * 60_000).toISOString()]]);
  const plan = planPokes([{ storyId: 1, title: "事件", signals: 3, sources: ["a"] }], cooldowns, now, 30, 20);
  assert.deepEqual(plan[0]?.due, ["a"]);
  assert.deepEqual(plan[0]?.cooling, []);
});
