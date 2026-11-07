// Withdraw every selected item of a source that turned out to be misconfigured.
//
// Disabling a source stops collection but never retracts what it already published: `sources.enabled`
// is read only by the collector, while the public surfaces read `publications.visibility`. So a source
// that should never have been enabled needs its output withdrawn explicitly.
//
// This writes the same editorial override the admin's 撤回 does (visibility = 'withdrawn'), which
// publish.ts prefers over the automatic verdict — so the item stays withdrawn even if it is published
// again later — and republishes so the row reaches the public surfaces.
//
//   node scripts/withdraw-source.ts --source rss-dev [--dry-run]
import { closeDb, sql } from "@aihot/backend/db";
import { publishArticle } from "@aihot/backend/publication/publish";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const srcArg = args.indexOf("--source");
const SOURCE = srcArg >= 0 ? args[srcArg + 1] : null;
const REASON = (() => {
  const i = args.indexOf("--reason");
  return i >= 0 ? args[i + 1]! : "信源配置错误：feedUrl 与名称不符，内容不属于本行业";
})();

if (!SOURCE) {
  console.log("用法: node scripts/withdraw-source.ts --source <source_id> [--reason <文本>] [--dry-run]");
  await closeDb();
  process.exit(1);
}

const [src] = await sql<{ id: string; name: string; enabled: boolean }[]>`
  SELECT id, name, enabled FROM sources WHERE id = ${SOURCE}`;
if (!src) {
  console.log(`找不到信源 ${SOURCE}`);
  await closeDb();
  process.exit(1);
}

const rows = await sql<{ article_id: string; title: string; score: number | null; visibility: string; version: number | null }[]>`
  SELECT p.article_id, p.title, p.score, p.visibility, o.version
    FROM publications p
    LEFT JOIN editorial_overrides o ON o.article_id = p.article_id
   WHERE p.source_id = ${SOURCE} AND p.selected
   ORDER BY p.score DESC NULLS LAST`;

console.log(`信源 ${SOURCE}（${src.name}）enabled=${src.enabled}`);
console.log(`精选条目 ${rows.length} 条${dryRun ? "（DRY-RUN）" : ""}\n`);
for (const r of rows) console.log(`  [${String(r.score ?? "-").padStart(5)}] ${r.visibility.padEnd(13)} ${r.title.slice(0, 60)}`);

if (dryRun) {
  console.log("\n未写入。去掉 --dry-run 执行。");
  await closeDb();
  process.exit(0);
}

let done = 0;
let failed = 0;
for (const r of rows) {
  try {
    // Same shape the admin's 撤回 writes; version 0 for a row that has no override yet.
    await sql`
      INSERT INTO editorial_overrides (article_id, visibility, reason, version, updated_by)
      VALUES (${r.article_id}, 'withdrawn', ${REASON}, 1, 'deploy')
      ON CONFLICT (article_id) DO UPDATE
        SET visibility = 'withdrawn', reason = EXCLUDED.reason, version = editorial_overrides.version + 1, updated_at = now()`;
    await publishArticle(r.article_id);
    done++;
  } catch (e) {
    failed++;
    console.log(`  失败 ${r.article_id}: ${(e as Error).message.slice(0, 90)}`);
  }
}
console.log(`\n已撤回 ${done} 条，失败 ${failed} 条`);

const after = await sql<{ visibility: string; n: number }[]>`
  SELECT visibility, count(*)::int AS n FROM publications WHERE source_id = ${SOURCE} GROUP BY 1 ORDER BY 2 DESC`;
console.log(`\n${SOURCE} 的可见性分布:`);
for (const a of after) console.log(`  ${a.visibility.padEnd(14)} ${a.n}`);

const [visible] = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM publications
   WHERE source_id = ${SOURCE} AND selected AND visibility <> 'withdrawn'
     AND coalesce(visible_after, published_at) <= now()`;
console.log(`\n仍在精选可见的: ${visible!.n} 条`);
await closeDb();
