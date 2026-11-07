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
    { start: "2026-10-19", end: "2026-10-25", followers: 950, growth: 70 },
    { start: "2026-10-26", end: "2026-11-01", followers: 1000, growth: 50 },
  ], "the running week is not reported; each item counts from the Sunday before its Monday");
  assert.deepEqual(weeksFrom(points, "2026-11-05", 1), weeks.slice(1), "only the weeks asked for, still in order");
  assert.deepEqual(weeksFrom([{ day: "2026-10-28", followers: 900 }], "2026-11-05"), [], "a week with no baseline is not invented");
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
