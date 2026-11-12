// 公开周报的算法口径：某周涨粉 = 这周内最后一次快照 − 上周日（或更早最近一次）的快照；
// 缺基线或这周没采到快照的账号不进榜，不拿相邻周凑数。RSS 每周一条，指向那一周的页面。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { newArticleId } from "@aihot/backend/lib/ids";
import { addDays } from "@aihot/contracts/time";
import { loadWeekly, recentWeeks, weeklyFeed } from "@aihot/x-profile/backend/weekly";

const T = tag();
const weeks = recentWeeks();
const week = weeks[0]!;
const baseline = addDays(week, -1);
const mid = addDays(week, 6);
const handles = { big: `weekly-${T}-big`, second: `weekly-${T}-second`, noBase: `weekly-${T}-nobase`, noWeek: `weekly-${T}-noweek`, stale: `weekly-${T}-stale`, english: `weekly-${T}-english`, mixed: `weekly-${T}-mixed`, noPosts: `weekly-${T}-noposts` };

async function snapshot(handle: string, on: string, followers: number, receipt: number) {
  await sql`
    INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, name, followers, captured_at, receipt_id)
    VALUES (${handle}, ${on}::date, ${handle}, ${handle}, ${followers}, ${on}::timestamptz + interval '9 hours', ${receipt})`;
}

/** 一条 x 帖：榜单按最近 120 天的语言占比判「中文圈」，所以每个候选账号都要有帖子。
 *  `postHandle` 模拟 SocialData 返回的原始大小写（快照键是小写）。 */
async function post(handle: string, lang: string, on: string, views: number, postHandle = handle) {
  const source = `x-account-${handle}`;
  await sql`INSERT INTO sources (id, name, kind, config) VALUES (${source}, ${handle}, 'x_search', ${sql.json({ query: `from:${handle}` })})
            ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, language, published_at, x_post, raw)
    VALUES (${newArticleId()}, ${source}, ${`${source}-${on}`}, ${`https://x.com/${handle}/status/${on.replaceAll("-", "")}`}, ${`${handle} post`},
            now(), now(), ${lang}, ${on}::timestamptz + interval '12 hours',
            ${sql.json({ handle: postHandle, text: "post", tweetId: on.replaceAll("-", "") })},
            ${sql.json({ views, favorite: Math.round(views / 10), retweet: 1 })})`;
}

after(async () => {
  await sql`DELETE FROM x_follower_snapshots WHERE handle LIKE ${`weekly-${T}-%`}`;
  await sql`DELETE FROM x_growth_reports WHERE handle LIKE ${`weekly-${T}-%`}`;
  await sql`DELETE FROM articles WHERE source_id LIKE ${`x-account-weekly-${T}-%`}`;
  await sql`DELETE FROM sources WHERE id LIKE ${`x-account-weekly-${T}-%`}`;
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
  // 英文账号：涨粉更多，但周报写的是中文圈，不能出现在榜里。
  await snapshot(handles.english, baseline, 1_000, id);
  await snapshot(handles.english, mid, 90_000, id);
  // 帖子里的 handle 保留 SocialData 的原始大小写，快照键是小写：不能因此被当成「没有语言证据」。
  await snapshot(handles.mixed, baseline, 2_000, id);
  await snapshot(handles.mixed, mid, 4_000, id);
  // 有快照、涨粉不少，但一条帖子都没采到：没有语言证据，不进中文榜。
  await snapshot(handles.noPosts, baseline, 1_000, id);
  await snapshot(handles.noPosts, mid, 8_000, id);
  await post(handles.big, "zh", mid, 1_200);
  await post(handles.second, "zh", mid, 800);
  await post(handles.english, "en", mid, 50_000);
  await post(handles.mixed, "zh", mid, 500, `Weekly-${T}-Mixed`);
  // 这一期已经生成过的账号观察，周报应原样带出来。
  await sql`INSERT INTO x_growth_reports (handle, screen_name, name, window_days, period_start, period_end, model, growth, followers, posts, views, report)
    VALUES (${handles.big}, ${handles.big}, ${handles.big}, 7, ${week}::date, ${addDays(week, 7)}::date, ${"test"}, 5000, 6000, 1, 1200,
            ${sql.json({ conclusion: "测试结论", drivers: [{ why: "因为", evidence: "依据" }], moves: ["动作"], confidence: "medium" })})`;

  const report = await loadWeekly(week);
  assert.equal(report.week.start, week);
  assert.deepEqual(report.weeks, weeks);
  const big = report.rows.find((row) => row.handle === handles.big);
  assert.ok(big, "an account with both snapshots is ranked");
  assert.equal(big.growth, 5_000, "a seven-day span is reported as-is");
  assert.equal(big.followers, 6_000);
  assert.equal(big.posts, 1, "the week's posts are counted");
  assert.ok(report.rows.find((row) => row.handle === handles.second)?.growth === 400);
  assert.ok(report.rows.find((row) => row.handle === handles.mixed), "a mixed-case post handle still matches the lowercase snapshot");
  assert.equal(report.rows.some((row) => row.handle === handles.noBase), false, "no baseline means no rank");
  assert.equal(report.rows.some((row) => row.handle === handles.noWeek), false, "no snapshot in the week means no rank");
  assert.equal(report.rows.some((row) => row.handle === handles.stale), false, "a baseline older than 14 days means no rank");
  assert.equal(report.rows.some((row) => row.handle === handles.english), false, "an English account stays out of the Chinese report");
  assert.equal(report.rows.some((row) => row.handle === handles.noPosts), false, "no posts means no language evidence");
  assert.ok(report.rows.length <= 10, "the report is a top ten");
  assert.equal(report.viral.length, 3, "the week's posts with views make the viral list");
  assert.ok(report.darkHorses.length >= 1, "small accounts get a dark-horse list");
  assert.equal(report.darkHorses[0]?.handle, handles.big, "the fastest-growing small account leads the dark horses");
  assert.equal(report.patterns.length, 1, "with only a few posts only the dark-horse observation is written");
  assert.ok(report.patterns.every((p) => !/带图|篇幅|晚上/.test(p.title)), "viral observations wait for a full sample");
  assert.equal(report.darkHorses[0]?.growthPct, 500, "the dark-horse growth is the scaled percentage");
  assert.equal(big.rankPrev, null, "no previous week means no rank change");
  assert.equal(report.rows[0]?.rank, 1, "the fastest-growing account leads");
  assert.equal(report.observations.length, 1, "this week's stored observations are served with the report");
  assert.equal(report.observations[0]?.handle, handles.big, "the observation is the one stored for this week");
  assert.equal(report.observations[0]?.periodEnd, addDays(week, 7), "the Monday run is the one that belongs to this week");
  assert.equal(report.compare.posts, report.summary.posts, "the compare block uses the same weekly totals");
  assert.equal(report.compare.prevPosts, 0, "the previous week has no fixtures");
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
