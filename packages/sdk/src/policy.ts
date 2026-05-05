import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AgentConfig, GuardrailSet, PolicyAccountData } from "./types";

/**
 * Derives the PolicyAccount PDA for a given agent ID.
 */
export function derivePolicyPda(
  agentId: Uint8Array,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), agentId],
    programId,
  );
}

/**
 * Builds the initialize_policy transaction.
 * Full implementation delivered in PR-1.
 */
export async function buildInitializePolicyTx(
  _connection: Connection,
  _config: AgentConfig,
  _authority: PublicKey,
  _programId: PublicKey,
): Promise<Transaction> {
  // TODO(PR-1): construct Anchor instruction via generated IDL client
  throw new Error("Not implemented — pending PR-1");
}

/**
 * Fetches and deserialises a PolicyAccount from the chain.
 * Full implementation delivered in PR-1.
 */
export async function fetchPolicyAccount(
  _connection: Connection,
  _policyPda: PublicKey,
  _programId: PublicKey,
): Promise<PolicyAccountData> {
  // TODO(PR-1): fetch and decode via Anchor IDL
  throw new Error("Not implemented — pending PR-1");
}

/**
 * Queues a guardrail update subject to the 24-hour timelock.
 */
export async function buildUpdateGuardrailsTx(
  _connection: Connection,
  _policyPda: PublicKey,
  _newGuardrailSet: GuardrailSet,
  _authority: PublicKey,
  _programId: PublicKey,
): Promise<Transaction> {
  // TODO(PR-1)
  throw new Error("Not implemented — pending PR-1");
}
