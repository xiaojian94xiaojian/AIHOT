// Jev 影子（P0）：把生产模型正在答的两道判断题（预筛、评分）用同样的材料和同样的标准再问一次 Jev，
// 把两边的答案并排存进 jev_shadow，供以后决定要不要把判断层切过去。它不改任何判定、不发布、不推送。
//
// 线路：默认走 OpenCode 的 `jev-1.13-free`（用 LLM_API_KEY，零成本，限时）；站主要换 TypeSafe 官方时，
// 设 JEV_SHADOW_BASE_URL / JEV_SHADOW_MODEL / JEV_SHADOW_API_KEY 三个变量即可，代码不动（见 JEV-PLAN.md）。
//
// 成本与频率：每 10 分钟最多 N 篇（JEV_SHADOW_PER_RUN，默认 8），每篇两次请求；免费线路不产生账单。
import { sql } from "@aihot/backend/db";
import { buildScoreInput, loadAnalyzeInput, SCORE_SYSTEM, tierThreshold } from "@aihot/backend/editorial/analyze";
import { PREFILTER_SYSTEM, prefilterUser } from "@aihot/backend/editorial/writing";
import { jevAsk, jevSettings, PREFILTER_CRITERIA } from "@aihot/backend/providers/jev";

/** Re-exported for the shadow's own callers; the criteria live beside the production prefilter. */
export { PREFILTER_CRITERIA };

/** OpenCode 的免费 Jev；官方线路把它换掉即可。 */
export const DEFAULT_MODEL = "jev-1.13-free";
export const DEFAULT_BASE_URL = "https://opencode.ai/inference/systemone/v1/systemone";

/**
 * 评分的五档，对应生产 0–100 的 attentionScore；Jev 返回 0…4 的加权均值，这里按 (n−1) 换成 0–100。
 * 档位按“情形”描述而不是数字（官方说数值型档位会让概率塌陷）。
 */
export const SCORE_CRITERIA = [
  "无关或噪声：不是 AI 主题，或没有读者会关心的信息",
  "边缘相关：主题沾边，但没有值得专门读的新信息",
  "值得一看：有具体新信息，但重要性一般",
  "重要：明确影响产品、技术路线或行业的实质变化",
  "重大且必读：广泛可用的能力跃迁、重大发布或行业级事件",
];

/** 评分系统的提示词描述的是同一套口味，只是输出形态从 0–100 换成了五档。 */
export const scoreInstructions = (rubric: string) =>
  `${rubric}\n\n任务：按上面的标准判断这条材料对读者的注意力价值，在下面五档中给出概率分布。`;

export interface ShadowSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  perRun: number;
}

export function shadowSettings(env: NodeJS.ProcessEnv = process.env): ShadowSettings {
  const value = (name: string) => (env[name] ?? "").trim();
  return {
    enabled: value("JEV_SHADOW_ENABLED") === "true",
    baseUrl: value("JEV_SHADOW_BASE_URL") || DEFAULT_BASE_URL,
    // 官方线路用 JEV_SHADOW_API_KEY；免费线路借用站点的 Go key。
    apiKey: value("JEV_SHADOW_API_KEY") || value("LLM_API_KEY") || undefined,
    model: value("JEV_SHADOW_MODEL") || DEFAULT_MODEL,
    perRun: Math.max(1, Number(value("JEV_SHADOW_PER_RUN")) || 8),
  };
}

interface JevAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  score?: number;
  noul?: number;
}

interface ShadowRow {
  id: string;
  revision: number;
  relevance: string | null;
  score: number | null;
  source_id: string;
  tier: string | null;
}

export interface ShadowResult {
  shadowed: number;
  failed: number;
}

/**
 * The next articles to shadow: current analyses of editorial sources, newest first, that have no row yet
 * for this model and revision. An errored row is retried after an hour, so a provider outage does not
 * spend every article of the day on one bad window.
 */
async function shadowCandidates(model: string, limit: number): Promise<ShadowRow[]> {
  // A tier whose production prefilter already asks Jev would compare Jev with itself; skip it.
  const jev = jevSettings();
  const tierFilter = jev.enabled ? sql`s.tier <> ALL(${jev.tiers})` : sql`true`;
  return sql<ShadowRow[]>`
    SELECT a.id, a.revision, an.relevance, an.score::float8 AS score, a.source_id, s.tier
    FROM analyses an
    JOIN articles a ON a.id = an.article_id AND a.revision = an.input_revision
    JOIN sources s ON s.id = a.source_id
    WHERE s.participation_mode = 'editorial'
      AND an.relevance IS NOT NULL
      AND ${tierFilter}
      AND NOT EXISTS (
        SELECT 1 FROM jev_shadow sh
        WHERE sh.article_id = a.id AND sh.input_revision = a.revision AND sh.model = ${model}
          AND (sh.error IS NULL OR sh.created_at > now() - interval '1 hour')
      )
    ORDER BY an.id DESC
    LIMIT ${limit}`;
}

