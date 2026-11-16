// 曝光自查的判定逻辑：样本不足、正常、轻度、内容型低曝光、账号型走低。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { reachVerdict } from "../backend/reach.ts";

after(closeDb);

test("近 14 天没有原创帖时给 quiet，不硬判", () => {
  const verdict = reachVerdict({ recentPosts: 0, basePosts: 30, recentMed: null, baseMed: 500, d30: 10 });
  assert.equal(verdict.status, "quiet");
  assert.equal(verdict.label, "近 14 天没发原创");
});

test("样本太少时给 insufficient，并说清有多少条", () => {
  const verdict = reachVerdict({ recentPosts: 2, basePosts: 30, recentMed: 100, baseMed: 500, d30: 10 });
  assert.equal(verdict.status, "insufficient");
  assert.match(verdict.conclusion, /2 条/);
  assert.equal(verdict.confidence, "low");
});

test("接近基线算正常，0.5–0.8 算轻度波动", () => {
  assert.equal(reachVerdict({ recentPosts: 10, basePosts: 40, recentMed: 480, baseMed: 500, d30: 20 }).status, "normal");
  const mixed = reachVerdict({ recentPosts: 10, basePosts: 40, recentMed: 350, baseMed: 500, d30: 20 });
  assert.equal(mixed.status, "mixed");
  assert.equal(mixed.ratio, 0.7);
});

test("曝光腰斩但粉丝还在涨：更像内容没进推荐池", () => {
  const verdict = reachVerdict({ recentPosts: 8, basePosts: 40, recentMed: 100, baseMed: 500, d30: 35 });
  assert.equal(verdict.status, "content");
  assert.match(verdict.conclusion, /粉丝 30 天还涨了 35/);
  assert.equal(verdict.confidence, "high");
});

test("曝光腰斩且粉丝不涨：值得核对账号状态", () => {
  const verdict = reachVerdict({ recentPosts: 8, basePosts: 40, recentMed: 100, baseMed: 500, d30: 0 });
  assert.equal(verdict.status, "check");
  assert.match(verdict.conclusion, /可能限流/);
  assert.match(verdict.conclusion, /0/);
});

test("新账号基线太少或没有一个月快照时，不硬判限流", () => {
  const fewPosts = reachVerdict({ recentPosts: 102, basePosts: 8, recentMed: 41, baseMed: 218, d30: null });
  assert.equal(fewPosts.status, "insufficient");

  const noMonth = reachVerdict({ recentPosts: 20, basePosts: 40, recentMed: 100, baseMed: 500, d30: null });
  assert.equal(noMonth.status, "insufficient");
  assert.match(noMonth.label, /快照/);
});