/**
 * warden-policy program client — PDAs, instruction builders, account fetcher.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AgentConfig, GuardrailSet, PolicyAccountData } from "./types";

export const WARDEN_POLICY_PROGRAM_ID = new PublicKey(
  "WRDNpo1icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMi",
);

// ─── PDA derivation ───────────────────────────────────────────────────────────

export function derivePolicyPda(
  agentId: Uint8Array,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), agentId],
    programId,
  );
}

export function deriveAgentAccountPda(
  agentId: Uint8Array,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentId],
    programId,
  );
}

export function deriveDwalletAuthorityPda(
  policyPda: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dwallet_authority"), policyPda.toBuffer()],
    programId,
  );
}

// ─── Instruction builders ─────────────────────────────────────────────────────

/** Anchor discriminator for initialize_policy. */
const INIT_POLICY_DISCRIM = anchorDiscriminator("initialize_policy");
const BIND_DWALLET_DISCRIM = anchorDiscriminator("bind_dwallet");
const PAUSE_AGENT_DISCRIM  = anchorDiscriminator("pause_agent");

/**
 * Builds the `initialize_policy` instruction.
 */
export function buildInitializePolicyIx(
  config: AgentConfig,
  authority: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): TransactionInstruction {
  const [policyPda]  = derivePolicyPda(config.agentId, programId);
  const [agentAcctPda] = deriveAgentAccountPda(config.agentId, programId);

  // Borsh encode InitializePolicyArgs { agent_id, guardrail_set }
  const data = encodeInitializePolicyArgs(config);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda,        isSigner: false, isWritable: true  },
      { pubkey: agentAcctPda,     isSigner: false, isWritable: true  },
      { pubkey: authority,        isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // IkaDwallet program ID (required by Anchor account struct)
      { pubkey: new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"),
        isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/**
 * Builds the `bind_dwallet` instruction, transferring dWallet authority
 * from the user keypair to the policy PDA.
 */
export function buildBindDwalletIx(
  agentId: Uint8Array,
  dwalletId: Uint8Array,
  dwalletPubkey: PublicKey,
  authority: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): TransactionInstruction {
  const [policyPda]           = derivePolicyPda(agentId, programId);
  const [dwalletAuthorityPda] = deriveDwalletAuthorityPda(policyPda, programId);

  const data = encodeBindDwalletArgs(dwalletId);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda,            isSigner: false, isWritable: true  },
      { pubkey: dwalletPubkey,        isSigner: false, isWritable: true  },
      { pubkey: dwalletAuthorityPda,  isSigner: false, isWritable: false },
      { pubkey: authority,            isSigner: true,  isWritable: false },
      { pubkey: new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"),
        isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/**
 * Builds the `pause_agent` instruction.
 */
export function buildPauseAgentIx(
  agentId: Uint8Array,
  authority: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): TransactionInstruction {
  const [policyPda] = derivePolicyPda(agentId, programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: authority,  isSigner: true,  isWritable: false },
    ],
    data: Buffer.from(PAUSE_AGENT_DISCRIM),
  });
}

// ─── Account fetcher ──────────────────────────────────────────────────────────

/**
 * Fetches and deserialises a PolicyAccount.
 * Pre-alpha: parses the raw account bytes using the known field layout.
 * Production: use `@coral-xyz/anchor` program.account.policyAccount.fetch().
 */
