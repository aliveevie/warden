import { PublicKey } from "@solana/web3.js";
import { DwalletConfig } from "@warden/custody";

export interface GuardrailSet {
  /** Maximum trade size as a fraction of AUM, in basis points (e.g. 500 = 5%). */
  maxTradeSizeBps:   number;
  /** Allowed on-chain protocol program IDs (Drift, Marginfi, Kamino…). */
  allowedProtocols:  PublicKey[];
  /** Minimum seconds between consecutive authorised executions. */
  cooldownSeconds:   number;
  /** Maximum number of concurrent open positions. */
  maxOpenPositions:  number;
  /** Allowed asset mints (SPL). Empty = all allowed. */
  allowedAssets:     PublicKey[];
  /** Maximum daily loss before the agent is automatically paused. */
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

export interface WardenAgentConfig {
  /** warden-policy program ID. */
  policyProgramId:   PublicKey;
  /** warden-fhe-state program ID. */
  fheStateProgramId: PublicKey;
  /** Ika network connection config. */
  ikaConfig:         DwalletConfig;
  /** Encrypt pre-alpha API endpoint. */
  encryptApiBase:    string;
}
