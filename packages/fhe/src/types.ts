export interface PlaintextPosition {
  assetMint:   Uint8Array;
  size:        bigint;
  entryPrice:  bigint;
  protocol:    Uint8Array;
  openedAt:    number;
}

export interface PlaintextState {
  positions:         PlaintextPosition[];
  totalAumUsd:       bigint;
  dailyPnlBps:       number;
  openPositionCount: number;
}

export interface ActionIntent {
  type:     "swap" | "deposit" | "withdraw" | "rebalance";
  protocol: Uint8Array;
  assetIn:  Uint8Array;
  assetOut: Uint8Array;
  amount:   bigint;
}

export interface ComplianceProof {
  encryptedIntent:   Uint8Array;
  fheProof:          Uint8Array;
  resultCommitment:  Uint8Array;
}
