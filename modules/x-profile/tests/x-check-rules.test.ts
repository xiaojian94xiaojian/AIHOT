// 发布前检查的硬规则：字数和 X 计长、话题数、夸张词。
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkText, xLength } from "../web/check-rules.ts";

test("X 计长：中文按 2、链接按 23、英文按 1", () => {
  assert.equal(xLength("abc"), 3);
  assert.equal(xLength("你好"), 4);
  assert.equal(xLength("看 https://example.com/a"), 2 + 1 + 23);
});

test("检查：空稿、超长、话题太多、夸张词都会标出来", () => {
  const empty = checkText("  ");
  assert.equal(empty.empty, true);
  assert.equal(empty.ok, false);

  const long = checkText("长".repeat(150));
  assert.equal(long.length, 300);
  assert.equal(long.ok, false);

  const tags = checkText("正常一句话 #a #b #c");
  assert.equal(tags.hashtags, 3);
  assert.equal(tags.ok, false);

  const banned = checkText("这条必火，保证涨粉");
  assert.deepEqual(banned.banned, ["必火", "保证涨粉"]);
  assert.equal(banned.ok, false);

  const good = checkText("一个正常观点，引用 https://example.com/source #AI");
  assert.equal(good.ok, true);
  assert.equal(good.links, 1);
});
