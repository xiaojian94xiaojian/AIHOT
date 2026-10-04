// 这个站用哪些模型。框架自带一个 `default`：环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 指定的模型。
// 这里再列出具名的模型（每个用自己的地址和密钥环境变量），以及每一步默认用哪个；没写的步骤用 default。
// 部署时还可以用环境变量（PREFILTER_MODEL、SCORE_MODEL……）或后台的“模型与评测”页逐步改选。

export interface ModelPreset {
  service: string;
  model: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** 额外的请求字段，比如短小的结构化任务关掉推理。 */
  extra?: Record<string, unknown>;
  /** 推理模型先想再答，额外给推理留的输出额度（token），加在每一步自己的额度上。default 用环境变量 LLM_REASONING_TOKENS。 */
  reasoningTokens?: number;
  /** 接口支持 JSON 模式。 */
  jsonMode: boolean;
  /** 能看图。 */
  vision?: boolean;
}

/** 具名的模型示例（每个要配自己的密钥）。用不上可以删掉。 */
export const PRESETS: Record<string, ModelPreset> = {
  // GO-GATEWAY PATCH：本部署所有预设都经 OpenCode Go 网关（opencode.ai/zen/go/v1）。
  // 该网关拒绝厂商原生的 `thinking` 参数（"unknown field \"thinking\""），只接受标准的 OpenAI
  // `reasoning_effort`。因此这里只把参数名换掉，推理档位与上游一致：
  //   thinking {type:enabled} + reasoning_effort:low  -> reasoning_effort:"low"
  //   thinking {type:enabled,clear_thinking:false} + reasoning_effort:high -> reasoning_effort:"high"
  //   thinking {type:disabled} -> reasoning_effort:"none"
  // 另外该网关没有 `deepseek-flash` 这个 id（它是 DeepSeek V4.1 Flash 的别名），所以直接写明确的
  // `deepseek-v4.1-flash`，不依赖别名。请求还需要 x-opencode-session 头，那一处改的是框架
  // （providers/llm.ts），因为它对所有预设都生效。
  "glm-5.3-flash": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { reasoning_effort: "low" }, jsonMode: true,
  },
  // The scorer's parameters for glm-5.3-flash (score calls; temperature 1 is set per call).
  "glm-5.3-flash-selection": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { reasoning_effort: "high", top_p: 0.95 }, jsonMode: true,
  },
  // DeepSeek Flash reasons by default; structured tasks switch it off. deepseek-flash-think keeps it on,
  // with room in the output for the reasoning.
  "deepseek-flash": {
    service: "deepseek", model: "deepseek-v4.1-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { reasoning_effort: "none" }, jsonMode: true,
  },
  "deepseek-flash-think": {
    service: "deepseek", model: "deepseek-v4.1-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { reasoning_effort: "high" }, reasoningTokens: 4000, jsonMode: true,
  },
  // 评分用的那条：同一模型，但参数显式写出来，SCORE_MODEL 指向这个名字。
  "deepseek-v4.1-flash-scorer": {
    service: "deepseek", model: "deepseek-v4.1-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { reasoning_effort: "high" }, reasoningTokens: 4000, jsonMode: true,
  },
  "qwen3.7-flash": {
    service: "dashscope", model: "qwen3.7-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "qwen3.8-flash": {
    service: "dashscope", model: "qwen3.8-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "mimo-v2.6-flash": {
    service: "mimo", model: "mimo-v2.6-flash", baseUrlEnv: "XIAOMI_MIMO_BASE_URL", apiKeyEnv: "XIAOMI_MIMO_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "qwen3-vl-flash": {
    service: "dashscope", model: "qwen3-vl-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: false, vision: true,
  },
};

/**
 * 每一步默认用的模型（步骤见后台“模型与评测”页），值是上面的名字或 default。没写的步骤用 default。
 * 例：{ score: "glm-5.3-flash-selection", groupReview: "mimo-v2.6-flash" }
 */
export const DEFAULTS: Record<string, string> = {};
