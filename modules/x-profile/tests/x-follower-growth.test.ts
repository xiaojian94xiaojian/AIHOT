// 涨粉榜的两半：从采集回执里记快照（一个账号一天一行、取当天最后一回、可以重放），
// 以及按窗口算涨粉（基线、折算、时效与地区）。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { loadGrowth, loadPersonGrowth, scanFollowerSnapshots } from "../backend/followers.ts";

after(closeDb);

const DAY = 86_400_000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

let seq = 0;
/** 一张搜索回执：`users` 里每个账号一条推文，和 SocialData 的回答形状一致。 */
async function receipt(at: Date, users: Array<{ handle: string; followers?: number; name?: string }>) {
  seq += 1;
  const tweets = users.map((user, index) => ({
    id_str: `${1_700_000_000_000_000 + seq * 100 + index}`,
    tweet_created_at: at.toISOString(),
    lang: "en",
    user: {
      screen_name: user.handle,
      name: user.name ?? user.handle,
      ...(user.followers === undefined ? {} : { followers_count: user.followers }),
    },
  }));
  await sql`
    INSERT INTO receipts (logical_key, service, purpose, status, response, received_at)
    VALUES (${`test-x-followers-${seq}`}, 'socialdata', 'source_fetch', 'completed', ${sql.json({ tweets })}, ${at})`;
}

async function snapshots() {
  return sql<{ handle: string; captured_on: string; screen_name: string; followers: number; captured_at: Date }[]>`
    SELECT handle, to_char(captured_on, 'YYYY-MM-DD') AS captured_on, screen_name, followers::int AS followers, captured_at
    FROM x_follower_snapshots ORDER BY handle, captured_on`;
}

async function snapshot(at: Date, handle: string, followers: number, screenName = handle) {
  await sql`
    INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, followers, captured_at, receipt_id)
    VALUES (${handle.toLowerCase()}, ${beijingDate(at)}, ${screenName}, ${followers}, ${at}, 0)
    ON CONFLICT (handle, captured_on) DO UPDATE SET followers = EXCLUDED.followers, captured_at = EXCLUDED.captured_at`;
}

test("snapshots are one row per account per Beijing day, last fetch wins, and a replay changes nothing", async () => {
  const now = new Date();
  const morning = new Date(`${beijingDate(daysAgo(now, 10))}T01:00:00+08:00`);
  const evening = new Date(`${beijingDate(daysAgo(now, 10))}T22:00:00+08:00`);
  const recent = new Date(`${beijingDate(daysAgo(now, 3))}T12:00:00+08:00`);

  await receipt(morning, [{ handle: "Alice", followers: 1000, name: "Alice A" }]);
  await receipt(evening, [{ handle: "alice", followers: 1100 }, { handle: "bob", followers: 500 }]);
  await receipt(recent, [{ handle: "alice", followers: 1300 }, { handle: "carol" }]); // carol: no follower count

  const first = await scanFollowerSnapshots();
  assert.ok(first.receipts >= 3);
  const rows = await snapshots();
  assert.deepEqual(rows.map((row) => [row.handle, row.captured_on, row.followers]), [
    ["alice", beijingDate(morning), 1100],
    ["alice", beijingDate(recent), 1300],
    ["bob", beijingDate(evening), 500],
  ]);
  // 同一天取最后抓到的那次；大小写按最新一次的写法显示，键始终是小写。
  assert.equal(rows[0]!.screen_name, "alice");

  // 重放同一批回执不会多出行，也不会把当天更早的数字写回来。
  await scanFollowerSnapshots();
  assert.equal((await snapshots()).length, 3);

  // 新回执接在游标后面。
  await receipt(new Date(`${beijingDate(daysAgo(now, 1))}T09:00:00+08:00`), [{ handle: "alice", followers: 1400 }]);
  await scanFollowerSnapshots();
  const latest = (await snapshots()).filter((row) => row.handle === "alice").at(-1)!;
  assert.equal(Number(latest.followers), 1400);
  assert.equal(latest.captured_on, beijingDate(daysAgo(now, 1)));
});

