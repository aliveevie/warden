import { ActionIntent, ComplianceProof, PlaintextState } from "./types";

/**
 * Generates a REFHE compliance proof asserting that the given ActionIntent
 * satisfies all GuardrailSet predicates without revealing state or intent.
 *
 * Inputs consumed locally; proof is safe to publish on-chain.
 * Full implementation delivered in PR-1.
 */
export async function proveCompliance(
  _state: PlaintextState,
  _intent: ActionIntent,
  _guardrailCommitment: Uint8Array,
  _fhePublicKey: Uint8Array,
): Promise<ComplianceProof> {
  // TODO(PR-1): invoke REFHE WASM prover with Encrypt network parameters
  throw new Error("Not implemented — pending PR-1");
}
