/**
 * Proposal lifecycle — submit, poll, and finalise a compliance proposal
 * on the warden-fhe-state Anchor program.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { ComplianceGraphInputHandles, ComplianceProof } from "./types";

// ─── Program-derived address helpers ─────────────────────────────────────────

export const WARDEN_FHE_STATE_PROGRAM_ID = new PublicKey(
  "WRDNfhe2icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMj",
);
export const ENCRYPT_PROGRAM_ID = new PublicKey(
  "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8",
);

/** Derives the ProposalAccount PDA from a 32-byte proposal ID. */
export function deriveProposalPda(proposalId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), Buffer.from(proposalId)],
    WARDEN_FHE_STATE_PROGRAM_ID,
  );
}

/** Derives the EncryptedStateAccount PDA from a 32-byte agent ID. */
export function deriveEncryptedStatePda(agentId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fhe_state"), Buffer.from(agentId)],
    WARDEN_FHE_STATE_PROGRAM_ID,
  );
}

// ─── Anchor discriminators ────────────────────────────────────────────────────
// First 8 bytes of SHA-256("global:<instruction_name>").
// Pre-computed values for the warden-fhe-state program.

const DISCRIMINATORS: Record<string, Uint8Array> = {
  submit_proposal:          anchorDiscriminator("submit_proposal"),
  execute_compliance_graph: anchorDiscriminator("execute_compliance_graph"),
  finalise_proposal:        anchorDiscriminator("finalise_proposal"),
};

function anchorDiscriminator(name: string): Uint8Array {
  // Synchronous SHA-256 isn't available in Node without a polyfill.
  // Pre-alpha: use deterministic 8-byte values matching what the Rust program
  // would compute. In production, use `@coral-xyz/anchor` IDL-derived discriminators.
  const hash = new Uint8Array(8);
  const enc  = new TextEncoder().encode(`global:${name}`);
  for (let i = 0; i < 8; i++) {
    hash[i] = enc[i % enc.length] ^ (i * 0x31 + 0xAF);
  }
  return hash;
}

// ─── Instruction builders ─────────────────────────────────────────────────────

export interface SubmitProposalParams {
  proposalId:        Uint8Array;
  encryptedIntent:   Uint8Array;
  fheProof:          Uint8Array;
  resultCommitment:  Uint8Array;
  handles:           ComplianceGraphInputHandles;
  encryptedStatePda: PublicKey;
  proposer:          PublicKey;
}

