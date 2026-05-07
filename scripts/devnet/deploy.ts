#!/usr/bin/env bun
/**
 * Deploy warden_core.so to Solana devnet using BPFLoaderUpgradeable directly,
 * with no Solana CLI dependency.
 *
 * Reads:
 *   programs/warden-core/target/deploy/warden_core.so
 *   programs/warden-core/target/deploy/warden_core-keypair.json
 *
 * Writes:
 *   scripts/devnet/.warden-program-id   (so e2e-demo.ts can read it)
 *
 * Requires:
 *   PAYER_KEYPAIR=/path/to/funded/devnet/keypair.json   (≥ 5 SOL)
 *   or default ~/.config/solana/id.json
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

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PAYER_KEYPAIR_PATH =
  process.env.PAYER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");

const PROGRAM_DIR = path.resolve(__dirname, "../../programs/warden-core/target/deploy");
const SO_PATH      = path.join(PROGRAM_DIR, "warden_core.so");
const PROG_KP_PATH = path.join(PROGRAM_DIR, "warden_core-keypair.json");
const OUT_PATH     = path.resolve(__dirname, ".warden-program-id");

function loadKeypair(p: string): Keypair {
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

const log = (s: string, m: string) => console.log(`\x1b[36m[${s}]\x1b[0m ${m}`);
const ok  = (m: string)             => console.log(`\x1b[32m  ✓\x1b[0m ${m}`);
const val = (l: string, v: unknown) => console.log(`\x1b[33m  →\x1b[0m ${l}: ${v}`);

// BPFLoaderUpgradeable instruction bincode discriminators.
const IX_INITIALIZE_BUFFER = 0;
const IX_WRITE             = 1;
const IX_DEPLOY_WITH_MAX   = 2;

const CHUNK = 800; // bytes per Write instruction (must fit in 1232-byte tx)

async function main() {
  if (!fs.existsSync(SO_PATH))      throw new Error(`Missing ${SO_PATH} — run cargo-build-sbf first`);
  if (!fs.existsSync(PROG_KP_PATH)) throw new Error(`Missing ${PROG_KP_PATH}`);
  if (!fs.existsSync(PAYER_KEYPAIR_PATH))
    throw new Error(`Missing payer keypair: ${PAYER_KEYPAIR_PATH}. ` +
      `Either point PAYER_KEYPAIR at a funded devnet keypair or run ` +
      `bun scripts/devnet/keygen.ts to mint one.`);

  const conn  = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(PAYER_KEYPAIR_PATH);
  const prog  = loadKeypair(PROG_KP_PATH);
  const buffer = Keypair.generate();
  const so    = fs.readFileSync(SO_PATH);

  console.log("\n\x1b[1m═══ Warden devnet deploy ═══\x1b[0m\n");
  val("RPC", RPC_URL);
  val("Payer",   payer.publicKey.toBase58());
  val("Program", prog.publicKey.toBase58());
  val("Buffer",  buffer.publicKey.toBase58());
  val("Bytes",   `${so.length}  (${(so.length / 1024).toFixed(1)} KB)`);

  const balance = await conn.getBalance(payer.publicKey);
  val("Balance", `${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 5e9) {
    console.log("⚠ Payer has < 5 SOL — large programs need ~3 SOL rent + tx fees.");
  }

  // ── Step 1: create a buffer account that ends up holding the program ──
  log("1/3", "Initializing buffer account...");
  // Buffer account size: 37 (UpgradeableLoaderState::Buffer header) + program bytes
  const BUFFER_HEADER = 37;
  const space = BUFFER_HEADER + so.length;
  const lamports = await conn.getMinimumBalanceForRentExemption(space);

  const create = SystemProgram.createAccount({
    fromPubkey:        payer.publicKey,
    newAccountPubkey:  buffer.publicKey,
    lamports,
    space,
    programId:         BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  });
  // InitializeBuffer instruction: tag (4 bytes LE) + authority pubkey
  const initBuffer = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data:      Buffer.concat([Buffer.from([0, 0, 0, 0]), payer.publicKey.toBuffer()]),
    keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,  isSigner: false, isWritable: false },
    ],
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(create, initBuffer),
    [payer, buffer]);
  ok("Buffer initialised");

  // ── Step 2: write the program bytes in chunks ──
  log("2/3", `Writing ${so.length} bytes in ${Math.ceil(so.length / CHUNK)} chunks...`);
  for (let offset = 0; offset < so.length; offset += CHUNK) {
    const slice = so.subarray(offset, Math.min(offset + CHUNK, so.length));
    const ix    = new TransactionInstruction({
      programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      data: Buffer.concat([
        Buffer.from([1, 0, 0, 0]),                                   // Write tag
        Buffer.from(new Uint32Array([offset]).buffer),               // u32 LE offset
        Buffer.from(new BigUint64Array([BigInt(slice.length)]).buffer), // bincode Vec<u8> uses u64 length
        slice,
      ]),
      keys: [
        { pubkey: buffer.publicKey, isSigner: false, isWritable: true  },
        { pubkey: payer.publicKey,  isSigner: true,  isWritable: false },
      ],
    });
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
    process.stdout.write(`\r  ${Math.min(offset + CHUNK, so.length)}/${so.length} bytes`);
  }
  process.stdout.write("\n");
  ok("Program bytes uploaded");

  // ── Step 3: DeployWithMaxDataLen — finalises the program at prog.publicKey ──
  log("3/3", "Deploying as program...");
  // Programdata account is a PDA from BPFLoaderUpgradeable
  const [programdata] = PublicKey.findProgramAddressSync(
    [prog.publicKey.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
  // No upgrade headroom: use exact program size (saves ~1 SOL of rent).
  const maxDataLen = so.length;
  const programdataSpace = BUFFER_HEADER + maxDataLen;
  const programdataLamports = await conn.getMinimumBalanceForRentExemption(programdataSpace);

  const createProgram = SystemProgram.createAccount({
    fromPubkey:        payer.publicKey,
    newAccountPubkey:  prog.publicKey,
    lamports:          await conn.getMinimumBalanceForRentExemption(36),
    space:             36,
    programId:         BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  });
  const deployIx = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: Buffer.concat([
      Buffer.from([2, 0, 0, 0]),
      Buffer.from(new BigUint64Array([BigInt(maxDataLen)]).buffer), // max_data_len u64
    ]),
    keys: [
      { pubkey: payer.publicKey,                 isSigner: true,  isWritable: true  },
      { pubkey: programdata,                     isSigner: false, isWritable: true  },
      { pubkey: prog.publicKey,                  isSigner: false, isWritable: true  },
      { pubkey: buffer.publicKey,                isSigner: false, isWritable: true  },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"),
        isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"),
        isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,         isSigner: false, isWritable: false },
      { pubkey: payer.publicKey,                 isSigner: true,  isWritable: false },
    ],
  });
  await sendAndConfirmTransaction(conn,
    new Transaction().add(createProgram, deployIx),
    [payer, prog]);
  ok("Program deployed");

  fs.writeFileSync(OUT_PATH, prog.publicKey.toBase58() + "\n");
  console.log("\n\x1b[1m═══ Done ═══\x1b[0m");
  val("Program ID", prog.publicKey.toBase58());
  console.log(`\nNext: \x1b[36mexport WARDEN_PROGRAM_ID=$(cat ${path.relative(process.cwd(), OUT_PATH)}) && bun scripts/devnet/e2e-demo.ts\x1b[0m\n`);
}

main().catch((e) => {
  console.error("\x1b[31mError:\x1b[0m", e?.message ?? e);
  process.exit(1);
});