test("growth compares the window's baseline, normalizes a longer gap, and skips stale or baseline-less accounts", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  // 正好 7 天：不折算。
  await snapshot(daysAgo(now, 8), "alice", 1000);
  await snapshot(daysAgo(now, 1), "alice", 1300, "Alice");
  // 基线在 10 天前：折算成 7 天（700 × 7 / 10），换算不改变涨粉率的算法。
  await snapshot(daysAgo(now, 11), "bob", 200);
  await snapshot(daysAgo(now, 1), "bob", 900, "Bob");
  // 只有一次快照：没有基线。
  await snapshot(daysAgo(now, 2), "carol", 100);
  // 最近一次在窗口之外：7 天榜里不算，30 天榜里也不够 30 天。
  await snapshot(daysAgo(now, 20), "dave", 400);
  await snapshot(daysAgo(now, 12), "dave", 450);
  // 30 天窗口够得着的基线（差 37 天，正好在“窗口 + 7 天”的容忍范围内）。
  await snapshot(daysAgo(now, 38), "erin", 10_000);
  await snapshot(daysAgo(now, 1), "erin", 11_000);

  const week = await loadGrowth(7, now);
  assert.deepEqual(week.rows.map((row) => row.handle).sort(), ["alice", "bob"]);
  const alice = week.rows.find((row) => row.handle === "alice")!;
  assert.equal(alice.growth, 300);
  assert.equal(alice.growthPct, 30);
  assert.equal(alice.spanDays, 7);
  assert.equal(alice.screenName, "Alice");
  const bob = week.rows.find((row) => row.handle === "bob")!;
  assert.equal(bob.spanDays, 10);
  assert.equal(bob.growth, 490, "700 gained over 10 days normalizes to 490 over 7");
  assert.equal(bob.growthPct, 245);

  const month = await loadGrowth(30, now);
  assert.deepEqual(month.rows.map((row) => row.handle).sort(), ["erin"]);
  const erin = month.rows.find((row) => row.handle === "erin")!;
  assert.equal(erin.spanDays, 37);
  assert.equal(erin.growth, Math.round((1000 * 30) / 37));
  assert.equal(week.coverage.accounts, 5);
  assert.equal(week.coverage.eligible, 2);
});

