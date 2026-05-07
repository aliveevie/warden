/** Ika Network gRPC connection settings. */
export interface DwalletConfig {
  /** gRPC endpoint of the Ika pre-alpha network, e.g. "https://devnet.ika.xyz:443". */
  ikaGrpcEndpoint: string;
  /** REST API endpoint for status polling, e.g. "https://devnet.ika.xyz". */
  ikaApiBase: string;
  /** Ika network public key (devnet, 32 bytes). */
  ikaNetworkKey: Uint8Array;
}

/** On-chain signing condition registered with the dWallet. */
export interface DwalletSigningCondition {
  /**
   * Solana program (warden-policy) that must have emitted ProposalAuthorized
   * for this dWalletId before the Ika Network will produce its share.
   */
  enforcerProgramId: string;
  /** The Ika dWallet must see VerifiedCompliant before co-signing. */
  requiredProposalStatus: "VerifiedCompliant";
}

/** A transaction payload ready to be co-signed by the Ika Network. */
export interface CrossChainTx {
  chain:   "bitcoin" | "ethereum" | "solana";
  /** Raw serialised transaction (PSBT bytes for Bitcoin, RLP for Ethereum). */
  payload: Uint8Array;
}

/** 2PC key generation result returned by the Ika Network. */
export interface DwalletKeyShare {
  /** Ika dWallet network ID — stored in PolicyAccount.ika_dwallet_id. */
  dwalletId: Uint8Array;
  /** User's local key share (secret — never sent to Ika). */
  localShare: Uint8Array;
  /** Compressed public key on the target curve (33 bytes for secp256k1). */
  publicKey: Uint8Array;
}

/** Result of a co-signature request. */
export interface CosignatureResult {
  /** Combined signature (64 bytes: r || s for secp256k1). */
  signature: Uint8Array;
  /** Recovery ID (0 or 1) — used for Ethereum v computation. */
  recoveryId: number;
}
