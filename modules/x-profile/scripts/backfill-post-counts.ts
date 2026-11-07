// 一次性脚本：把回执里现成的「回复 / 引用」计数补进 articles.raw。
// 采集端从 2026-11-05 起才记这两个数，之前入库的帖子补一遍，画像的互动结构才有数据。
//   docker exec aihot-worker-1 node /app/modules/x-profile/scripts/backfill-post-counts.ts 45
import { closeDb, sql } from "@aihot/backend/db";

/** 回执只留 30 天，默认往前补 45 天只是把窗口放宽一点，不会读到不存在的行。 */
const days = Math.max(1, Math.min(90, Number(process.argv[2] ?? 45)));

const updated = await sql<{ n: number }[]>`
  WITH counted AS (
    SELECT DISTINCT ON (tweet->>'id_str')
      tweet->>'id_str' AS tweet_id,
      (tweet->>'reply_count')::bigint AS reply,
      (tweet->>'quote_count')::bigint AS quote
    FROM receipts r, jsonb_array_elements(r.response->'tweets') tweet
    WHERE r.service = 'socialdata'
      AND r.received_at > now() - make_interval(days => ${days})
      AND jsonb_typeof(r.response->'tweets') = 'array'
      AND tweet ? 'id_str'
    ORDER BY tweet->>'id_str'
  ), touched AS (
    UPDATE articles a
    SET raw = coalesce(a.raw, '{}'::jsonb) || jsonb_build_object('reply', counted.reply, 'quote', counted.quote)
    FROM counted
    WHERE a.x_post->>'tweetId' = counted.tweet_id
    RETURNING a.id
  )
  SELECT count(*)::int AS n FROM touched`;

console.log(JSON.stringify({ days, updated: updated[0]?.n ?? 0 }));
await closeDb();
