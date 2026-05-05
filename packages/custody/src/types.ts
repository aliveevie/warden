export interface DwalletConfig {
  /** Ika Network API base URL. */
  ikaApiBase: string;
  /** Ika network Ed25519 public key (devnet). */
  ikaNetworkKey: Uint8Array;
}

export interface DwalletSigningCondition {
  /** Solana program that must authorise each signing request. */
  enforcerProgramId: string;
  /** Minimum on-chain verification before Ika co-signs. */
  requiredProposalStatus: "VerifiedCompliant";
}

export interface CrossChainTx {
  chain:   "bitcoin" | "ethereum" | "solana";
  payload: Uint8Array;
}
