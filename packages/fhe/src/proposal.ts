import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { ComplianceProof } from "./types";

/**
 * Submits a ComplianceProof as a ProposalAccount on Solana and polls for
 * VerifiedCompliant status before returning.
 * Full implementation delivered in PR-1.
 */
export async function submitAndAwaitProposal(
  _connection: Connection,
  _agentId: Uint8Array,
  _proof: ComplianceProof,
  _proposer: PublicKey,
  _programId: PublicKey,
): Promise<PublicKey> {
  // TODO(PR-1)
  throw new Error("Not implemented — pending PR-1");
}
