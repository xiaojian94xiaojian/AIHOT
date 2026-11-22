// 中文帖查询：全文、原创/回复筛选、游标翻页和精确计数都只读本站已采集的 X 帖。
import { tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { countXPosts, decodeCursor, searchXPosts, type XPostsFilters } from "../backend/posts-search.ts";

const T = tag();
const HANDLE = `pst${T}`;
const SOURCE = `test-xp-${T}`;
const LONG_TEXT = `开头 ${"长".repeat(200)} 卧槽 出现在中间 ${"尾".repeat(120)}`;
const BASE: Omit<XPostsFilters, "limit"> = { from: "2026-11-20", to: "2026-11-20", originals: true, replies: false, q: null };

async function article(id: string, tweetId: string, at: string, text: string, extra: { lang?: string; replyTo?: Record<string, unknown> | null; views?: number; likes?: number } = {}) {
  await sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, x_post, raw)
    VALUES (${`xp-${id}-${T}`}, ${SOURCE}, ${`xp-${id}-${T}`}, ${`https://x.com/${HANDLE}/status/${tweetId}`}, ${text.slice(0, 40)},
            ${extra.lang ?? "zh"}, ${new Date(at)}, ${new Date(at)}, ${new Date(at)},
            ${sql.json({ text, lang: extra.lang ?? "zh", handle: HANDLE, tweetId, replyTo: extra.replyTo ?? null } as never)},
            ${sql.json({ favorite: extra.likes ?? 3, views: extra.views ?? 100, retweet: 1, reply: 2, quote: 0 })})`;
}

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, enabled)
            VALUES (${SOURCE}, ${`@${HANDLE}`}, 'x_search', ${sql.json({ query: `from:${HANDLE} -filter:replies` })}, 'T2', 'editorial', true)`;
  await sql`INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, followers, captured_at, receipt_id)
            VALUES (${HANDLE}, '2026-11-20', ${HANDLE}, 12345, now(), 0)`;
  await article("a", "1001", "2026-11-20T10:00:00Z", LONG_TEXT, { views: 999, likes: 42 });
  await article("b", "1002", "2026-11-20T09:00:00Z", "第二条中文原创");
  await article("c", "1003", "2026-11-20T08:00:00Z", "一条回复", { replyTo: { id: "1001" } });
  await article("d", "1004", "2026-11-20T07:00:00Z", "an English post", { lang: "en" });
  await article("e", "1005", "2026-11-19T10:00:00Z", "前一天也有卧槽");
});

after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await sql`DELETE FROM x_follower_snapshots WHERE handle = ${HANDLE}`;
  await closeDb();
});

test("原创、中文、日期筛选，全文不截断，作者带粉丝数", async () => {
  const first = await searchXPosts({ ...BASE, limit: 1 });
  assert.equal(first.posts.length, 1);
  assert.equal(first.posts[0]!.id, "1001");
  assert.equal(first.posts[0]!.text, LONG_TEXT);
  assert.ok(first.posts[0]!.text.length > 280);
  assert.equal(first.posts[0]!.author.handle, HANDLE);
  assert.equal(first.posts[0]!.author.followers, 12345);
  assert.equal(first.posts[0]!.like_count, 42);
  assert.equal(first.posts[0]!.view_count, 999);
  assert.equal(first.posts[0]!.is_reply, false);
  assert.equal(first.coverage.accounts, 1);
  assert.ok(first.next_cursor);

  const second = await searchXPosts({ ...BASE, limit: 1, cursor: first.next_cursor });
  assert.equal(second.posts[0]!.id, "1002");
  assert.equal(second.next_cursor, null, "只有两条原创，第二页结束");
});

test("q 是全文子串匹配，位置不限；回复可单独筛", async () => {
  const hits = await searchXPosts({ ...BASE, from: "2026-11-19", to: "2026-11-21", q: "卧槽", limit: 100 });
  assert.deepEqual(hits.posts.map((post) => post.id), ["1001", "1005"]);

  const replies = await searchXPosts({ ...BASE, originals: false, replies: true, limit: 100 });
  assert.deepEqual(replies.posts.map((post) => post.id), ["1003"]);
  assert.equal(replies.posts[0]!.is_reply, true);
});

test("计数：sampled 是范围内中文原创基线，total 是命中 q 的条数", async () => {
  assert.deepEqual(await countXPosts({ ...BASE }), {
    total: 2,
    sampled: 2,
    method: "local-corpus-exact",
    coverage: { scope: "tracked-accounts", source: "hot.jian.ing 收录的 X 账号", accounts: 1, note: (await countXPosts({ ...BASE })).coverage.note },
  });
  const hit = await countXPosts({ ...BASE, q: "卧槽" });
  assert.equal(hit.total, 1);
  assert.equal(hit.sampled, 2);
});

test("游标坏了明确报错", async () => {
  await assert.rejects(searchXPosts({ ...BASE, limit: 10, cursor: "not-a-cursor" }), /cursor/);
  assert.equal(decodeCursor(null), null);
});
