// 算法视角：拿官方权重回测三个说法；判断规则是纯函数，数字由 SQL 现算。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { decayVerdict, discussVerdict, linkVerdict } from "../backend/algorithm.ts";

after(closeDb);

const rows = (ratios: number[]) => ratios.map((ratio, index) => ({ position: index + 1, posts: 100, ratio }));

test("同日连发：后几条掉 10% 以上才算成立", () => {
  assert.equal(decayVerdict(rows([1.0, 0.7, 0.6, 0.5])).verdict, "成立");
  assert.equal(decayVerdict(rows([1.03, 1.0, 1.0, 0.99])).verdict, "不成立");
  assert.match(decayVerdict(rows([1.03, 1.0, 1.0, 0.99])).summary, /96%/);
});

test("外链限流：外链帖比不带链接的低 10% 以上才算成立", () => {
  assert.equal(linkVerdict([{ hasLink: true, ratio: 0.7 }, { hasLink: false, ratio: 1.0 }]).verdict, "成立");
  assert.equal(linkVerdict([{ hasLink: true, ratio: 1.0 }, { hasLink: false, ratio: 1.0 }]).verdict, "不成立");
});

test("讨论率与涨粉：相关很弱时写「看不清」，样本不够也不下结论", () => {
  const weak = discussVerdict({ accounts: 91, corr: 0.08, high: { accounts: 22, median: 3.22 }, low: { accounts: 69, median: 2.25 } });
  assert.equal(weak.verdict, "看不清");
  assert.match(weak.summary, /3.22%/);
  assert.equal(discussVerdict({ accounts: 10, corr: 0.5, high: { accounts: 5, median: 1 }, low: { accounts: 5, median: 1 } }).verdict, "看不清");
});
