import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { VkScope } from "./types";

/**
 * Issues a scoped viewing key grant to a grantee.
 * Full implementation delivered in PR-3.
 */
export async function buildGrantViewingKeyTx(
  _connection: Connection,
  _vaultPda: PublicKey,
  _grantee: PublicKey,
  _encryptedVk: Uint8Array,
  _scope: VkScope,
  _authority: PublicKey,
  _programId: PublicKey,
): Promise<Transaction> {
  // TODO(PR-3)
  throw new Error("Not implemented — pending PR-3");
}

/**
 * Decrypts settlement history using a viewing key. Entirely local — no data
 * leaves the caller's process.
 * Full implementation delivered in PR-3.
 */
export async function decryptWithViewingKey(
  _connection: Connection,
  _vaultPda: PublicKey,
  _viewingKey: Uint8Array,
  _programId: PublicKey,
): Promise<unknown[]> {
  // TODO(PR-3)
  throw new Error("Not implemented — pending PR-3");
}
