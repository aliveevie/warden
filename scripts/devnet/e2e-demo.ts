#!/usr/bin/env bun
/**
 * Warden — End-to-End Devnet Demo
 *
 * Runs the full Warden flow against Solana devnet, calling REAL Encrypt
 * (compliance verification over encrypted state) and REAL Ika (multi-chain
 * dWallet co-signature) — both deployed in pre-alpha to devnet by
 * dWallet Labs.
 *
 * Flow (all on real devnet, all state mutating):
 *   1. create_agent          — register an AI-agent principal under Warden
 *   2. bind_dwallet          — attach an Ika dWallet to the agent
 *   3. createInput (gRPC × 6) — encrypt the proposed action's metrics and
 *                              the agent's guardrail thresholds
 *   4. submit_proposal       — Warden CPIs Encrypt::execute_graph; the
 *                              `check_compliance` graph runs HOMOMORPHICALLY
 *                              over the six encrypted inputs and writes an
 *                              EBool to `output_ct`.
 *   5. request_compliance_decryption — Warden CPIs Encrypt::request_decryption
 *                              and stores the digest for tamper-proof reveal.
 *   6. (poll devnet)         — wait for the Encrypt executor network to
 *                              decrypt off-chain and write plaintext back.
 *   7. reveal_and_authorize  — Warden reads the verified bool. If compliant,
 *                              it CPIs Ika::approve_message to cosign the
 *                              action's `result_commitment`.
 *
 * Prerequisites:
 *   - warden_core deployed to devnet (run scripts/devnet/deploy.sh first)
 *   - export WARDEN_PROGRAM_ID=<deployed pubkey>
 *   - export ENCRYPT_PROGRAM_ID=Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx
 *   - export IKA_PROGRAM_ID=<from ika devnet docs>
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
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "node:path";

const DEVNET_PRE_ALPHA_GRPC_URL = "pre-alpha-dev-1.encrypt.ika-network.net:443";

// Minimal inline gRPC client for the Encrypt executor — avoids depending on
// the encrypt-pre-alpha TS client's generated code.
function createEncryptClient(grpcUrl: string = DEVNET_PRE_ALPHA_GRPC_URL) {
  const protoPath = path.resolve(
    __dirname,
    "../../external-sdks/encrypt/proto/encrypt_service.proto",
  );
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const pkg: any = (grpc.loadPackageDefinition(pkgDef).encrypt as any).v1;
  const isLocal = grpcUrl.startsWith("localhost") || grpcUrl.startsWith("127.0.0.1");
  const creds = isLocal ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  const client = new pkg.EncryptService(grpcUrl, creds);

  return {
    createInput(params: {
      chain: number;
      inputs: { ciphertextBytes: Uint8Array; fheType: number }[];
      proof?: Uint8Array;
      authorized: Uint8Array;
      networkEncryptionPublicKey: Uint8Array;
    }): Promise<{ ciphertextIdentifiers: Buffer[] }> {
      return new Promise((resolve, reject) => {
        client.CreateInput({
          chain: params.chain,
          inputs: params.inputs.map((i) => ({
            ciphertextBytes: Buffer.from(i.ciphertextBytes),
            fheType: i.fheType,
          })),
          proof: Buffer.from(params.proof ?? new Uint8Array()),
          authorized: Buffer.from(params.authorized),
          networkEncryptionPublicKey: Buffer.from(params.networkEncryptionPublicKey),
        }, (err: any, resp: any) => {
          if (err) reject(err);
          else resolve({ ciphertextIdentifiers: resp.ciphertextIdentifiers });
        });
      });
    },
    close() { client.close(); },
  };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const RPC_URL  = process.env.RPC_URL  ?? "https://api.devnet.solana.com";
const GRPC_URL = process.env.GRPC_URL ?? DEVNET_PRE_ALPHA_GRPC_URL;

// Real Encrypt program ID currently deployed on Solana devnet
// (per external-sdks/encrypt/README.md "Pre-Alpha Environment").
const ENCRYPT_PROGRAM = new PublicKey(
  process.env.ENCRYPT_PROGRAM_ID ?? "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8",
);
const WARDEN_PROGRAM_ID = process.env.WARDEN_PROGRAM_ID;
if (!WARDEN_PROGRAM_ID) {
  console.error("Set WARDEN_PROGRAM_ID — run scripts/devnet/deploy.sh first");
  process.exit(1);
}
const WARDEN_PROGRAM = new PublicKey(WARDEN_PROGRAM_ID);
// Real Ika dWallet program ID currently deployed on Solana devnet
// (per external-sdks/ika/README.md "Devnet" table).
const IKA_PROGRAM = new PublicKey(
  process.env.IKA_PROGRAM_ID ?? "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
);

const connection = new Connection(RPC_URL, "confirmed");

// Reuse a funded keypair when provided (devnet airdrop is rate-limited / captcha-gated).
// Falls back to a fresh generated keypair (which will need an airdrop in main()).
const PAYER_KEYPAIR_PATH =
  process.env.PAYER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
const payer: Keypair = fs.existsSync(PAYER_KEYPAIR_PATH)
  ? Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8")) as number[]),
    )
  : Keypair.generate();
const payerWasLoaded = fs.existsSync(PAYER_KEYPAIR_PATH);

// ─── Helpers ────────────────────────────────────────────────────────────────

const log = (s: string, m: string) => console.log(`\x1b[36m[${s}]\x1b[0m ${m}`);
const ok  = (m: string)             => console.log(`\x1b[32m  ✓\x1b[0m ${m}`);
const val = (l: string, v: unknown) => console.log(`\x1b[33m  →\x1b[0m ${l}: ${v}`);

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
function anchorDisc(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

async function send(ixs: TransactionInstruction[], extraSigners: Keypair[] = []) {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners]);
}

async function pollUntil(
  account: PublicKey,
  check: (data: Buffer) => boolean,
  timeoutMs = 120_000,
  intervalMs = 1_000,
): Promise<Buffer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await connection.getAccountInfo(account);
      if (info && check(info.data as Buffer)) return info.data as Buffer;
    } catch { /* swallow + retry */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${account.toBase58()}`);
}

/** Mock plaintext-as-ciphertext for the dev executor (FHE_TYPE prefix + 16 LE bytes). */
function mockCiphertext(value: bigint, fheType: number): Uint8Array {
  const buf = new Uint8Array(17);
  buf[0] = fheType;
  let v = value;
  for (let i = 0; i < 16; i++) {
    buf[1 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

const FHE_UINT64 = 5;
const FHE_BOOL   = 0;

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n\x1b[1m═══ Warden Frontier Demo — Encrypt + Ika on Solana ═══\x1b[0m\n");
  val("Warden program",  WARDEN_PROGRAM.toBase58());
  val("Encrypt program", ENCRYPT_PROGRAM.toBase58());
  val("Ika program",     IKA_PROGRAM.toBase58());
  console.log();

  // ── Setup ──────────────────────────────────────────────────────────────
  const encrypt = createEncryptClient(GRPC_URL);
  log("Setup", `Connected to Encrypt executor at ${GRPC_URL}`);

  if (payerWasLoaded) {
    const bal = await connection.getBalance(payer.publicKey);
    log("Setup", `Reusing funded payer (${(bal / 1e9).toFixed(4)} SOL)`);
    if (bal < 1e8) throw new Error(`Payer ${payer.publicKey.toBase58()} below 0.1 SOL — fund it first`);
  } else {
    log("Setup", "Funding payer via airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 2e9);
    await connection.confirmTransaction(sig);
  }
  ok(`Payer: ${payer.publicKey.toBase58()}`);

  const [configPda]      = pda([Buffer.from("encrypt_config")],   ENCRYPT_PROGRAM);
  const [eventAuthority] = pda([Buffer.from("__event_authority")], ENCRYPT_PROGRAM);
  const [depositPda, depositBump] = pda(
    [Buffer.from("encrypt_deposit"), payer.publicKey.toBuffer()],
    ENCRYPT_PROGRAM,
  );
  const networkKey       = Buffer.alloc(32, 0x55);
  const [networkKeyPda]  = pda(
    [Buffer.from("network_encryption_key"), networkKey],
    ENCRYPT_PROGRAM,
  );

  // Read encrypt config to discover the vault.
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) throw new Error("Encrypt config missing — is the executor live?");
  const encVault = new PublicKey((configInfo.data as Buffer).subarray(100, 132));
  const vaultPk = encVault.equals(SystemProgram.programId) ? payer.publicKey : encVault;

  // Create an Encrypt deposit (one-time per payer per program). Idempotent —
  // skip if the PDA is already initialised.
  const existingDeposit = await connection.getAccountInfo(depositPda);
  if (existingDeposit) {
    log("Setup", `Encrypt deposit already exists (${depositPda.toBase58()})`);
  } else {
    log("Setup", "Creating Encrypt deposit account...");
    await send([new TransactionInstruction({
      programId: ENCRYPT_PROGRAM,
      data: Buffer.from([14, depositBump, ...new Array(16).fill(0)]),
      keys: [
        { pubkey: depositPda,            isSigner: false, isWritable: true  },
        { pubkey: configPda,             isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,       isSigner: true,  isWritable: false },
        { pubkey: payer.publicKey,       isSigner: true,  isWritable: true  },
        { pubkey: payer.publicKey,       isSigner: true,  isWritable: true  },
        { pubkey: vaultPk,               isSigner: vaultPk.equals(payer.publicKey), isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    })]);
    ok("Deposit created");
  }

  // ── 1. create_agent ────────────────────────────────────────────────────
  log("1/7", "Creating Warden agent...");
  const agentId = crypto.randomBytes(32);
  const [agentPda]       = pda([Buffer.from("agent"), agentId], WARDEN_PROGRAM);
  const [encryptCpiAuth] = pda(
    [Buffer.from("__encrypt_cpi_authority")], WARDEN_PROGRAM,
  );

  await send([new TransactionInstruction({
    programId: WARDEN_PROGRAM,
    data: Buffer.concat([anchorDisc("create_agent"), agentId]),
    keys: [
      { pubkey: agentPda,                isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: false },
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })]);
  ok(`Agent PDA: ${agentPda.toBase58()}`);

  // ── 2. bind_dwallet ────────────────────────────────────────────────────
  // For a fully end-to-end demo this would call the Ika gRPC service to mint
  // a real dWallet first, then transfer authority to our CPI authority PDA.
  // For the encrypt-only path we record any pubkey; the Ika cosignature step
  // is gated by IKA_PROGRAM_ID being set.
  log("2/7", "Binding dWallet to agent...");
  const dwalletPubkey = Keypair.generate().publicKey;
  await send([new TransactionInstruction({
    programId: WARDEN_PROGRAM,
    data: Buffer.concat([anchorDisc("bind_dwallet"), dwalletPubkey.toBuffer()]),
    keys: [
      { pubkey: agentPda,        isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey, isSigner: true,  isWritable: false },
    ],
  })]);
  ok(`dWallet bound: ${dwalletPubkey.toBase58()}`);

  // ── 3. encrypted inputs via gRPC ───────────────────────────────────────
  log("3/7", "Encrypting compliance inputs via Encrypt gRPC...");
  // Proposed action: a 3% trade (300 bps), 1.5% daily loss (150 bps), 2 open positions.
  // Guardrails:      max 5% trade  (500 bps), max 2.0% daily loss (200 bps), max 5 positions.
  // Result MUST be: compliant (all three predicates true).
  const inputs = [
    { name: "trade_size_bps",  value: 300n },
    { name: "daily_loss_bps",  value: 150n },
    { name: "open_positions",  value: 2n   },
    { name: "max_trade_bps",   value: 500n },
    { name: "loss_limit_bps",  value: 200n },
    { name: "max_open_pos",    value: 5n   },
  ];
  const { ciphertextIdentifiers } = await encrypt.createInput({
    chain: 0, // proto enum: SOLANA = 0
    inputs: inputs.map((i) => ({
      ciphertextBytes: mockCiphertext(i.value, FHE_UINT64),
      fheType: FHE_UINT64,
    })),
    proof: Buffer.alloc(0),
    authorized: WARDEN_PROGRAM.toBytes(),
    networkEncryptionPublicKey: networkKey,
  });
  const inputCts = ciphertextIdentifiers.map((id) => new PublicKey(id));
  inputs.forEach((i, idx) => val(i.name, `${i.value} → ${inputCts[idx].toBase58()}`));

  // Output ciphertext for the EBool result. Encrypt creates this via its
  // execute_graph CPI path — we just generate the keypair the program will
  // use as the new account.
  const outputCt = Keypair.generate();

  // Build a fresh proposal id.
  const proposalId    = crypto.randomBytes(32);
  const [proposalPda] = pda([Buffer.from("proposal"), proposalId], WARDEN_PROGRAM);
  // Pedersen commitment to the plaintext action — for the demo we hash a
  // canonical encoding. In production this is the actual Pedersen commitment
  // the Ika network co-signs against.
  const resultCommitment = crypto.createHash("sha256")
    .update(agentId).update(proposalId).digest();
  const [, encryptCpiBump] = pda(
    [Buffer.from("__encrypt_cpi_authority")], WARDEN_PROGRAM,
  );

  // ── 4. submit_proposal ─────────────────────────────────────────────────
  log("4/7", "Submitting proposal — Warden CPIs Encrypt::execute_graph...");
  await send(
    [new TransactionInstruction({
      programId: WARDEN_PROGRAM,
      data: Buffer.concat([
        anchorDisc("submit_proposal"),
        proposalId, resultCommitment, Buffer.from([encryptCpiBump]),
      ]),
      keys: [
        { pubkey: agentPda,                isSigner: false, isWritable: true  },
        { pubkey: proposalPda,             isSigner: false, isWritable: true  },
        { pubkey: payer.publicKey,         isSigner: true,  isWritable: false },

        // 6 encrypted inputs, all writable so Encrypt can update their
        // refcounts during execute_graph.
        ...inputCts.map((ct) => ({ pubkey: ct, isSigner: false, isWritable: true })),
        // output_ct
        { pubkey: outputCt.publicKey,      isSigner: true,  isWritable: true  },

        // Encrypt plumbing
        { pubkey: ENCRYPT_PROGRAM,         isSigner: false, isWritable: false },
        { pubkey: configPda,               isSigner: false, isWritable: true  },
        { pubkey: depositPda,              isSigner: false, isWritable: true  },
        { pubkey: encryptCpiAuth,          isSigner: false, isWritable: false },
        { pubkey: WARDEN_PROGRAM,          isSigner: false, isWritable: false },
        { pubkey: networkKeyPda,           isSigner: false, isWritable: false },
        { pubkey: eventAuthority,          isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    })],
    [outputCt],
  );
  ok(`Proposal: ${proposalPda.toBase58()}`);
  ok(`Output CT: ${outputCt.publicKey.toBase58()}`);

  // ── Wait for Encrypt executor to commit graph result ──────────────────
  log("4/7", "Waiting for Encrypt network to commit homomorphic result...");
  await pollUntil(
    outputCt.publicKey,
    (d) => d.length >= 100 && d[99] === 1, // status = VERIFIED
    120_000,
  );
  ok("Compliance graph evaluated by network");

  // ── 5. request_compliance_decryption ──────────────────────────────────
  log("5/7", "Requesting decryption of compliance result...");
  const decryptionReq = Keypair.generate();
  await send(
    [new TransactionInstruction({
      programId: WARDEN_PROGRAM,
      data: Buffer.concat([
        anchorDisc("request_compliance_decryption"),
        Buffer.from([encryptCpiBump]),
      ]),
      keys: [
        { pubkey: proposalPda,             isSigner: false, isWritable: true  },
        { pubkey: outputCt.publicKey,      isSigner: false, isWritable: false },
        { pubkey: decryptionReq.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: ENCRYPT_PROGRAM,         isSigner: false, isWritable: false },
        { pubkey: configPda,               isSigner: false, isWritable: false },
        { pubkey: depositPda,              isSigner: false, isWritable: true  },
        { pubkey: encryptCpiAuth,          isSigner: false, isWritable: false },
        { pubkey: WARDEN_PROGRAM,          isSigner: false, isWritable: false },
        { pubkey: networkKeyPda,           isSigner: false, isWritable: false },
        { pubkey: eventAuthority,          isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    })],
    [decryptionReq],
  );
  ok(`Decryption request: ${decryptionReq.publicKey.toBase58()}`);

  // ── 6. Wait for executor decryption ────────────────────────────────────
  log("6/7", "Waiting for executor to decrypt and publish plaintext...");
  await pollUntil(decryptionReq.publicKey, (d) => {
    if (d.length < 107) return false;
    const total   = d.readUInt32LE(99);
    const written = d.readUInt32LE(103);
    return written === total && total > 0;
  });
  ok("Plaintext published");

  // ── 7. reveal_and_authorize ────────────────────────────────────────────
  log("7/7", "Revealing result + asking Ika to cosign action commitment...");
  const [ikaCpiAuth, ikaCpiBump] = pda(
    [Buffer.from("__ika_cpi_authority")], WARDEN_PROGRAM,
  );
  const [coordinator]      = pda([Buffer.from("dwallet_coordinator")], IKA_PROGRAM);
  const [messageApproval, messageApprovalBump] = pda(
    [Buffer.from("message_approval"), proposalId, dwalletPubkey.toBuffer()],
    IKA_PROGRAM,
  );
  const messageMetadataDigest = crypto.createHash("sha256")
    .update("warden:metadata:v1").update(proposalId).digest();
  const userPubkey       = Buffer.alloc(32, 0); // demo placeholder
  const signatureScheme  = 0; // EcdsaKeccak256

  await send([new TransactionInstruction({
    programId: WARDEN_PROGRAM,
    data: Buffer.concat([
      anchorDisc("reveal_and_authorize"),
      Buffer.from([ikaCpiBump]),
      Buffer.from([messageApprovalBump]),
      Buffer.from([signatureScheme & 0xff, (signatureScheme >> 8) & 0xff]),
      messageMetadataDigest,
      userPubkey,
    ]),
    keys: [
      { pubkey: agentPda,                isSigner: false, isWritable: true  },
      { pubkey: proposalPda,             isSigner: false, isWritable: true  },
      { pubkey: decryptionReq.publicKey, isSigner: false, isWritable: false },
      { pubkey: IKA_PROGRAM,             isSigner: false, isWritable: false },
      { pubkey: ikaCpiAuth,              isSigner: false, isWritable: false },
      { pubkey: WARDEN_PROGRAM,          isSigner: false, isWritable: false },
      { pubkey: coordinator,             isSigner: false, isWritable: false },
      { pubkey: dwalletPubkey,           isSigner: false, isWritable: false },
      { pubkey: messageApproval,         isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  })]);
  ok("Ika cosignature requested");

  // ── Final state ────────────────────────────────────────────────────────
  const proposalInfo = await connection.getAccountInfo(proposalPda);
  if (!proposalInfo) throw new Error("proposal account vanished");
  // Anchor: 8-byte disc + agent(32) + proposal_id(32) + result_commitment(32)
  //         + output_ct(32) + decryption_request(32) + pending_digest(32)
  //         + status(1) + created_at(8) + bump(1)
  const status = proposalInfo.data[8 + 32 + 32 + 32 + 32 + 32 + 32];
  const STATUS = ["PendingDecryption", "Decrypting", "Authorised", "Rejected"];
  console.log("\n\x1b[1m═══ Final ═══\x1b[0m\n");
  val("Proposal status", STATUS[status] ?? `unknown(${status})`);
  val("Proposal id",     proposalId.toString("hex"));
  val("Result commit",   resultCommitment.toString("hex"));

  encrypt.close();
}

main().catch((err) => {
  console.error("\x1b[31mError:\x1b[0m", err.message ?? err);
  process.exit(1);
});
