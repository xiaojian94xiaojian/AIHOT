// Jev 影子（P0）：两次请求的形状、两边答案落库、换算、失败重试窗口，以及线路切换的默认值。
import { Reply, stub, tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { runShadow, shadowSettings, toAttentionScore } from "../backend/shadow.ts";

const T = tag();
after(async () => { await closeDb(); });

async function fixture(participation: "editorial" | "hot_signal", suffix: string): Promise<string> {
  const source = `jev-shadow-${suffix}-${T}`;
  const id = `jev${suffix}${T}`.slice(0, 60);
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES (${source}, ${`shadow ${suffix}`}, 'rss', 'T1', ${participation}, '2100-01-01')`;
  await sql`INSERT INTO articles (id,source_id,identity_key,url,title,body_text,body_status,published_at,discovered_at,timeline_at)
    VALUES (${id}, ${source}, ${`jev-shadow:${suffix}:${T}`}, ${`https://example.org/${suffix}-${T}`},
      'Anthropic 发布 Claude 5.5，工具调用并行 32 路', '正文：Anthropic 今天发布 Claude 5.5，上下文 1M。', 'ok',
      now() - interval '1 hour', now() - interval '30 minutes', now() - interval '30 minutes')`;
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,score) VALUES (${id}, 1, 'rule', 'pass', 68.5)`;
  return id;
}

test("one pass stores our judgement and Jev's side by side", async () => {
  const id = await fixture("editorial", "main");
  const seen: any[] = [];
  const server = await stub((_hit, req) => {
    const body = JSON.parse(req.body);
    seen.push(body);
    return body.questions.prefilter
      ? { model: body.model, answers: { prefilter: { type: "choice", choice: "PASS", confidence: 0.91 } } }
      : { model: body.model, answers: { attention: { type: "score", score: 3, confidence: 0.8 } } };
  });
  try {
    const result = await runShadow({ baseUrl: server.url, apiKey: "test-key", model: "jev-test", perRun: 5 });
    assert.deepEqual(result, { shadowed: 1, failed: 0 });
  } finally {
    await server.close();
  }
  const [row] = await sql`SELECT * FROM jev_shadow WHERE article_id = ${id}`;
  assert.equal(row!.model, "jev-test");
  assert.equal(row!.our_relevance, "pass");
  assert.equal(Number(row!.our_score), 68.5);
  assert.equal(row!.threshold, 60, "T1 的门槛");
  assert.equal(row!.jev_prefilter, "PASS");
  assert.equal(row!.jev_prefilter_confidence, 0.91);
  assert.equal(Number(row!.jev_score_raw), 3);
  assert.equal(Number(row!.jev_score), 75, "3/4 换成 0–100");
  assert.equal(row!.error, null);
  assert.ok(row!.raw.prefilter && row!.raw.score);
  // The two requests carry the production standard and the answer space Jev accepts.
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.questions.prefilter.type, "choice");
  assert.deepEqual(Object.keys(seen[0]!.questions.prefilter.criteria).sort(), ["BLOCK", "PASS", "UNKNOWN"]);
  assert.equal(seen[1]!.questions.attention.type, "score");
  assert.equal(seen[1]!.questions.attention.criteria.length, 5);
  assert.ok(seen[0]!.state.length > 0 && seen[1]!.state.length > 0);
});

test("a failed call is recorded once and not retried within the hour", async () => {
  const id = await fixture("editorial", "failing");
  const server = await stub(() => new Reply(500, { error: { message: "upstream down" } }));
  try {
    const first = await runShadow({ baseUrl: server.url, apiKey: "test-key", model: "jev-test", perRun: 5 });
    assert.deepEqual(first, { shadowed: 0, failed: 1 });
    const second = await runShadow({ baseUrl: server.url, apiKey: "test-key", model: "jev-test", perRun: 5 });
    assert.deepEqual(second, { shadowed: 0, failed: 0 }, "an errored row waits an hour before retrying");
  } finally {
    await server.close();
  }
  const [row] = await sql`SELECT error, jev_score, jev_prefilter FROM jev_shadow WHERE article_id = ${id}`;
  assert.match(row!.error, /Jev 500/);
  assert.equal(row!.jev_score, null);
  assert.equal(row!.jev_prefilter, null);
});

test("only editorial sources with a current analysis are shadowed", async () => {
  const hot = await fixture("hot_signal", "hot");
  const server = await stub(() => ({ model: "jev-test", answers: {} }));
  try {
    await runShadow({ baseUrl: server.url, apiKey: "test-key", model: "jev-test", perRun: 20 });
  } finally {
    await server.close();
  }
  assert.equal((await sql`SELECT 1 FROM jev_shadow WHERE article_id = ${hot}`).length, 0);
});

test("the free line is the default and the official one needs only the environment", () => {
  const free = shadowSettings({ LLM_API_KEY: "go-key" });
  assert.deepEqual(
    { enabled: free.enabled, model: free.model, base: free.baseUrl, key: free.apiKey, perRun: free.perRun },
    { enabled: false, model: "jev-1.13-free", base: "https://opencode.ai/inference/systemone/v1/systemone", key: "go-key", perRun: 8 },
  );
  const official = shadowSettings({
    JEV_SHADOW_ENABLED: "true", JEV_SHADOW_BASE_URL: "https://api.typesafe.ai/v1/systemone",
    JEV_SHADOW_MODEL: "jev-1.13.0", JEV_SHADOW_API_KEY: "official-key", JEV_SHADOW_PER_RUN: "3", LLM_API_KEY: "go-key",
  });
  assert.deepEqual(
    { enabled: official.enabled, model: official.model, base: official.baseUrl, key: official.apiKey, perRun: official.perRun },
    { enabled: true, model: "jev-1.13.0", base: "https://api.typesafe.ai/v1/systemone", key: "official-key", perRun: 3 },
  );
});

test("Jev's 0–4 mean becomes the production 0–100 scale", () => {
  assert.equal(toAttentionScore(0), 0);
  assert.equal(toAttentionScore(2.5), 62.5);
  assert.equal(toAttentionScore(4), 100);
  assert.equal(toAttentionScore(undefined), null);
});
