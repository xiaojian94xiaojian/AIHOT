// Applies the 2026-10-08 source work to the live registry, in one re-runnable place:
//   1. the tier reset (retier) and the editorial package (newSources, editorial);
//   2. the ambient package (newSignalSources, fixSignalConfigs).
//
// industry/sources.json records the same changes for fresh deployments, but scripts/seed.ts only inserts
// (ON CONFLICT DO NOTHING), so existing sources are updated here.
//
// A tier change reaches the public projection: publications.first_party is written from the source tier
// when an article is published, so every re-tiered source is re-derived through the same queued job the
// admin uses (admin/sources.ts). An ambient source never enters the pool, so it needs no republish.
// Nothing here calls a model.
//
// Usage: node --env-file=.env scripts/apply-tier-mapping-2026-10-08.ts [--dry-run]
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { QUEUES, enqueue, getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";

interface AmbientSource {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  intervalMinutes?: number;
}
interface Mapping {
  retier: Record<string, string>;
  newSources: Array<{ id: string; name: string; handle: string; tier: string; identity: string }>;
  /** Sources the editorial package lists as editorial that are still hot_signal here. */
  editorial?: string[];
  /** Ambient sources: stay hot_signal, reach /hot only. */
  newSignalSources?: AmbientSource[];
  /** Ambient sources whose access method was wrong (missing field mapping, blocked redirect). */
  fixSignalConfigs?: Array<{ id: string; name: string; config: Record<string, unknown>; enable: boolean }>;
}

const dryRun = process.argv.includes("--dry-run");
const read = (file: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, "scripts", file), "utf8")) as Mapping;
const data = read("tier-mapping-2026-10-08.json");
const ambient = read("ambient-2026-10-08.json");

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
const toEditorial = (data.editorial ?? []).filter((id) => byId.get(id)?.participation_mode !== "editorial");
/** The first batch of signal sources recorded only a feedUrl; normalise both shapes to one. */
const normalise = (s: AmbientSource & { feedUrl?: string; intervalMinutes?: number }) => ({
  id: s.id, name: s.name, kind: s.kind,
  config: s.config ?? { feedUrl: s.feedUrl! },
  intervalMinutes: s.intervalMinutes ?? 30,
});
const newSignals = [...(data.newSignalSources ?? []), ...(ambient.newSignalSources ?? [])]
  .map(normalise).filter((s) => !byId.has(s.id));
const fixes = (ambient.fixSignalConfigs ?? []).filter((s) => byId.has(s.id));

console.log(`改档 ${retier.length}；新建精选源 ${creates.length}；转精选源 ${toEditorial.length}；`
  + `新建氛围源 ${newSignals.length}；修氛围源配置 ${fixes.length}；改档表里对不上库的 ${missing.length}`);
if (missing.length) console.log("  对不上：", missing.join(", "));
for (const [id, tier] of retier.slice(0, 6)) {
  const row = byId.get(id)!;
  console.log(`  ${id}: ${row.tier} → ${tier}（${row.participation_mode}，enabled=${row.enabled}）`);
}
if (retier.length > 6) console.log(`  …另有 ${retier.length - 6} 个改档`);
for (const s of newSignals.slice(0, 5)) console.log(`  新建氛围源 ${s.id}（${s.kind}）${s.name}`);
if (newSignals.length > 5) console.log(`  …另有 ${newSignals.length - 5} 个氛围源`);
for (const f of fixes) console.log(`  修配置 ${f.id} ${f.name} → enabled=${f.enable}`);

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
  // A first_party-only change does not reach the projection (publications derive it from the tier).
  const fixed = await tx`UPDATE sources SET first_party = (tier = 'T1'), updated_at = now() WHERE first_party <> (tier = 'T1')`;
  console.log(`first_party 归一：${fixed.count} 行`);
  for (const id of toEditorial) {
    await tx`UPDATE sources SET participation_mode = 'editorial', updated_at = now() WHERE id = ${id}`;
  }
  // Ambient sources: heat only, never the pool. Enabled, like the site's other signal sources.
  for (const s of newSignals) {
    assertSupportedConfig(s.kind as never, s.config);
    await tx`
      INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
      VALUES (${s.id}, ${s.name}, ${s.kind}, ${tx.json(s.config as never)}, 'T2', false, 'hot_signal', 30, '{}'::text[], false, false, true, now())`;
  }
  for (const f of fixes) {
    assertSupportedConfig(byId.get(f.id)!.kind as never, f.config);
    await tx`UPDATE sources SET config = ${tx.json(f.config as never)}, enabled = ${f.enable}, updated_at = now(), next_fetch_at = now() WHERE id = ${f.id}`;
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
console.log(`已写入：改档 ${retier.length}，新建精选源 ${creates.length}，转精选源 ${toEditorial.length}，`
  + `新建氛围源 ${newSignals.length}，修配置 ${fixes.length}，入队重发 ${queued}`);

const counts = await sql<{ participation_mode: string; tier: string; n: number }[]>`
  SELECT participation_mode, tier, count(*)::int AS n FROM sources WHERE enabled GROUP BY 1, 2 ORDER BY 1, 2`;
console.log("启用中的源：", counts.map((r) => `${r.participation_mode}/${r.tier}=${r.n}`).join(" "));

await stopBoss();
await closeDb();
