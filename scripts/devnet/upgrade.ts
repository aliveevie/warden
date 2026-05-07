#!/usr/bin/env tsx
/**
 * Upgrade an already-deployed BPFLoaderUpgradeable program in-place.
 *
 * Cheaper than re-deploying because the existing programdata account is
 * reused — the buffer's lamports are spilled back to the payer at the end.
 *
 *   1. Allocate a fresh buffer
 *   2. Write the new .so bytes in chunks
 *   3. Upgrade — copy buffer into programdata, drain buffer to spill
 *
 * Reads the same artefacts as deploy.ts.
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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PAYER_KEYPAIR_PATH =
  process.env.PAYER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");

const PROGRAM_DIR = path.resolve(__dirname, "../../programs/warden-core/target/deploy");
const SO_PATH      = path.join(PROGRAM_DIR, "warden_core.so");
const PROG_KP_PATH = path.join(PROGRAM_DIR, "warden_core-keypair.json");

const CHUNK = 800;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")) as number[]),
  );
}
const log = (s: string, m: string) => console.log(`\x1b[36m[${s}]\x1b[0m ${m}`);
const ok  = (m: string)             => console.log(`\x1b[32m  ✓\x1b[0m ${m}`);
const val = (l: string, v: unknown) => console.log(`\x1b[33m  →\x1b[0m ${l}: ${v}`);

async function main() {
  const conn  = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(PAYER_KEYPAIR_PATH);
  const prog  = loadKeypair(PROG_KP_PATH);
  const buffer = Keypair.generate();
  const so    = fs.readFileSync(SO_PATH);

  console.log("\n\x1b[1m═══ Warden devnet upgrade ═══\x1b[0m\n");
  val("RPC", RPC_URL);
  val("Payer",   payer.publicKey.toBase58());
  val("Program", prog.publicKey.toBase58());
  val("Buffer",  buffer.publicKey.toBase58());
  val("Bytes",   `${so.length}`);
  val("Balance", `${(await conn.getBalance(payer.publicKey) / 1e9).toFixed(4)} SOL`);

  const BUFFER_HEADER = 37;
  const space = BUFFER_HEADER + so.length;
  const lamports = await conn.getMinimumBalanceForRentExemption(space);

  log("1/3", "Init buffer...");
  const create = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: buffer.publicKey,
    lamports,
    space,
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  });
  const initBuffer = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data:      Buffer.concat([Buffer.from([0, 0, 0, 0]), payer.publicKey.toBuffer()]),
    keys: [
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,  isSigner: false, isWritable: false },
    ],
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(create, initBuffer), [payer, buffer]);
  ok("Buffer initialised");

  log("2/3", `Writing ${so.length} bytes in ${Math.ceil(so.length / CHUNK)} chunks...`);
  for (let offset = 0; offset < so.length; offset += CHUNK) {
    const slice = so.subarray(offset, Math.min(offset + CHUNK, so.length));
    const ix    = new TransactionInstruction({
      programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      data: Buffer.concat([
        Buffer.from([1, 0, 0, 0]),
        Buffer.from(new Uint32Array([offset]).buffer),
        Buffer.from(new BigUint64Array([BigInt(slice.length)]).buffer),
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
  ok("Bytes uploaded");

  log("3/3", "Upgrading program...");
  const [programdata] = PublicKey.findProgramAddressSync(
    [prog.publicKey.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
  const upgradeIx = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data:      Buffer.from([3, 0, 0, 0]), // Upgrade tag, no args
    keys: [
      { pubkey: programdata,             isSigner: false, isWritable: true  },
      { pubkey: prog.publicKey,          isSigner: false, isWritable: true  },
      { pubkey: buffer.publicKey,        isSigner: false, isWritable: true  },
      { pubkey: payer.publicKey,         isSigner: false, isWritable: true  }, // spill recipient
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: false }, // upgrade authority
    ],
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(upgradeIx), [payer]);
  ok(`Upgraded: ${sig}`);
  val("Final balance", `${(await conn.getBalance(payer.publicKey) / 1e9).toFixed(4)} SOL`);
}

main().catch((e) => {
  console.error("\x1b[31mError:\x1b[0m", e?.message ?? e);
  process.exit(1);
});
