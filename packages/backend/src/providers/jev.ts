// Jev (TypeSafe System One): the prefilter judgment can be answered by Jev instead of the chat model.
// One choice call carries the same material and the same criteria, so the decision keeps its meaning;
// its cost is metered by Jev's own account, outside the Go plan's token quota. When Jev is unreachable
// the chat model below stays the fallback. The shadow module compares both answers with the same client.
import { PREFILTER_CRITERIA } from "../editorial/prefilter-criteria.ts";

export { PREFILTER_CRITERIA };

export interface JevSettings {
  /** Whether the prefilter asks Jev at all. */
  enabled: boolean;
  /** Source tiers whose prefilter goes to Jev, e.g. ["T2"]. */
  tiers: readonly string[];
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-1.13.0";

export function jevSettings(env: NodeJS.ProcessEnv = process.env): JevSettings {
  const pick = (first: string, second: string) => (env[first] ?? "").trim() || (env[second] ?? "").trim();
  const tiers = (env.JEV_PREFILTER_TIERS ?? "").split(",").map((tier) => tier.trim()).filter(Boolean);
  return {
    enabled: (env.JEV_PREFILTER_ENABLED ?? "").trim() === "true",
    // Unset tiers default to the careful first step: T2 only, where the shadow's sample agreed most.
    tiers: tiers.length ? tiers : ["T2"],
    baseUrl: pick("JEV_PREFILTER_BASE_URL", "JEV_SHADOW_BASE_URL") || JEV_DEFAULT_BASE_URL,
    model: pick("JEV_PREFILTER_MODEL", "JEV_SHADOW_MODEL") || JEV_DEFAULT_MODEL,
    apiKey: pick("JEV_PREFILTER_API_KEY", "JEV_SHADOW_API_KEY") || undefined,
  };
}

export interface JevAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  score?: number;
  noul?: number;
}

/** One Jev request: `{ model, state, questions }` in, answers by question name out. */
export async function jevAsk(baseUrl: string, apiKey: string, body: unknown): Promise<Record<string, JevAnswer>> {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jev ${res.status}: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text) as { answers?: Record<string, JevAnswer> };
  if (!parsed.answers) throw new Error(`Jev 答复里没有 answers: ${text.slice(0, 200)}`);
  return parsed.answers;
}