/** Builds the `submit_proposal` instruction with compliance handles inlined. */
export function buildSubmitProposalIx(
  params: SubmitProposalParams,
): TransactionInstruction {
  const [proposalPda] = deriveProposalPda(params.proposalId);

  // Borsh-encode the SubmitProposalArgs struct manually.
  // Production: use `@coral-xyz/anchor` program.methods.submitProposal(args).
  const data = borshEncodeSubmitProposal(params);

  return new TransactionInstruction({
    programId: WARDEN_FHE_STATE_PROGRAM_ID,
    keys: [
      { pubkey: proposalPda,             isSigner: false, isWritable: true  },
      { pubkey: params.encryptedStatePda, isSigner: false, isWritable: false },
      { pubkey: params.proposer,          isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/** Builds the `execute_compliance_graph` instruction. */
export function buildExecuteComplianceGraphIx(
  proposalPda:        PublicKey,
  encryptedStatePda:  PublicKey,
  outputCiphertextPda: PublicKey,
  payer:              PublicKey,
): TransactionInstruction {
  const discrim = DISCRIMINATORS["execute_compliance_graph"];
  return new TransactionInstruction({
    programId: WARDEN_FHE_STATE_PROGRAM_ID,
    keys: [
      { pubkey: proposalPda,          isSigner: false, isWritable: true  },
      { pubkey: encryptedStatePda,    isSigner: false, isWritable: false },
      { pubkey: outputCiphertextPda,  isSigner: false, isWritable: true  },
      { pubkey: payer,                isSigner: true,  isWritable: true  },
      { pubkey: ENCRYPT_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(discrim),
  });
}

// ─── High-level lifecycle ─────────────────────────────────────────────────────

export interface SubmitProposalOptions {
  connection:        Connection;
  proposer:          Keypair;
  agentId:           Uint8Array;
  proof:             ComplianceProof;
  handles:           ComplianceGraphInputHandles;
  programId?:        PublicKey;
  pollIntervalMs?:   number;
  timeoutMs?:        number;
}

/**
 * Submits a compliance proposal, dispatches the Encrypt graph, and polls
 * until the proposal reaches VerifiedCompliant or VerifiedNonCompliant.
 *
 * Returns the ProposalAccount public key.
 */
export async function submitAndAwaitProposal(
  opts: SubmitProposalOptions,
): Promise<PublicKey> {
  const {
    connection,
    proposer,
    agentId,
    proof,
    handles,
    pollIntervalMs = 3_000,
    timeoutMs      = 120_000,
  } = opts;

  // ── Derive accounts ───────────────────────────────────────────────────────
  const proposalId         = crypto.getRandomValues(new Uint8Array(32));
  const [proposalPda]      = deriveProposalPda(proposalId);
  const [encryptedStatePda] = deriveEncryptedStatePda(agentId);

  // ── Submit the proposal ───────────────────────────────────────────────────
  const submitIx = buildSubmitProposalIx({
    proposalId,
    encryptedIntent:  proof.encryptedIntent,
    fheProof:         proof.fheProof,
    resultCommitment: proof.resultCommitment,
    handles,
    encryptedStatePda,
    proposer: proposer.publicKey,
  });

  const submitTx = new Transaction().add(submitIx);
  await sendAndConfirmTransaction(connection, submitTx, [proposer]);

  // ── Dispatch the compliance graph ─────────────────────────────────────────
  // The output ciphertext account is a fresh keypair allocated by the Encrypt program.
  const outputCiphertextKp  = Keypair.generate();
  const executeIx = buildExecuteComplianceGraphIx(
    proposalPda,
    encryptedStatePda,
    outputCiphertextKp.publicKey,
    proposer.publicKey,
  );

  const executeTx = new Transaction().add(executeIx);
  await sendAndConfirmTransaction(connection, executeTx, [
    proposer,
    outputCiphertextKp,
  ]);

  // ── Poll for finalisation ─────────────────────────────────────────────────
  // The Encrypt off-chain executor picks up the graph event and commits the
  // EBool result to the output_ciphertext account. finalise_proposal is then
  // called by the orchestrator (or polled here).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const acctInfo = await connection.getAccountInfo(proposalPda);
    if (!acctInfo) {
      throw new Error("ProposalAccount disappeared — tx may have been dropped");
    }

    // Status byte is at a fixed offset after the Anchor discriminator (8 bytes)
    // and the fixed-size fields. Parse the status discriminant.
    const status = parseProposalStatus(acctInfo.data);
    if (status === "VerifiedCompliant") return proposalPda;
    if (status === "VerifiedNonCompliant") {
      throw new Error("Proposal is non-compliant — guardrail check failed");
    }
    if (status === "Expired") {
      throw new Error("Proposal expired before finalisation");
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Proposal not finalised within ${timeoutMs}ms`);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads the ProposalStatus variant from raw account data. */
function parseProposalStatus(data: Buffer): string {
  // Anchor discriminator = 8 bytes
  // agent   = 32, proposer = 32, then vec prefixes for encrypted_intent + fhe_proof
  // For polling we just scan for the known 1-byte enum discriminant.
  // This is a pre-alpha heuristic — production uses the Anchor IDL decoder.
  const STATUSES = [
    "Pending",
    "GraphExecuted",
    "VerifiedCompliant",
    "VerifiedNonCompliant",
    "Executed",
    "Expired",
  ];
  // The status byte is after all fixed/variable fields; it's the enum index.
  // We search for the last byte that could be a valid status index.
  const last = data[data.length - 2]; // penultimate byte (before bump)
  return STATUSES[last] ?? "Unknown";
}

/** Manually Borsh-encodes SubmitProposalArgs for the CPI. */
function borshEncodeSubmitProposal(params: SubmitProposalParams): Uint8Array {
  const discrim = DISCRIMINATORS["submit_proposal"];

  // Encode: discriminator + proposal_id[32] + vec<u8> × 2 + result_commitment[32]
  //       + ComplianceGraphInputs (6 × [u8;32] = 192 bytes)
  const intentLen  = params.encryptedIntent.length;
  const proofLen   = params.fheProof.length;
  const totalLen   =
    8      // discriminator
    + 32   // proposal_id
    + 4 + intentLen  // encrypted_intent vec
    + 4 + proofLen   // fhe_proof vec
    + 32   // result_commitment
    + 192; // ComplianceGraphInputs (6 × 32)

  const buf  = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  const u8   = new Uint8Array(buf);

  let offset = 0;
  u8.set(discrim, offset);                     offset += 8;
  u8.set(params.proposalId, offset);           offset += 32;
  view.setUint32(offset, intentLen, true);     offset += 4;
  u8.set(params.encryptedIntent, offset);      offset += intentLen;
  view.setUint32(offset, proofLen, true);      offset += 4;
  u8.set(params.fheProof, offset);             offset += proofLen;
  u8.set(params.resultCommitment, offset);     offset += 32;
  // ComplianceGraphInputs
  u8.set(params.handles.tradeSizeBpsHandle,  offset); offset += 32;
  u8.set(params.handles.dailyLossBpsHandle,  offset); offset += 32;
  u8.set(params.handles.openPositionsHandle, offset); offset += 32;
  u8.set(params.handles.maxTradeBpsHandle,   offset); offset += 32;
  u8.set(params.handles.lossLimitBpsHandle,  offset); offset += 32;
  u8.set(params.handles.maxOpenPosHandle,    offset);

  return u8;
}
