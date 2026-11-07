// 预测指标：X 热门帖子池的 8 小时半衰模型，用采集那一刻的数反推。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { ageHours, breakoutRatio, projected24hViews, replyOpportunity, velocityPerHour, weightedEngagement } from "../backend/insight.ts";

after(closeDb);

test("年龄按发布到采集算；未来时间返回 null", () => {
  assert.equal(ageHours("2026-11-07T10:00:00Z", "2026-11-07T12:00:00Z"), 2);
  assert.equal(ageHours("2026-11-07T12:00:00Z", "2026-11-07T10:00:00Z"), null);
  assert.equal(ageHours("bad", "2026-11-07T10:00:00Z"), null);
});

test("预计 24 小时浏览：越新外推越多，超过 24 小时就返回实际值", () => {
  const early = projected24hViews(100, 1);
  const later = projected24hViews(100, 10);
  assert.ok(early !== null && later !== null);
  assert.ok(early > later, "同样 100 浏览，1 小时前的帖子后劲更大");
  assert.equal(projected24hViews(5000, 30), 5000, "超过 24 小时不再外推");
  assert.equal(projected24hViews(null, 1), null);
});

test("流速：48 小时以上不显示，新帖更快", () => {
  const young = velocityPerHour(100, 1);
  const old = velocityPerHour(100, 20);
  assert.ok(young !== null && old !== null);
  assert.ok(young > old);
  assert.equal(velocityPerHour(100, 60), null);
});

test("破圈系数按粉丝数算，小号有下限", () => {
  assert.equal(breakoutRatio(10_000, 2_000), 5);
  assert.equal(breakoutRatio(1_000, 100), 2, "粉丝太小时按 500 算，避免虚高");
  assert.equal(breakoutRatio(1_000, null), null);
});

test("加权互动率把回复和引用算得更重", () => {
  const onlyLikes = weightedEngagement({ views: 1000, likes: 10 });
  const someReplies = weightedEngagement({ views: 1000, replies: 2 });
  assert.ok(onlyLikes !== null && someReplies !== null);
  assert.ok(someReplies > onlyLikes, "两条回复比十个赞更值钱");
});

test("回复机会：超过窗口就没有；回复越多分越低", () => {
  const fresh = replyOpportunity({ views: 500, age: 1, replies: 2 });
  const crowded = replyOpportunity({ views: 500, age: 1, replies: 40 });
  assert.ok(fresh && crowded);
  assert.ok(fresh.score > crowded.score);
  assert.ok(fresh.remainingViews > 0);
  assert.equal(replyOpportunity({ views: 500, age: 13, replies: 2 }), null);
});
