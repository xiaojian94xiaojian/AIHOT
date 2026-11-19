// 热点 poke（W13）：事件刚变热时，对相关的 X 采集源补抓一次，不等下一轮定时。
// 默认 off（不花钱）；dry-run 只记录「本来会抓谁」；on 才真的入队。硬限制：事件数、源数、冷却时间。
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";

export type PokeMode = "off" | "dry-run" | "on";

export interface PokeCandidate {
  storyId: number;
  title: string;
  signals: number;
  sources: string[];
}

export interface PokePlan extends PokeCandidate {
  due: string[];
  cooling: string[];
}

export interface PokeResult {
  mode: PokeMode;
  candidates: PokePlan[];
  enqueued: string[];
  skipped: string[];
}

/** 纯函数：按冷却时间和总源数上限，挑出这次真的要抓的源。测试直接打这里。 */
export function planPokes(
  candidates: PokeCandidate[],
  cooldowns: Map<string, string>,
  now: Date,
  cooldownMinutes: number,
  maxSources: number,
): PokePlan[] {
  const cooldownMs = cooldownMinutes * 60_000;
  let picked = 0;
  return candidates.map((candidate) => {
    const due: string[] = [];
    const cooling: string[] = [];
    for (const sourceId of candidate.sources) {
      const last = cooldowns.get(sourceId);
      if (last && now.getTime() - Date.parse(last) < cooldownMs) {
        cooling.push(sourceId);
      } else if (picked < maxSources) {
        due.push(sourceId);
        picked += 1;
      }
    }
    return { ...candidate, due, cooling };
  });
}

async function setCooldown(sourceId: string, at: Date): Promise<void> {
  await sql`
    INSERT INTO settings (key, value) VALUES (${`poke:${sourceId}`}, ${at.toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/** 候选事件：最近 45 分钟有更新、2 小时内 signal 数达到阈值，按 signal 数排。 */
async function pokeCandidates(): Promise<PokeCandidate[]> {
  const rows = await sql<{ id: string; title: string; signals: number }[]>`
    SELECT s.id, s.title, r.signals
    FROM stories s
    JOIN (
      SELECT story_id, count(*)::int AS signals
      FROM story_signals
      WHERE observed_at > now() - interval '2 hours'
      GROUP BY story_id
    ) r ON r.story_id = s.id
    WHERE s.merged_into IS NULL
      AND s.latest_at > now() - interval '45 minutes'
      AND r.signals >= ${config.hotPokeMinSignals}
    ORDER BY r.signals DESC, s.latest_at DESC
    LIMIT ${config.hotPokeMaxEvents}`;
  const out: PokeCandidate[] = [];
  for (const row of rows) {
    const sources = await sql<{ source_id: string }[]>`
      SELECT ss.source_id
      FROM story_signals ss
      JOIN sources src ON src.id = ss.source_id
      WHERE ss.story_id = ${row.id} AND src.enabled AND src.kind = 'x_search'
      GROUP BY ss.source_id
      ORDER BY max(ss.observed_at) DESC`;
    out.push({ storyId: Number(row.id), title: row.title, signals: Number(row.signals), sources: sources.map((source) => source.source_id) });
  }
  return out;
}

async function cooldownsOf(sourceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sourceIds.length === 0) return out;
  const keys = sourceIds.map((id) => `poke:${id}`);
  const rows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM settings WHERE key = ANY(${keys}::text[])`;
  for (const row of rows) out.set(row.key.replace(/^poke:/, ""), row.value);
  return out;
}

/** 跑一次热点 poke；`modeOverride` 给脚本手动 dry-run 用，不改变部署配置。 */
export async function hotPoke(now = new Date(), modeOverride?: PokeMode): Promise<PokeResult> {
  const mode = modeOverride ?? config.hotPokeMode;
  if (mode === "off") return { mode, candidates: [], enqueued: [], skipped: [] };

  const candidates = await pokeCandidates();
  const cooldowns = await cooldownsOf(candidates.flatMap((candidate) => candidate.sources));
  const plan = planPokes(candidates, cooldowns, now, config.hotPokeCooldownMinutes, config.hotPokeMaxSources);
  if (mode === "dry-run") return { mode, candidates: plan, enqueued: [], skipped: [] };

  const enqueued: string[] = [];
  const skipped: string[] = [];
  for (const item of plan) {
    for (const sourceId of item.due) {
      const id = await enqueue(QUEUES.fetchSource, { sourceId }, { singletonKey: `poke:${sourceId}` });
      if (id) {
        enqueued.push(sourceId);
        await setCooldown(sourceId, now);
      } else {
        skipped.push(sourceId);
      }
    }
  }
  return { mode, candidates: plan, enqueued, skipped };
}
