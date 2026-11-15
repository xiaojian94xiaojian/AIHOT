// 今天发什么：写法建议只按「X 上已经聊到什么程度」和回复密度给，不预测流量。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { adviceOf, commentReason, isEarlyStart } from "../backend/today.ts";

after(closeDb);

test("聊开了且回复密度高，建议直接抛判断", () => {
  const advice = adviceOf({ posts: 60, repliesPerK: 3, hoursSinceLatest: 2 });
  assert.match(advice.angle, /抛你的判断/);
  assert.match(advice.why, /60 条/);
});

test("聊开了但回复密度低，建议配实测或反直觉结论", () => {
  assert.match(adviceOf({ posts: 60, repliesPerK: 0.5, hoursSinceLatest: 2 }).angle, /实测|反直觉/);
});

test("刚起量（20–49 条）建议做对比或实测", () => {
  assert.match(adviceOf({ posts: 25, repliesPerK: 1, hoursSinceLatest: 3 }).angle, /对比|清单|实测/);
});

test("讨论很少但还新鲜是首发窗口，放久了提醒加结论", () => {
  assert.match(adviceOf({ posts: 5, repliesPerK: 0, hoursSinceLatest: 3 }).angle, /首发窗口/);
  assert.match(adviceOf({ posts: 5, repliesPerK: 0, hoursSinceLatest: 30 }).angle, /热度在退/);
});

test("可评帖的理由说清「多久前、多少浏览、多少回复」", () => {
  assert.match(commentReason({ minutesAgo: 150, views: 1200, replies: 3 }), /2\.5 小时前发的，刚起步/);
  assert.match(commentReason({ minutesAgo: 480, views: 320, replies: 12 }), /还没过 50/);
});

test("冷启动：小号、刚发、浏览少才提示，三条缺一条就不算", () => {
  assert.equal(isEarlyStart({ followers: 12_000, minutesAgo: 40, views: 120 }), true);
  assert.equal(isEarlyStart({ followers: 50_000, minutesAgo: 120, views: 199 }), true, "边界值算在内");
  assert.equal(isEarlyStart({ followers: 50_001, minutesAgo: 40, views: 120 }), false, "粉丝过线不算");
  assert.equal(isEarlyStart({ followers: 12_000, minutesAgo: 121, views: 120 }), false, "发出超过两小时不算");
  assert.equal(isEarlyStart({ followers: 12_000, minutesAgo: 40, views: 200 }), false, "浏览到 200 不算");
  assert.equal(isEarlyStart({ followers: null, minutesAgo: 40, views: 10 }), false, "没有粉丝快照时不下结论");
});