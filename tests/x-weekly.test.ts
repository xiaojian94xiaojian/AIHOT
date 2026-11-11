// 公开周报的算法口径：某周涨粉 = 这周内最后一次快照 − 上周日（或更早最近一次）的快照；
// 缺基线或这周没采到快照的账号不进榜，不拿相邻周凑数。RSS 每周一条，指向那一周的页面。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { addDays } from "@aihot/contracts/time";
import { loadWeekly, recentWeeks, weeklyFeed } from "@aihot/x-profile/backend/weekly";

const T = tag();
const weeks = recentWeeks();
const week = weeks[0]!;
const baseline = addDays(week, -1);
const mid = addDays(week, 6);
const handles = { big: `weekly-${T}-big`, second: `weekly-${T}-second`, noBase: `weekly-${T}-nobase`, noWeek: `weekly-${T}-noweek`, stale: `weekly-${T}-stale` };

async function snapshot(handle: string, on: string, followers: number, receipt: number) {
  await sql`
    INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, name, followers, captured_at, receipt_id)
    VALUES (${handle}, ${on}::date, ${handle}, ${handle}, ${followers}, ${on}::timestamptz + interval '9 hours', ${receipt})`;
}

after(async () => {
  await sql`DELETE FROM x_follower_snapshots WHERE handle LIKE ${`weekly-${T}-%`}`;
  await sql`DELETE FROM receipts WHERE logical_key = ${`weekly-${T}`}`;
  await closeDb();
});

test("a week ranks by snapshot difference and skips accounts without both ends", async () => {
  const [receipt] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, purpose, status) VALUES (${`weekly-${T}`}, ${"test"}, ${"weekly"}, ${"completed"}) RETURNING id`;
  const id = receipt!.id;
  await snapshot(handles.big, baseline, 1_000, id);
  await snapshot(handles.big, mid, 6_000, id);
  await snapshot(handles.second, baseline, 3_000, id);
  await snapshot(handles.second, mid, 3_400, id);
  await snapshot(handles.noBase, mid, 9_999, id);
  await snapshot(handles.noWeek, baseline, 7_000, id);
  // 基线在 20 天前：不能把三周涨幅算进这一周，直接不上榜。
  await snapshot(handles.stale, addDays(week, -20), 5_000, id);
  await snapshot(handles.stale, mid, 9_000, id);

  const report = await loadWeekly(week);
  assert.equal(report.week.start, week);
  assert.deepEqual(report.weeks, weeks);
  const big = report.rows.find((row) => row.handle === handles.big);
  assert.ok(big, "an account with both snapshots is ranked");
  assert.equal(big.growth, 5_000, "a seven-day span is reported as-is");
  assert.equal(big.followers, 6_000);
  assert.ok(report.rows.find((row) => row.handle === handles.second)?.growth === 400);
  assert.equal(report.rows.some((row) => row.handle === handles.noBase), false, "no baseline means no rank");
  assert.equal(report.rows.some((row) => row.handle === handles.noWeek), false, "no snapshot in the week means no rank");
  assert.equal(report.rows.some((row) => row.handle === handles.stale), false, "a baseline older than 14 days means no rank");
  assert.ok(report.rows.length <= 10, "the report is a top ten");
  assert.equal((await loadWeekly("2026-02-30")).week.start, weeks[0], "an impossible date falls back to the latest week");
  assert.equal((await loadWeekly("2020-01-06")).week.start, weeks[0], "a week outside the window falls back to the latest");
});

test("the feed carries one item per week and points at that week's page", async () => {
  const xml = await weeklyFeed();
  assert.match(xml, /<title>[^<]*涨粉周报<\/title>/);
  const items = xml.match(/<item>/g) ?? [];
  assert.equal(items.length, weeks.length, "one entry for each week kept");
  for (const start of weeks) assert.ok(xml.includes(`?week=${start}`), `item links to the ${start} week`);
});
