import { AgentDecision, BrainConfig, MarketContext } from "./types";

/**
 * Runs local LLM inference via @qvac/llm-llamacpp to produce an action
 * decision from the assembled context. All inference is on-device; no data
 * is transmitted externally.
 * Full implementation delivered in PR-2.
 */
export async function runInference(
  _config: BrainConfig,
  _marketContext: MarketContext,
  _strategyPrompt: string,
  _ragContext: string,
): Promise<AgentDecision> {
  // TODO(PR-2): initialise @qvac/llm-llamacpp, assemble prompt, run inference
  throw new Error("Not implemented — pending PR-2");
}
