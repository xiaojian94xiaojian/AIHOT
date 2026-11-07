// A source's first import brings its whole archive. The prefilter still runs on all of it, but the
// expensive steps must not: archived history founds no event and adds no heat, so scoring, structuring
// and writing it buys nothing a reader can reach. The explicit path (the admin's re-run) is deliberately
// not limited — the caller asked for that article by name.
import { tag, stub } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { loadAnalyzeInput } from "@aihot/backend/editorial/input";
import { runAnalysis } from "@aihot/backend/editorial/analyze";

const T = tag();
const SOURCE = `history-limit-${T}`;
const calls: string[] = [];

const provider = await stub(async (_hit, request) => {
  const system = String(JSON.parse(request.body).messages[0]?.content ?? "");
  const step = system.includes("宽召回的AI相关性预筛") ? "prefilter"
    : system.includes("事件注意力评分器") ? "score"
    : system.includes("资料结构化助手") ? "structure" : "writing";
  calls.push(step);
  const content = step === "prefilter" ? { label: "PASS", reason: "local fixture" }
    : step === "score" ? { attentionScore: 80 }
    : step === "structure" ? { category: "ai-models", tags: [], subjects: [], fact: null }
    : { itemType: "model_release", authorRole: "principal", tags: ["模型发布"], editorialJudgment: "能力提升", titleZh: `标题 ${T}`, summaryZh: "摘要内容。" };
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
});
for (const n of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[n] = `${provider.url}/v1`;
for (const n of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[n] = "test-key";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'History limit', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => { await provider.close(); await closeDb(); });

/** Editorial history: found as a backfill and published long before it was found. */
async function historical(label: string): Promise<string> {
  const id = `hist${T}${label}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at,
              published_at, backfill, backfill_reason, revision, content_hash, body_text, body_status, processing_state)
            VALUES (${id}, ${SOURCE}, ${id}, ${"https://example.org/" + id}, 'Historical piece',
              now(), now() - interval '2 years', now() - interval '2 years', true, 'stale-on-discovery',
              1, 'hash', 'Body text for judging.', 'ok', 'new')`;
  return id;
}

/** News: found when it was already current, so not historical. */
async function live(label: string): Promise<string> {
  const id = `live${T}${label}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at,
              published_at, backfill, revision, content_hash, body_text, body_status, processing_state)
            VALUES (${id}, ${SOURCE}, ${id}, ${"https://example.org/" + id}, 'Fresh piece',
              now(), now(), now() - interval '1 hour', false, 1, 'hash', 'Body text for judging.', 'ok', 'new')`;
  return id;
}

async function judge(id: string, opts: { sweep?: boolean; attemptTag?: string }) {
  const run = await runAnalysis((await loadAnalyzeInput(id))!, opts);
  return { steps: [...calls], hasScores: run.scores !== null, hasWriting: run.writing !== null };
}

test("the automatic run stops after the prefilter on archived history", async () => {
  calls.length = 0;
  const result = await judge(await historical("a"), { sweep: true });
  assert.equal(result.steps.includes("prefilter"), true, "the prefilter still runs");
  assert.equal(result.hasScores, false, "no scoring for history");
  assert.equal(result.hasWriting, false, "no writing for history");
  assert.deepEqual(result.steps, ["prefilter"]);
});

test("an explicit re-evaluation of history is still judged", async () => {
  // The admin's re-run asks for this article by name: the limit must not answer for it.
  calls.length = 0;
  const tagged = await judge(await historical("b"), { sweep: true, attemptTag: `admin:${T}` });
  assert.equal(tagged.hasScores, true);
  assert.equal(tagged.hasWriting, true);

  calls.length = 0;
  const direct = await judge(await historical("c"), {});
  assert.equal(direct.hasScores, true);
  assert.equal(direct.hasWriting, true);
});

test("news found today is judged in full, sweep or not", async () => {
  calls.length = 0;
  const result = await judge(await live("d"), { sweep: true });
  assert.equal(result.hasScores, true);
  assert.equal(result.hasWriting, true);
  assert.deepEqual(result.steps.filter((s) => s === "score").length, 2, "the two score calls happen");
});