async function ask(baseUrl: string, apiKey: string, body: unknown): Promise<Record<string, JevAnswer>> {
  return jevAsk(baseUrl, apiKey, body);
}

/** 0–100 换算：Jev 的 score 是档位序号的加权均值（0…n−1）。 */
export const toAttentionScore = (score: number | undefined): number | null =>
  typeof score === "number" && Number.isFinite(score) ? Math.round((score / (SCORE_CRITERIA.length - 1)) * 10000) / 100 : null;

async function shadowOne(articleId: string, model: string, baseUrl: string, apiKey: string) {
  const a = await loadAnalyzeInput(articleId);
  if (!a) throw new Error("article input not loadable");
  const started = Date.now();
  const prefilter = await ask(baseUrl, apiKey, {
    model,
    state: prefilterUser(a),
    questions: {
      prefilter: { type: "choice", instructions: PREFILTER_SYSTEM, criteria: PREFILTER_CRITERIA },
    },
  });
  const score = await ask(baseUrl, apiKey, {
    model,
    state: buildScoreInput(a),
    questions: {
      attention: { type: "score", instructions: scoreInstructions(SCORE_SYSTEM), criteria: SCORE_CRITERIA },
    },
  });
  return { latencyMs: Date.now() - started, prefilter: prefilter.prefilter ?? null, score: score.attention ?? null };
}

/**
 * Runs one shadow pass. `overrides` is for tests (a local stub); the schedule passes nothing and uses the
 * environment. Errors are stored per article, never thrown: one bad article must not stop the batch.
 */
export async function runShadow(overrides: Partial<ShadowSettings> = {}): Promise<ShadowResult> {
  const settings = { ...shadowSettings(), ...overrides };
  if (!settings.apiKey) throw new Error("JEV_SHADOW 需要 LLM_API_KEY 或 JEV_SHADOW_API_KEY");
  const rows = await shadowCandidates(settings.model, settings.perRun);
  let shadowed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const got = await shadowOne(row.id, settings.model, settings.baseUrl, settings.apiKey);
      await sql`
        INSERT INTO jev_shadow (article_id, input_revision, model, source_id, source_tier, our_relevance, our_score, threshold,
          jev_prefilter, jev_prefilter_confidence, jev_score, jev_score_raw, jev_score_confidence, latency_ms, raw)
        VALUES (${row.id}, ${row.revision}, ${settings.model}, ${row.source_id}, ${row.tier}, ${row.relevance}, ${row.score},
          ${row.tier ? tierThreshold(row.tier) : null}, ${got.prefilter?.choice ?? null}, ${got.prefilter?.confidence ?? null},
          ${toAttentionScore(got.score?.score)}, ${got.score?.score ?? null}, ${got.score?.confidence ?? null},
          ${got.latencyMs}, ${sql.json({ prefilter: got.prefilter, score: got.score } as never)})
        ON CONFLICT (article_id, input_revision, model) DO UPDATE SET
          source_tier = EXCLUDED.source_tier, our_relevance = EXCLUDED.our_relevance, our_score = EXCLUDED.our_score,
          threshold = EXCLUDED.threshold, jev_prefilter = EXCLUDED.jev_prefilter,
          jev_prefilter_confidence = EXCLUDED.jev_prefilter_confidence, jev_score = EXCLUDED.jev_score,
          jev_score_raw = EXCLUDED.jev_score_raw, jev_score_confidence = EXCLUDED.jev_score_confidence,
          latency_ms = EXCLUDED.latency_ms, error = NULL, raw = EXCLUDED.raw, created_at = now()`;
      shadowed += 1;
    } catch (error) {
      failed += 1;
      const message = String(error instanceof Error ? error.message : error).slice(0, 500);
      await sql`
        INSERT INTO jev_shadow (article_id, input_revision, model, source_id, source_tier, our_relevance, our_score, threshold, error)
        VALUES (${row.id}, ${row.revision}, ${settings.model}, ${row.source_id}, ${row.tier}, ${row.relevance}, ${row.score},
          ${row.tier ? tierThreshold(row.tier) : null}, ${message})
        ON CONFLICT (article_id, input_revision, model) DO UPDATE SET error = EXCLUDED.error, created_at = now()`;
    }
  }
  return { shadowed, failed };
}