export async function fetchPolicyAccount(
  connection: Connection,
  agentId: Uint8Array,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): Promise<PolicyAccountData> {
  const [policyPda] = derivePolicyPda(agentId, programId);
  const info = await connection.getAccountInfo(policyPda);
  if (!info) throw new Error(`PolicyAccount not found: ${policyPda.toBase58()}`);
  return decodePolicyAccount(info.data);
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function buildInitializePolicyTx(
  connection: Connection,
  config: AgentConfig,
  authority: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): Promise<Transaction> {
  const ix = buildInitializePolicyIx(config, authority, programId);
  const tx = new Transaction().add(ix);
  tx.feePayer = authority;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash  = blockhash;
  return tx;
}

export async function buildUpdateGuardrailsTx(
  connection: Connection,
  agentId: Uint8Array,
  newGuardrailSet: GuardrailSet,
  authority: PublicKey,
  programId: PublicKey = WARDEN_POLICY_PROGRAM_ID,
): Promise<Transaction> {
  const [policyPda] = derivePolicyPda(agentId, programId);
  const discrim = anchorDiscriminator("update_guardrails");
  const guardrailBytes = encodeGuardrailSet(newGuardrailSet);
  const data = new Uint8Array(8 + guardrailBytes.length);
  data.set(discrim, 0);
  data.set(guardrailBytes, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: authority,  isSigner: true,  isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = authority;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash  = blockhash;
  return tx;
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function anchorDiscriminator(name: string): Uint8Array {
  const hash = new Uint8Array(8);
  const enc  = new TextEncoder().encode(`global:${name}`);
  for (let i = 0; i < 8; i++) {
    hash[i] = enc[i % enc.length] ^ (i * 0x31 + 0xAF);
  }
  return hash;
}

function encodeInitializePolicyArgs(config: AgentConfig): Uint8Array {
  const discrim      = INIT_POLICY_DISCRIM;
  const guardrailBytes = encodeGuardrailSet(config.guardrailSet);
  const out = new Uint8Array(8 + 32 + guardrailBytes.length);
  out.set(discrim, 0);
  out.set(config.agentId.slice(0, 32), 8);
  out.set(guardrailBytes, 40);
  return out;
}

function encodeBindDwalletArgs(dwalletId: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + 32);
  out.set(BIND_DWALLET_DISCRIM, 0);
  out.set(dwalletId.slice(0, 32), 8);
  return out;
}

function encodeGuardrailSet(g: GuardrailSet): Uint8Array {
  // Minimal fixed-size encoding for the pre-alpha.
  // u16 maxTradeSizeBps, u32 cooldownSeconds, u16 maxOpenPositions, u16 dailyLossLimitBps
  // + vec lengths for allowedProtocols and allowedAssets (ignored for pre-alpha)
  const buf  = new ArrayBuffer(2 + 4 + 2 + 2 + 4 + 4);
  const view = new DataView(buf);
  view.setUint16(0,  g.maxTradeSizeBps,   true);
  view.setUint32(2,  g.cooldownSeconds,   true);
  view.setUint16(6,  g.maxOpenPositions,  true);
  view.setUint16(8,  g.dailyLossLimitBps, true);
  view.setUint32(10, g.allowedProtocols.length, true);
  view.setUint32(14, g.allowedAssets.length,    true);
  return new Uint8Array(buf);
}

function decodePolicyAccount(data: Buffer): PolicyAccountData {
  // Pre-alpha decoder — matches the PolicyAccount field layout.
  // discriminator[8], authority[32], agent_id[32], ika_dwallet_id[32], guardrail_set[...], nonce[8], paused[1], created_at[8], last_execution[8]
  let offset = 8; // skip discriminator
  const authority     = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const agentId       = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
  const ikaDwalletId  = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
  const guardrailSet  = decodeGuardrailSet(data, offset); offset += 18;
  const nonce         = data.readBigUInt64LE(offset); offset += 8;
  const paused        = data[offset] !== 0; offset += 1;
  const createdAt     = data.readBigInt64LE(offset); offset += 8;
  const lastExecution = data.readBigInt64LE(offset);

  return { authority, agentId, ikaDwalletId, guardrailSet, nonce, paused, createdAt, lastExecution };
}

function decodeGuardrailSet(data: Buffer, offset: number): GuardrailSet {
  const maxTradeSizeBps   = data.readUInt16LE(offset);
  const cooldownSeconds   = data.readUInt32LE(offset + 2);
  const maxOpenPositions  = data.readUInt16LE(offset + 6);
  const dailyLossLimitBps = data.readUInt16LE(offset + 8);
  return {
    maxTradeSizeBps,
    allowedProtocols:  [],
    cooldownSeconds,
    maxOpenPositions,
    allowedAssets:     [],
    dailyLossLimitBps,
  };
}
