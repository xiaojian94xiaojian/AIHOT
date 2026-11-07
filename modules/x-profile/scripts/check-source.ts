// 一次性诊断：某个 X 账号最近到底有没有帖子（绕过源上的 -filter:replies，看原始搜索结果）。
//   docker exec aihot-worker-1 node /app/modules/x-profile/scripts/check-source.ts 46ge5 "since:2026-08-01"
import { closeDb } from "@aihot/backend/db";
import { searchTweets } from "@aihot/backend/providers/socialdata";

const handle = process.argv[2];
const extra = process.argv[3] ?? "";
if (!handle) throw new Error("用法：check-source.ts <handle> [extra query]");

const query = [`from:${handle}`, extra].filter(Boolean).join(" ");
const result = await searchTweets(query, { purpose: "diagnostics", subject: `check:${handle}`, window: "diagnostics" });
console.log(JSON.stringify({
  query,
  tweets: result.tweets.length,
  latest: result.tweets.map((tweet) => tweet.tweet_created_at).slice(0, 3),
  reused: result.reused,
}));
await closeDb();