test("the leaderboard reuses the profile pages' region, read from the accounts' posts", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-alice', '@Alice', 'x_search', ${sql.json({ query: "from:Alice -filter:replies" })}),
      ('x-account-bob', '@Bob', 'x_search', ${sql.json({ query: "from:Bob -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  const post = (id: string, sourceId: string, language: string, publishedAt: Date) => sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, x_post)
    VALUES (${id}, ${sourceId}, ${`test:${id}`}, ${`https://x.com/${id}`}, ${id}, ${language}, ${publishedAt}, ${publishedAt}, ${publishedAt},
            ${sql.json({ handle: id, lang: language })})`;
  // alice：中文；bob：英文。
  await post("a1", "x-account-alice", "zh", daysAgo(now, 2));
  await post("a2", "x-account-alice", "zh", daysAgo(now, 5));
  await post("b1", "x-account-bob", "en", daysAgo(now, 2));
  await snapshot(daysAgo(now, 8), "alice", 1000);
  await snapshot(daysAgo(now, 1), "alice", 1100);
  await snapshot(daysAgo(now, 8), "bob", 2000);
  await snapshot(daysAgo(now, 1), "bob", 2100);

  const week = await loadGrowth(7, now);
  assert.equal(week.rows.find((row) => row.handle === "alice")!.region, "zh");
  assert.equal(week.rows.find((row) => row.handle === "bob")!.region, "en");
});

test("ranks are the whole board's, and the change compares with the same window a week earlier", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  // 上周：alice 涨 500、bob 涨 200（alice 第 1）；本周：alice 涨 100、bob 涨 800（bob 第 1）。两人对调。
  await snapshot(daysAgo(now, 15), "alice", 1000);
  await snapshot(daysAgo(now, 8), "alice", 1500);
  await snapshot(daysAgo(now, 1), "alice", 1600);
  await snapshot(daysAgo(now, 15), "bob", 1000);
  await snapshot(daysAgo(now, 8), "bob", 1200);
  await snapshot(daysAgo(now, 1), "bob", 2000);
  // carol 只有一次快照：上不了榜，也就没有上周名次。
  await snapshot(daysAgo(now, 1), "carol", 5000);

  const week = await loadGrowth(7, now);
  const alice = week.rows.find((row) => row.handle === "alice")!;
  const bob = week.rows.find((row) => row.handle === "bob")!;
  assert.equal(alice.rank, 2);
  assert.equal(alice.rankPrev, 1, "alice led last week");
  assert.equal(bob.rank, 1);
  assert.equal(bob.rankPrev, 2, "bob was second last week");
  assert.equal(alice.rankPct, 2);
  assert.equal(week.rows.some((row) => row.handle === "carol"), false);

  // 上周同一窗口的行也在响应里：页面按当前筛选重排后，用它算名次变化。
  assert.equal(week.prev.length, 2);
  const alicePrev = week.prev.find((row) => row.handle === "alice")!;
  assert.equal(alicePrev.growth, 500, "上周 alice 涨 500");
  assert.equal(typeof alicePrev.views, "number");
  assert.equal(["zh", "en", "other"].includes(alicePrev.region), true);
});

test("efficiency comes from the window's own posts, and quiet or thin accounts say so", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-amy', '@Amy', 'x_search', ${sql.json({ query: "from:Amy -filter:replies" })}),
      ('x-account-ben', '@Ben', 'x_search', ${sql.json({ query: "from:Ben -filter:replies" })}),
      ('x-account-dan', '@Dan', 'x_search', ${sql.json({ query: "from:Dan -filter:replies" })}),
      ('x-account-eve', '@Eve', 'x_search', ${sql.json({ query: "from:Eve -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM articles WHERE source_id IN ('x-account-amy', 'x-account-ben', 'x-account-dan', 'x-account-eve')`;
  let id = 0;
  const post = (sourceId: string, days: number, views: number) => {
    id += 1;
    const at = daysAgo(now, days);
    return sql`
      INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
      VALUES (${`eff-${id}`}, ${sourceId}, ${`test:eff-${id}`}, ${`https://x.com/eff-${id}`}, ${`eff ${id}`}, 'en', ${at}, ${at}, ${at},
              ${sql.json({ views })}, ${sql.json({ handle: sourceId, lang: "en" })})`;
  };
  // amy 涨 100、6 条帖、6000 次浏览；ben 涨 100 但一条没发；dan 涨 1000 只有 1500 次浏览；eve 只发了 2 条。
  for (const days of [2, 3, 4, 5, 6, 7]) await post("x-account-amy", days, 1000);
  for (const days of [6, 5, 4]) await post("x-account-dan", days, 500);
  for (const days of [3, 5]) await post("x-account-eve", days, 1000);
  await snapshot(daysAgo(now, 8), "amy", 1000);
  await snapshot(daysAgo(now, 1), "amy", 1100);
  await snapshot(daysAgo(now, 8), "ben", 2000);
  await snapshot(daysAgo(now, 1), "ben", 2100);
  await snapshot(daysAgo(now, 8), "dan", 1000);
  await snapshot(daysAgo(now, 1), "dan", 2000);
  await snapshot(daysAgo(now, 8), "eve", 3000);
  await snapshot(daysAgo(now, 1), "eve", 3100);

  const week = await loadGrowth(7, now);
  const amy = week.rows.find((row) => row.handle === "amy")!;
  assert.equal(amy.posts, 6);
  assert.equal(amy.views, 6000);
  assert.equal(amy.perPost, Math.round(100 / 6));
  assert.equal(amy.perK, 16.7);
  assert.equal(amy.signal, null);

  const ben = week.rows.find((row) => row.handle === "ben")!;
  assert.equal(ben.posts, 0);
  assert.equal(ben.perPost, null);
  assert.equal(ben.signal, "quiet", "no posts this week: growth can only come from outside");

  const dan = week.rows.find((row) => row.handle === "dan")!;
  assert.equal(dan.posts, 3);
  assert.equal(dan.signal, "caution", "1000 followers on 1500 views is worth checking");

  const eve = week.rows.find((row) => row.handle === "eve")!;
  assert.equal(eve.signal, "thin", "two posts are too few to explain anything");
});

test("a week that swings more than 30% is worth checking even without big numbers", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-fay', '@Fay', 'x_search', ${sql.json({ query: "from:Fay -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM articles WHERE source_id = 'x-account-fay'`;
  for (const days of [3, 4, 5]) {
    const at = daysAgo(now, days);
    await sql`
      INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
      VALUES (${`rate-${days}`}, 'x-account-fay', ${`test:rate-${days}`}, ${`https://x.com/rate-${days}`}, ${`rate ${days}`}, 'zh', ${at}, ${at}, ${at},
              ${sql.json({ views: 900 })}, ${sql.json({ handle: "fay", lang: "zh" })})`;
  }
  // 300 → 400：只涨 100，但一周涨了三成多。
  await snapshot(daysAgo(now, 8), "fay", 300);
  await snapshot(daysAgo(now, 1), "fay", 400);
  const week = await loadGrowth(7, now);
  const fay = week.rows.find((row) => row.handle === "fay")!;
  assert.equal(fay.growthPct, 33.3);
  assert.equal(fay.signal, "caution", "一周涨三成要先核对");
});

test("the profile page reads the same board: growth, ranks and the daily snapshots", async () => {
  const now = new Date();
  await sql`TRUNCATE x_follower_snapshots`;
  await snapshot(daysAgo(now, 31), "alice", 1000);
  await snapshot(daysAgo(now, 8), "alice", 1500);
  await snapshot(daysAgo(now, 1), "alice", 1600);

  const growth = await loadPersonGrowth("alice", now);
  assert.ok(growth);
  assert.equal(growth.followers, 1600);
  assert.equal(growth.daily.length, 2, "最近 30 天里有两次快照");
  assert.equal(growth.daily.at(-1)!.delta, 100);
  assert.equal(growth.d7?.growth, 100);
  assert.equal(growth.d7?.rank, 1);
  assert.equal(growth.d30?.growth, 600, "30 天窗口从 1000 涨到 1600");
  assert.equal(growth.d30?.enough, true);
  assert.equal(growth.report, null);
  assert.equal((await loadPersonGrowth("nobody-here", now)), null);
});
