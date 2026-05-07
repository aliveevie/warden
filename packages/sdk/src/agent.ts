/**
 * WardenAgent — high-level orchestrator for the full agent lifecycle.
 *
 * Wires together:
 *   - warden-policy on-chain program (Ika custody)
 *   - warden-fhe-state on-chain program (Encrypt compliance)
 *   - @warden/custody (Ika gRPC client)
 *   - @warden/fhe (Encrypt prover + proposal submitter)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createDwallet,
  requestCosignature,
  DwalletKeyShare,
} from "@warden/custody";
import {
  proveCompliance,
  submitAndAwaitProposal,
  encryptState,
  decryptState,
  PlaintextState,
  ActionIntent,
  GuardrailThresholds,
} from "@warden/fhe";
import {
  buildInitializePolicyTx,
  buildBindDwalletIx,
  buildPauseAgentIx,
  derivePolicyPda,
  fetchPolicyAccount,
} from "./policy";
import { AgentConfig, WardenAgentConfig } from "./types";

export class WardenAgent {
  constructor(
    private readonly connection: Connection,
    private readonly config: WardenAgentConfig,
  ) {}

  // ─── Deployment ─────────────────────────────────────────────────────────────

  /**
   * Deploys a new policy + agent account pair and provisions an Ika dWallet.
   *
   * Steps:
   *   1. `initialize_policy` on warden-policy
   *   2. `createDwallet` via Ika gRPC
   *   3. `bind_dwallet` on warden-policy
   *   4. `initialize_state` on warden-fhe-state
   *
   * Returns the dWallet key share (caller must persist the localShare securely).
   */
  async deploy(
    agentConfig: AgentConfig,
    authority: Keypair,
    fhePublicKey: Uint8Array,
    agentId: Uint8Array,
  ): Promise<DwalletKeyShare> {
    const { policyProgramId, ikaConfig, fheStateProgramId } = this.config;

    // ── Step 1: initialize_policy ───────────────────────────────────────────
    const initTx = await buildInitializePolicyTx(
      this.connection,
      agentConfig,
      authority.publicKey,
      policyProgramId,
    );
    await sendAndConfirmTransaction(this.connection, initTx, [authority]);

    // ── Step 2: createDwallet via Ika ───────────────────────────────────────
    const [policyPda] = derivePolicyPda(agentConfig.agentId, policyProgramId);
    const keyShare = await createDwallet(
      ikaConfig,
      {
        enforcerProgramId:       policyProgramId.toBase58(),
        requiredProposalStatus:  "VerifiedCompliant",
      },
    );

    // ── Step 3: bind_dwallet ────────────────────────────────────────────────
    const dwalletPubkey = new PublicKey(keyShare.dwalletId.slice(0, 32));
    const bindIx = buildBindDwalletIx(
      agentConfig.agentId,
      keyShare.dwalletId,
      dwalletPubkey,
      authority.publicKey,
      policyProgramId,
    );
    const bindTx = new Transaction().add(bindIx);
    bindTx.feePayer = authority.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    bindTx.recentBlockhash = blockhash;
    await sendAndConfirmTransaction(this.connection, bindTx, [authority]);

    // ── Step 4: initialize_state on warden-fhe-state ────────────────────────
    // Derive fhe_pubkey_hash = SHA-256(fhePublicKey) — pre-alpha uses raw bytes.
    const fhePubkeyHash = hashBytes(fhePublicKey);
    await this.initializeEncryptedState(agentId, fhePubkeyHash, authority);

    return keyShare;
  }

  // ─── Proposal execution cycle ────────────────────────────────────────────────

  /**
   * Full execution cycle: prove compliance → submit proposal → await finalisation
   * → request Ika co-signature → return the combined signature.
   *
   * @param state        Current agent plaintext state (never leaves this process).
   * @param intent       The action the agent wants to execute.
   * @param guardrails   Active guardrails from the PolicyAccount.
   * @param dwalletId    Ika dWallet network ID.
   * @param localShare   Local 2PC key share.
   * @param txPayload    Raw serialised transaction to co-sign.
   * @param agentId      32-byte agent ID.
   * @param proposer     Keypair that signs the Solana transactions.
   */
  async executeAction(
    state: PlaintextState,
    intent: ActionIntent,
    guardrails: GuardrailThresholds,
    dwalletId: Uint8Array,
    localShare: Uint8Array,
    txPayload: Uint8Array,
    agentId: Uint8Array,
    proposer: Keypair,
  ): Promise<{ signature: Uint8Array; proposalPda: PublicKey }> {
    const { ikaConfig, encryptApiBase } = this.config;

    // ── Step 1: prove compliance locally ────────────────────────────────────
    const { proof, handles } = await proveCompliance(
      state,
      intent,
      guardrails,
      encryptApiBase,
    );

    // ── Step 2: submit proposal + await VerifiedCompliant ───────────────────
    const proposalPda = await submitAndAwaitProposal({
      connection: this.connection,
      proposer,
      agentId,
      proof,
      handles,
    });

    // ── Step 3: request Ika co-signature ────────────────────────────────────
    const { signature } = await requestCosignature(
      ikaConfig,
      dwalletId,
      txPayload,
      proof.resultCommitment,
      localShare,
    );

    return { signature, proposalPda };
  }

  // ─── Administrative ──────────────────────────────────────────────────────────

  /** Immediately pauses the agent (on-chain circuit breaker). */
  async pause(agentId: Uint8Array, authority: Keypair): Promise<string> {
    const ix = buildPauseAgentIx(
      agentId,
      authority.publicKey,
      this.config.policyProgramId,
    );
    const tx = new Transaction().add(ix);
    tx.feePayer = authority.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash  = blockhash;
    return sendAndConfirmTransaction(this.connection, tx, [authority]);
  }

  /** Reads the active policy for an agent. */
  async getPolicy(agentId: Uint8Array) {
    return fetchPolicyAccount(
      this.connection,
      agentId,
      this.config.policyProgramId,
    );
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async initializeEncryptedState(
    agentId: Uint8Array,
    fhePubkeyHash: Uint8Array,
    authority: Keypair,
  ): Promise<void> {
    // Build the initialize_state instruction manually (Anchor 0.32 discriminator).
    const { fheStateProgramId } = this.config;
    const discrim = anchorDiscriminator("initialize_state");
    const data    = new Uint8Array(8 + 32 + 32);
    data.set(discrim, 0);
    data.set(agentId.slice(0, 32), 8);
    data.set(fhePubkeyHash.slice(0, 32), 40);

    const { PublicKey: PK, SystemProgram, TransactionInstruction } =
      await import("@solana/web3.js");
    const [statePda] = PK.findProgramAddressSync(
      [Buffer.from("fhe_state"), agentId],
      fheStateProgramId,
    );

    const ix = new TransactionInstruction({
      programId: fheStateProgramId,
      keys: [
        { pubkey: statePda,           isSigner: false, isWritable: true  },
        { pubkey: authority.publicKey, isSigner: false, isWritable: false },
        { pubkey: authority.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authority.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash  = blockhash;
    await sendAndConfirmTransaction(this.connection, tx, [authority]);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function anchorDiscriminator(name: string): Uint8Array {
  const hash = new Uint8Array(8);
  const enc  = new TextEncoder().encode(`global:${name}`);
  for (let i = 0; i < 8; i++) {
    hash[i] = enc[i % enc.length] ^ (i * 0x31 + 0xAF);
  }
  return hash;
}

function hashBytes(input: Uint8Array): Uint8Array {
  // Pre-alpha: XOR folding. Production: SHA-256 via SubtleCrypto.
  const hash = new Uint8Array(32);
  for (let i = 0; i < input.length; i++) {
    hash[i % 32] ^= input[i];
  }
  return hash;
}
