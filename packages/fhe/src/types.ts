/** A single open position held by the agent. */
export interface PlaintextPosition {
  /** SPL mint address (32 bytes). */
  assetMint:   Uint8Array;
  /** Position size in the asset's native units (scaled ×10^6). */
  size:        bigint;
  /** Entry price in USD (scaled ×10^6). */
  entryPrice:  bigint;
  /** On-chain protocol address (Drift, Marginfi, Kamino, etc.). */
  protocol:    Uint8Array;
  /** Unix timestamp when the position was opened. */
  openedAt:    number;
}

/**
 * Complete agent position state — encrypted and stored in EncryptedStateAccount.
 *
 * Values used in the compliance graph:
 *   trade_size_bps  = (proposedTradeSize / totalAumUsd) × 10_000
 *   daily_loss_bps  = |dailyPnlBps| when negative, else 0
 *   open_positions  = positions.length
 */
export interface PlaintextState {
  positions:          PlaintextPosition[];
  /** Total assets under management in USD (scaled ×10^6). */
  totalAumUsd:        bigint;
  /** Daily profit/loss in basis points (negative = loss). */
  dailyPnlBps:        number;
  /** Snapshot timestamp for staleness checks. */
  snapshotAt:         number;
}

/** An action the agent wants to execute on-chain. */
export interface ActionIntent {
  type:     "swap" | "deposit" | "withdraw" | "rebalance";
  /** Target protocol (Drift program address, etc.). */
  protocol: Uint8Array;
  /** Input asset mint. */
  assetIn:  Uint8Array;
  /** Output asset mint. */
  assetOut: Uint8Array;
  /** Trade amount in assetIn units (scaled ×10^6). */
  amount:   bigint;
  /** Minimum output amount for slippage protection. */
  minAmountOut: bigint;
}

/**
 * The three artefacts produced by the local REFHE prover.
 * All are safe to publish on-chain.
 */
export interface ComplianceProof {
  /** AES-GCM-encrypted ActionIntent under the Encrypt network public key. */
  encryptedIntent:   Uint8Array;
  /** REFHE ZK proof binding the encrypted intent to the guardrail predicates. */
  fheProof:          Uint8Array;
  /** Pedersen commitment to the plaintext action (used for Ika co-signature). */
  resultCommitment:  Uint8Array;
}

/** Ciphertext handles registered with the Encrypt network for one proposal. */
export interface ComplianceGraphInputHandles {
  tradeSizeBpsHandle: Uint8Array;  // 32 bytes
  dailyLossBpsHandle: Uint8Array;
  openPositionsHandle: Uint8Array;
  maxTradeBpsHandle:  Uint8Array;
  lossLimitBpsHandle: Uint8Array;
  maxOpenPosHandle:   Uint8Array;
}

/** Guardrail thresholds read from PolicyAccount. */
export interface GuardrailThresholds {
  maxTradeBps:      bigint;
  lossLimitBps:     bigint;
  maxOpenPositions: bigint;
}
