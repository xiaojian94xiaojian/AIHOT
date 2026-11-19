// 手动跑一次热点 poke 的 dry-run：只打印「本来会抓哪些事件、哪些源」，不发请求、不花钱。
// 用法：node scripts/hot-poke.ts
import { closeDb } from "@aihot/backend/db";
import { hotPoke } from "@aihot/backend/sources/poke";

const result = await hotPoke(new Date(), "dry-run");
console.log(JSON.stringify(result, null, 2));
await closeDb();
