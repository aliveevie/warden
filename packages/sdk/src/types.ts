import { PublicKey } from "@solana/web3.js";

export interface GuardrailSet {
  maxTradeSizeBps:   number;
  allowedProtocols:  PublicKey[];
  cooldownSeconds:   number;
  maxOpenPositions:  number;
  allowedAssets:     PublicKey[];
  dailyLossLimitBps: number;
}

export interface AgentConfig {
  agentId:      Uint8Array;
  guardrailSet: GuardrailSet;
}

export interface PolicyAccountData {
  authority:      PublicKey;
  agentId:        Uint8Array;
  ikaDwalletId:   Uint8Array;
  guardrailSet:   GuardrailSet;
  nonce:          bigint;
  paused:         boolean;
  createdAt:      bigint;
  lastExecution:  bigint;
}
