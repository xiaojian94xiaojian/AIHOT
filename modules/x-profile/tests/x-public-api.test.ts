// 版本化接口的行为：涨粉榜只暴露稳定字段、按窗口折算；Agent Markdown 带上口径和相关性声明。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { growthMarkdown, growthV1, methodologyMarkdown } from "../backend/public.ts";
import type { XGrowthV1, XMethodologyV1 } from "../types.ts";

after(closeDb);

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

async function snapshot(handle: string, at: Date, followers: number) {
  await sql`
    INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, followers, captured_at, receipt_id)
    VALUES (${handle.toLowerCase()}, ${beijingDate(at)}, ${handle}, ${followers}, ${at}, 0)
    ON CONFLICT (handle, captured_on) DO UPDATE SET followers = EXCLUDED.followers, captured_at = EXCLUDED.captured_at`;
}

const freshness = {
  status: "normal" as const,
  label: "正常",
  latest: "2026-11-16",
  since: "2026-10-03",
  spanDays: 44,
  snapshots: 45,
  note: "快照从 2026-10-03 起，覆盖 45 天。",
};

function boardFixture(): XGrowthV1 {
  return {
    window: 7,
    asOf: "2026-11-16",
    generatedAt: "2026-11-16T10:00:00Z",
    freshness,
    accounts: [
      { handle: "slow", name: "Slow", region: "zh", followers: 1000, growth: 10, growthPct: 1, spanDays: 7, fromOn: "2026-11-09", toOn: "2026-11-16", posts: 5, views: 1000, perPost: 2, perK: 10 },
      { handle: "fast", name: "Fast", region: "en", followers: 5000, growth: 400, growthPct: 8.7, spanDays: 7, fromOn: "2026-11-09", toOn: "2026-11-16", posts: 9, views: 90000, perPost: 44, perK: 4.4 },
    ],
  };
}

test("Agent 涨粉榜按涨粉排序，带口径与窗口", () => {
  const text = growthMarkdown(boardFixture(), 2);
  assert.ok(text.startsWith("# X 涨粉榜（7 天）"));
  assert.ok(text.includes("快照覆盖 44 天"));
  assert.ok(text.includes("不是 X 官方数据"));
  assert.ok(text.indexOf("@fast") < text.indexOf("@slow"), "涨粉多的排前面");
  assert.ok(text.includes("| 1 | @fast（Fast） | 5,000 | +400 | +8.7% | 9 | 90,000 |"));
});

test("Agent 方法论只写相关性，不承诺因果", () => {
  const page: XMethodologyV1 = {
    asOf: "2026-11-16",
    windowDays: 120,
    totals: { accounts: 589, posts: 60249, hits: 6299, hitRate: 10.5, matureDays: 3 },
    overall: { top: { posts: 6299, mediaPct: 50.2, replyPct: 0, avgLength: 292, medViews: 3524 }, rest: { posts: 53950, mediaPct: 48.5, replyPct: 0, avgLength: 254, medViews: 461 } },
    formats: [
      { key: "media", posts: 28942, hits: 3134, hitRate: 10.8, medViews: 520 },
      { key: "text", posts: 31307, hits: 3134, hitRate: 10.1, medViews: 483 },
    ],
    lengths: [{ key: "140-280", posts: 12000, hitRate: 11.2, medViews: 600 }],
    hours: [
      { hour: 9, posts: 800, hitRate: 12, medViews: 700 },
      { hour: 18, posts: 80, hitRate: 20, medViews: 900 },
    ],
    weekdays: [{ weekday: 1, posts: 7591, hitRate: 22 }],
    languages: [{ key: "zh", posts: 33927, hitRate: 10.5 }],
    categories: [{ key: "ai-products", posts: 2202, hitRate: 10.6 }],
    regions: [{ key: "zh", posts: 33927, hitRate: 10.5, mediaPct: 49 }],
    examples: [{ handle: "minchoi", author: "Min Choi", url: "https://x.com/minchoi/status/1", views: 7406246, likes: 533, ratio: 1005.4, at: "2026-11-10T00:00:00Z" }],
  };
  const text = methodologyMarkdown(page);
  assert.ok(text.includes("589 个账号"));
  assert.ok(text.includes("不能证明「这样做就会火」"));
  assert.ok(!text.includes("保证有效") || text.includes("不要说「保证有效」"));
  // 只按样本量够的时段挑；120 篇的 18 点不该出现。
  assert.ok(text.includes("09:00"));
  assert.ok(!text.includes("18:00"));
});

test("涨粉榜 v1 去掉页面字段，并按窗口折算", async () => {
  const a = "v1_api_alice";
  const b = "v1_api_bob";
  await snapshot(a, daysAgo(14), 1000);
  await snapshot(a, daysAgo(0), 1200);
  await snapshot(b, daysAgo(14), 5000);
  await snapshot(b, daysAgo(0), 5100);

  const board = await growthV1(7);
  const alice = board.accounts.find((row) => row.handle === a);
  const bob = board.accounts.find((row) => row.handle === b);
  assert.ok(alice && bob);
  assert.equal(alice.followers, 1200);
  assert.equal(bob.followers, 5100);
  // 两次快照隔 14 天、窗口 7 天：涨粉按 14/7 折算，不直接把 14 天的差值当 7 天。
  assert.equal(alice.growth, 100);
  assert.equal(alice.spanDays, 14);
  assert.ok(!("avatarUrl" in alice) && !("rank" in alice) && !("signal" in alice), "v1 不带页面专用的头像、名次、归因标记");
  assert.equal(board.window, 7);
  assert.ok(board.freshness.spanDays >= 14);

  await sql`DELETE FROM x_follower_snapshots WHERE handle IN (${a}, ${b})`;
});
