// 发布闭环的关键词匹配和 7 天粉丝增量：不依赖账号系统，只用手上的帖子和快照。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { growthWithin, matchTopics, tokensOf } from "../backend/desk.ts";

after(closeDb);

test("关键词：英文词和中文二元组都能取到", () => {
  const tokens = tokensOf("OpenAI 发布新模型，推理速度翻倍");
  assert.ok(tokens.has("openai"));
  assert.ok(tokens.has("发布"));
  assert.ok(tokens.has("速度"));
});

test("话题匹配：重合够 2 分才算，最多两个", () => {
  const topics = [
    { title: "OpenAI 发布新模型", url: "/story/1" },
    { title: "某公司融资", url: "/story/2" },
    { title: "新的开源模型", url: "/story/3" },
  ];
  const matched = matchTopics("OpenAI 今天发布新模型，速度很快，开源模型也能打", topics);
  assert.ok(matched.length >= 1 && matched.length <= 2);
  assert.equal(matched[0]?.url, "/story/1");
  assert.ok(matched.every((topic) => topic.score >= 2));
});

test("7 天增量：发布日之后第一个快照到第 7 天最后一个快照", () => {
  const points = [
    { on: "2026-10-30", followers: 900 },
    { on: "2026-11-02", followers: 1000 },
    { on: "2026-11-05", followers: 1100 },
    { on: "2026-11-07", followers: 1200 },
    { on: "2026-11-10", followers: 1400 },
  ];
  const result = growthWithin(points, "2026-11-01", 7);
  assert.deepEqual(result, { growth: 200, pct: 20, base: 1000 });

  // 发布日之后没有快照：算不出。
  assert.equal(growthWithin([{ on: "2026-10-30", followers: 900 }], "2026-11-01", 7), null);
  // 只有发布当天一个快照：还不到 7 天，没有第二个点。
  assert.equal(growthWithin([{ on: "2026-11-02", followers: 1000 }], "2026-11-01", 7), null);
});
