import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { SettlementTransfer } from "./types";

/**
 * Constructs the execute_settlement transaction for a confidential transfer.
 * Full implementation delivered in PR-3.
 */
export async function buildSettlementTx(
  _connection: Connection,
  _vaultPda: PublicKey,
  _transfer: SettlementTransfer,
  _authority: PublicKey,
  _programId: PublicKey,
): Promise<Transaction> {
  // TODO(PR-3)
  throw new Error("Not implemented — pending PR-3");
}
