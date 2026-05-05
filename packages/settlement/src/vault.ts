import { Connection, PublicKey, Transaction } from "@solana/web3.js";

/**
 * Derives the SettlementVault PDA for a given agent public key.
 */
export function deriveVaultPda(
  agentPubkey: PublicKey,
  programId:   PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("settlement_vault"), agentPubkey.toBuffer()],
    programId,
  );
}

/**
 * Builds the initialize_vault transaction.
 * Full implementation delivered in PR-3.
 */
export async function buildInitializeVaultTx(
  _connection: Connection,
  _agent: PublicKey,
  _umbraShieldAddr: PublicKey,
  _principalVkHash: Uint8Array,
  _complianceVkHash: Uint8Array,
  _authority: PublicKey,
  _programId: PublicKey,
): Promise<Transaction> {
  // TODO(PR-3)
  throw new Error("Not implemented — pending PR-3");
}
