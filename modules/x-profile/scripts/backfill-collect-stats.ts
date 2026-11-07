// 一次性脚本：把最近 N 天的采集账补进 x_collect_stats（默认 14 天），看板不用等每天的 05:10。
//   docker exec aihot-worker-1 node /app/modules/x-profile/scripts/backfill-collect-stats.ts 14
import { closeDb } from "@aihot/backend/db";
import { beijingToday, snapshotCollectStats } from "../backend/collect-stats.ts";

const days = Math.max(1, Math.min(90, Number(process.argv[2] ?? 14)));
const out: Array<{ day: string; calls: number; usd: number }> = [];
for (let offset = days; offset >= 1; offset -= 1) {
  const day = beijingToday(new Date(Date.now() - offset * 86_400_000));
  const stat = await snapshotCollectStats(day);
  out.push({ day: stat.day, calls: stat.calls, usd: stat.usd });
}
console.log(JSON.stringify({ days: out.length, out }));
await closeDb();
