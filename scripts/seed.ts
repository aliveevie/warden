/**
 * Seeds a test agent on devnet for development and manual testing.
 *
 * Initialises:
 *   - PolicyAccount with conservative test guardrails
 *   - EncryptedStateAccount (empty initial state)
 *
 * Prerequisites:
 *   - SOLANA_RPC_URL set in .env (defaults to devnet)
 *   - PRINCIPAL_KEYPAIR_PATH pointing to a funded keypair JSON file
 *
 * Usage:
 *   npx ts-node scripts/seed.ts
 *   npx ts-node scripts/seed.ts --localnet
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
import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const isLocalnet = args.includes("--localnet");

const RPC_URL = isLocalnet
  ? "http://localhost:8899"
  : (process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");

const KEYPAIR_PATH = process.env.PRINCIPAL_KEYPAIR_PATH
  ?? path.join(__dirname, "../keys/principal.json");

const POLICY_PROGRAM_ID    = new PublicKey(
  process.env.WARDEN_POLICY_PROGRAM_ID ?? "WRDNpo1icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMi",
);
const FHE_STATE_PROGRAM_ID = new PublicKey(
  process.env.WARDEN_FHE_STATE_PROGRAM_ID ?? "WRDNfheState111T2BpnmFYQBkzH1jEA3E6W3HmPuMj",
);
const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");

// Conservative test guardrails
const TEST_GUARDRAILS = {
  maxTradeSizeBps:   300,  // 3% max trade
  dailyLossLimitBps: 150,  // 1.5% daily loss limit
  maxOpenPositions:  3,
  cooldownSeconds:   30,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function anchorDiscriminator(name: string): Uint8Array {
  const hash = new Uint8Array(8);
  const enc  = new TextEncoder().encode(`global:${name}`);
  for (let i = 0; i < 8; i++) hash[i] = enc[i % enc.length] ^ (i * 0x31 + 0xAF);
  return hash;
}

function derivePda(seeds: (string | Uint8Array)[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : Buffer.from(s))),
    programId,
  );
}

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nWarden seed script`);
  console.log(`  Network:  ${isLocalnet ? "localnet" : "devnet"}`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Keypair:  ${KEYPAIR_PATH}\n`);

  // ── Load signer ────────────────────────────────────────────────────────────
  if (!fs.existsSync(KEYPAIR_PATH)) {
    console.error(`Keypair not found: ${KEYPAIR_PATH}`);
    console.error("Generate one with: solana-keygen new -o keys/principal.json");
    process.exit(1);
  }

  const authority  = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Balance:   ${(balance / 1e9).toFixed(4)} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.error("Insufficient balance — need at least 0.1 SOL for account rent.");
    if (isLocalnet) {
      console.error("Run: solana airdrop 2 --url localhost");
    } else {
      console.error("Run: solana airdrop 2 --url devnet");
    }
    process.exit(1);
  }

  // ── Generate agent ID ──────────────────────────────────────────────────────
  const agentId       = crypto.getRandomValues(new Uint8Array(32));
  const agentIdHex    = Buffer.from(agentId).toString("hex");
  const [policyPda]    = derivePda(["policy",    agentId], POLICY_PROGRAM_ID);
  const [agentAcctPda] = derivePda(["agent",     agentId], POLICY_PROGRAM_ID);
  const [statePda]     = derivePda(["fhe_state", agentId], FHE_STATE_PROGRAM_ID);

  console.log(`Agent ID:   ${agentIdHex}`);
  console.log(`Policy PDA: ${policyPda.toBase58()}`);
  console.log(`State PDA:  ${statePda.toBase58()}\n`);

  // ── Step 1: initialize_policy ─────────────────────────────────────────────
  console.log("Step 1/2: initialize_policy...");

  const policyData = new Uint8Array(8 + 32 + 18);
  policyData.set(anchorDiscriminator("initialize_policy"), 0);
  policyData.set(agentId, 8);
  const gv = new DataView(policyData.buffer, 40);
  gv.setUint16(0,  TEST_GUARDRAILS.maxTradeSizeBps,   true);
  gv.setUint32(2,  TEST_GUARDRAILS.cooldownSeconds,   true);
  gv.setUint16(6,  TEST_GUARDRAILS.maxOpenPositions,  true);
  gv.setUint16(8,  TEST_GUARDRAILS.dailyLossLimitBps, true);
  gv.setUint32(10, 0, true); // allowedProtocols
  gv.setUint32(14, 0, true); // allowedAssets

  const policyIx = new TransactionInstruction({
    programId: POLICY_PROGRAM_ID,
    keys: [
      { pubkey: policyPda,    isSigner: false, isWritable: true  },
      { pubkey: agentAcctPda, isSigner: false, isWritable: true  },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: IKA_PROGRAM_ID,          isSigner: false, isWritable: false },
    ],
    data: Buffer.from(policyData),
  });

  const policyTx = new Transaction().add(policyIx);
  const policySig = await sendAndConfirmTransaction(connection, policyTx, [authority]);
  console.log(`  ✓ ${policySig}\n`);

  // ── Step 2: initialize_state ──────────────────────────────────────────────
  console.log("Step 2/2: initialize_state...");

  const fhePubkeyHash = crypto.getRandomValues(new Uint8Array(32));
  const stateData     = new Uint8Array(8 + 32 + 32);
  stateData.set(anchorDiscriminator("initialize_state"), 0);
  stateData.set(agentId, 8);
  stateData.set(fhePubkeyHash, 40);

  const stateIx = new TransactionInstruction({
    programId: FHE_STATE_PROGRAM_ID,
    keys: [
      { pubkey: statePda,            isSigner: false, isWritable: true  },
      { pubkey: authority.publicKey, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(stateData),
  });

  const stateTx  = new Transaction().add(stateIx);
  const stateSig = await sendAndConfirmTransaction(connection, stateTx, [authority]);
  console.log(`  ✓ ${stateSig}\n`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("── Seed complete ──────────────────────────────────");
  console.log(`Agent ID:       ${agentIdHex}`);
  console.log(`Policy PDA:     ${policyPda.toBase58()}`);
  console.log(`State PDA:      ${statePda.toBase58()}`);
  console.log(`FHE pubkey hash: ${Buffer.from(fhePubkeyHash).toString("hex")}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Set AGENT_ID=" + agentIdHex + " in your .env");
  console.log("  2. Run `npx ts-node scripts/bind-dwallet.ts` to provision the Ika dWallet");
  console.log("  3. Open http://localhost:3000/monitor to watch live proposals");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
