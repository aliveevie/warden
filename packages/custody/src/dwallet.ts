import { DwalletConfig, DwalletSigningCondition } from "./types";

/**
 * Creates an Ika dWallet and returns its 32-byte network ID.
 * Full implementation delivered in PR-1.
 */
export async function createDwallet(
  _config: DwalletConfig,
  _signingCondition: DwalletSigningCondition,
  _localKeyShare: Uint8Array,
): Promise<Uint8Array> {
  // TODO(PR-1): POST to Ika Network API and register signing condition
  throw new Error("Not implemented — pending PR-1");
}

/**
 * Requests a co-signature from the Ika Network for a prepared transaction.
 * The network will only produce its share if the on-chain signing condition
 * is satisfied (VerifiedCompliant ProposalAccount present on Solana).
 */
export async function requestCosignature(
  _config: DwalletConfig,
  _dwalletId: Uint8Array,
  _txPayload: Uint8Array,
  _resultCommitment: Uint8Array,
): Promise<Uint8Array> {
  // TODO(PR-1)
  throw new Error("Not implemented — pending PR-1");
}
