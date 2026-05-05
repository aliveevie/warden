import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AgentConfig } from "./types";

/**
 * High-level agent lifecycle manager.
 * All methods return fully-constructed transactions ready for signing.
 * Full implementation delivered in PR-1 (Ika + Encrypt).
 */
export class WardenAgent {
  constructor(
    private readonly connection: Connection,
    private readonly programIds: {
      policy:     PublicKey;
      fheState:   PublicKey;
      settlement: PublicKey;
    },
  ) {}

  /**
   * Deploys a new policy and agent account pair on-chain.
   */
  async deploy(_config: AgentConfig, _authority: PublicKey): Promise<Transaction> {
    // TODO(PR-1)
    throw new Error("Not implemented — pending PR-1");
  }

  /**
   * Binds an Ika dWallet to the agent's policy.
   */
  async bindDwallet(_agentId: Uint8Array, _dwalletId: Uint8Array, _authority: PublicKey): Promise<Transaction> {
    // TODO(PR-1)
    throw new Error("Not implemented — pending PR-1");
  }

  /**
   * Immediately pauses the agent.
   */
  async pause(_agentId: Uint8Array, _authority: PublicKey): Promise<Transaction> {
    // TODO(PR-1)
    throw new Error("Not implemented — pending PR-1");
  }

  /**
   * Resumes a paused agent with Ika co-authorization.
   */
  async resume(_agentId: Uint8Array, _ikaCosig: Uint8Array, _authority: PublicKey): Promise<Transaction> {
    // TODO(PR-1)
    throw new Error("Not implemented — pending PR-1");
  }
}
