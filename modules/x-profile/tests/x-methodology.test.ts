// 方法论：每个账号按自己的浏览 P90 切爆款，再把爆款放到一起看共性。
// 口径：回复帖不进池（和卡片/画像页一致），P90 只从成熟帖里切，空库不报 division by zero。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { loadMethodology } from "../backend/methodology.ts";

after(async () => { await sql`DELETE FROM articles WHERE id LIKE 'meth-%'`; await closeDb(); });

test("an empty library reads as zero instead of failing the page", async () => {
  const empty = await loadMethodology();
  assert.equal(empty.totals.accounts, 0);
  assert.equal(empty.totals.posts, 0);
  assert.equal(empty.totals.hitRate, 0);
  assert.deepEqual(empty.formats, []);
});

test("only matured originals enter the pool: replies and posts younger than three days do not", async () => {
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-meth', '@Meth', 'x_search', ${sql.json({ query: "from:meth -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  // 20 条成熟的原创帖：浏览量 100…2000，P90 切点约 1910，爆款是 2000、1900 附近的两条。
  for (let i = 0; i < 20; i += 1) {
    const id = `meth-original-${i}`;
    await sql`
      INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
      VALUES (${id}, 'x-account-meth', ${`test:${id}`}, ${`https://x.com/${id}`}, ${id}, 'zh', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days',
              ${sql.json({ views: (i + 1) * 100, favorite: 1, retweet: 0, reply: 0, quote: 0 })},
              ${sql.json({ handle: "meth", lang: "zh", text: `post ${i}` })})`;
  }
  // 一条浏览很高的回复：不进池，也不该把切点拉高。
  const reply = "meth-reply";
  await sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
    VALUES (${reply}, 'x-account-meth', ${`test:${reply}`}, ${`https://x.com/${reply}`}, ${reply}, 'zh', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days',
            ${sql.json({ views: 900_000, favorite: 1, retweet: 0, reply: 0, quote: 0 })},
            ${sql.json({ handle: "meth", lang: "zh", text: "reply", replyTo: { tweetId: "context-2" } })})`;
  // 一条刚发的高浏览原创：还没成熟，不参与切点和爆款统计。
  const fresh = "meth-fresh";
  await sql`
    INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
    VALUES (${fresh}, 'x-account-meth', ${`test:${fresh}`}, ${`https://x.com/${fresh}`}, ${fresh}, 'zh', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day',
            ${sql.json({ views: 500_000, favorite: 1, retweet: 0, reply: 0, quote: 0 })},
            ${sql.json({ handle: "meth", lang: "zh", text: "fresh" })})`;

  const page = await loadMethodology();
  assert.equal(page.totals.accounts, 1);
  assert.equal(page.totals.posts, 20, "the reply and the one-day-old post stay out");
  assert.equal(page.totals.hits, 2, "P90 of 20 matured originals: the top two");
  assert.equal(page.totals.hitRate, 10);
});
