import { MarketContext } from "./types";

/**
 * Assembles the full LLM context from market feeds, the decrypted position
 * state, and RAG retrieval results. Called by the execution loop on each cycle.
 * Full implementation delivered in PR-2.
 */
export async function buildContext(
  _marketContext: MarketContext,
  _decryptedState: unknown,
  _ragChunks: string[],
): Promise<string> {
  // TODO(PR-2)
  throw new Error("Not implemented — pending PR-2");
}
