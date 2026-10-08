// Applies the 2026-10-08 weighting reset and the AIHOT editorial package to the live source registry.
//
// industry/sources.json records the same change for fresh deployments, but scripts/seed.ts only inserts
// (ON CONFLICT DO NOTHING), so existing sources are updated here.
//
// A tier change reaches the public projection: publications.first_party is written from the source tier
// when an article is published, so every re-tiered source is re-derived through the same queued job the
// admin uses (admin/sources.ts). Nothing here calls a model.
//
// Usage: node --env-file=.env scripts/apply-tier-mapping-2026-10-08.ts [--dry-run]
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { QUEUES, enqueue, getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";

interface Mapping {
  retier: Record<string, string>;
  newSources: Array<{ id: string; name: string; handle: string; tier: string; identity: string }>;
  /** Sources the editorial package lists as editorial that are still hot_signal here. */
  editorial?: string[];
}

const dryRun = process.argv.includes("--dry-run");
const data = JSON.parse(readFileSync(path.join(REPO_ROOT, "scripts/tier-mapping-2026-10-08.json"), "utf8")) as Mapping;

interface Row {
  id: string;
  name: string;
  kind: string;
  tier: string;
  first_party: boolean;
  participation_mode: string;
  enabled: boolean;
}
const rows = await sql<Row[]>`SELECT id, name, kind, tier, first_party, participation_mode, enabled FROM sources`;
const byId = new Map(rows.map((r) => [r.id, r]));

const retier = Object.entries(data.retier).filter(([id, tier]) => {
  const row = byId.get(id);
  return row && (row.tier !== tier || row.first_party !== (tier === "T1"));
});
const missing = Object.keys(data.retier).filter((id) => !byId.has(id));
const creates = data.newSources.filter((s) => !byId.has(s.id));
/** The package lists these as editorial (they create events and reach the public pool); here they were signals. */
const toEditorial = (data.editorial ?? []).filter((id) => byId.get(id)?.participation_mode !== "editorial");

console.log(`改档 ${retier.length} 个源；新建 ${creates.length} 个源；转精选源 ${toEditorial.length} 个；改档表里对不上库的 ${missing.length} 个`);
if (missing.length) console.log("  对不上：", missing.join(", "));
for (const [id, tier] of retier.slice(0, 8)) {
  const row = byId.get(id)!;
  console.log(`  ${id}: ${row.tier} → ${tier}（${row.participation_mode}，enabled=${row.enabled}）`);
}
if (retier.length > 8) console.log(`  …另有 ${retier.length - 8} 个`);
for (const s of creates.slice(0, 5)) console.log(`  新建 ${s.id}（${s.tier}）${s.name}`);
if (creates.length > 5) console.log(`  …另有 ${creates.length - 5} 个新源`);

if (dryRun) {
  console.log("dry-run：没有写库");
  await closeDb();
  process.exit(0);
}

await sql.begin(async (tx) => {
  for (const [id, tier] of retier) {
    await tx`UPDATE sources SET tier = ${tier}, first_party = ${tier === "T1"}, updated_at = now() WHERE id = ${id}`;
  }
  // First party means a T1 source everywhere else in the code (admin/sources.ts); the column drifted.
  // A first_party-only change does not reach the projection (publications derive it from the tier),
  // so these rows need no republish.
  const fixed = await tx`UPDATE sources SET first_party = (tier = 'T1'), updated_at = now() WHERE first_party <> (tier = 'T1')`;
  console.log(`first_party 归一：${fixed.count} 行`);
  for (const id of toEditorial) {
    await tx`UPDATE sources SET participation_mode = 'editorial', updated_at = now() WHERE id = ${id}`;
  }
  for (const s of creates) {
    const config = { query: `from:${s.handle} -filter:replies`, _aihot: { initialBackfillLimit: 8 } };
    assertSupportedConfig("x_search", config);
    await tx`
      INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
      VALUES (${s.id}, ${s.name}, 'x_search', ${tx.json(config as never)}, ${s.tier}, ${s.tier === "T1"}, 'editorial', 30, '{}'::text[], true, false, true, now())`;
  }
});

// The projection re-derives from the source row; leave nothing stale behind.
await getBoss();
let queued = 0;
for (const id of [...retier.map(([id]) => id), ...toEditorial]) {
  await enqueue(QUEUES.republishSource, { sourceId: id }, { singletonKey: id });
  queued += 1;
}
console.log(`已写入：改档 ${retier.length}，新建 ${creates.length}，转精选源 ${toEditorial.length}，入队重发 ${queued}`);

const after = await sql<{ tier: string; n: number }[]>`
  SELECT tier, count(*)::int AS n FROM sources WHERE participation_mode = 'editorial' AND enabled GROUP BY tier ORDER BY tier`;
console.log("改档后启用中的 editorial 分级：", after.map((r) => `${r.tier}=${r.n}`).join(" "));

await stopBoss();
await closeDb();
