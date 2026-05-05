import { Connection, PublicKey } from "@solana/web3.js";

export interface ViewingKeyScope {
  type: "full" | "dateRange" | "positionSet";
  from?: number;
  to?: number;
  positionIds?: Uint8Array[];
}

export interface SettlementRecord {
  nullifier:    Uint8Array;
  timestamp:    number;
  // Remaining fields populated after local VK decryption in PR-3.
}

/**
 * Decrypts and returns all settlement records accessible under the supplied
 * viewing key. Decryption happens entirely locally — no data is sent off-device.
 * Full implementation delivered in PR-3 (Umbra).
 */
export async function decryptSettlementHistory(
  _connection: Connection,
  _vaultPda: PublicKey,
  _viewingKey: Uint8Array,
  _programId: PublicKey,
): Promise<SettlementRecord[]> {
  // TODO(PR-3)
  throw new Error("Not implemented — pending PR-3");
}
