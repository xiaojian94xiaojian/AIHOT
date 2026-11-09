// 涨粉周报订阅源：按北京时间的自然周切分每日快照，只算过完的周，缺基线就跳过。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { escapeXml, growthDigest, weekStartOf, weeksFrom } from "../backend/digest.ts";

after(closeDb);

test("a week starts on Monday, Beijing time", () => {
  assert.equal(weekStartOf("2026-11-05"), "2026-11-02", "Thursday belongs to the Monday before it");
  assert.equal(weekStartOf("2026-11-02"), "2026-11-02", "Monday is its own start");
  assert.equal(weekStartOf("2026-11-01"), "2026-10-26", "Sunday belongs to the week that began six days earlier");
});

test("weeks are follower counts at each Sunday, minus the Sunday before", () => {
  const points = [
    { day: "2026-10-18", followers: 880 },
    { day: "2026-10-25", followers: 950 },
    { day: "2026-10-26", followers: 960 },
    { day: "2026-11-01", followers: 1000 },
    { day: "2026-11-02", followers: 1010 },
  ];
  const weeks = weeksFrom(points, "2026-11-05");
  assert.deepEqual(weeks, [
    { start: "2026-10-19", end: "2026-10-25", followers: 950, baselineOn: "2026-10-18", growth: 70 },
    { start: "2026-10-26", end: "2026-11-01", followers: 1000, baselineOn: "2026-10-25", growth: 50 },
  ], "the running week is not reported; each item counts from the Sunday before its Monday");
  assert.deepEqual(weeksFrom(points, "2026-11-05", 1), weeks.slice(1), "only the weeks asked for, still in order");
  assert.deepEqual(weeksFrom([{ day: "2026-10-28", followers: 900 }], "2026-11-05"), [], "a week with no baseline is not invented");
});

test("a week with no snapshot inside is skipped, not reported as +0", () => {
  const points = [
    { day: "2026-09-20", followers: 500 },
    { day: "2026-11-01", followers: 900 },
  ];
  const weeks = weeksFrom(points, "2026-11-05");
  assert.equal(weeks.length, 1, "only the week that actually has a snapshot");
  assert.equal(weeks[0].start, "2026-10-26");
  assert.equal(weeks[0].baselineOn, "2026-09-20", "基线是哪天就写哪天，不假装是上周");
  assert.equal(weeks[0].growth, 400);
});
test("a snapshot on Monday alone still counts as a sampled week", () => {
  const mondayOnly = [
    { day: "2026-10-18", followers: 800 },
    { day: "2026-10-19", followers: 810 },
  ];
  const weeks = weeksFrom(mondayOnly, "2026-11-05");
  assert.equal(weeks.length, 1, "周一那条快照让 10-19 那周成立（>= start，不是 > start）");
  assert.deepEqual(weeks[0], { start: "2026-10-19", end: "2026-10-25", followers: 810, baselineOn: "2026-10-18", growth: 10 });

  const fullWeek = [
    { day: "2026-10-18", followers: 800 },
    { day: "2026-10-19", followers: 810 },
    { day: "2026-10-25", followers: 900 },
  ];
  const week = weeksFrom(fullWeek, "2026-11-05")[0];
  assert.equal(week.followers, 900);
  assert.equal(week.growth, 100);
});
test("the feed is RSS with one item per finished week, and escapes what readers show", async () => {
  const handle = `feed_digest_${Date.now().toString(36)}`;
  for (const [day, followers] of [["2026-10-25", 950], ["2026-11-01", 1000]] as const) {
    await sql`INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, followers, captured_at, receipt_id)
      VALUES (${handle}, ${day}, ${`Feed&<Digest>`}, ${followers}, ${`${day}T12:00:00+08:00`}, 0)`;
  }
  const xml = await growthDigest(handle, "2026-11-05");
  assert.ok(xml, "a handle with snapshots gets a feed");
  assert.match(xml!, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml!, /<rss version="2\.0"/);
  assert.equal((xml!.match(/<item>/g) ?? []).length, 1, "one finished week, one item");
  assert.match(xml!, /\+50 粉/, "the growth is in the item title");
  assert.match(xml!, /Feed&amp;&lt;Digest&gt;/, "the screen name is escaped");
  assert.equal(await growthDigest(`no_such_${handle}`, "2026-11-05"), null, "no snapshots, no feed");
  await sql`DELETE FROM x_follower_snapshots WHERE handle = ${handle}`;
});

test("escapeXml covers the five characters XML cares about", () => {
  assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;");
});
