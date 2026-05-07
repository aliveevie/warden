#!/usr/bin/env tsx
/**
 * Close an orphaned BPFLoaderUpgradeable buffer to recover its lamports.
 * Usage: tsx scripts/devnet/close-buffer.ts <BUFFER_PUBKEY>
 *
 * The buffer's authority must be the PAYER_KEYPAIR (default
 * ~/.config/solana/id.json). Lamports are returned to that same payer.
 */
import {
  Connection,
  Keypair,
  PublicKey,
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

function loadKeypair(p: string): Keypair {
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  const bufferArg = process.argv[2];
  if (!bufferArg) throw new Error("Usage: tsx scripts/devnet/close-buffer.ts <BUFFER_PUBKEY>");
  const buffer = new PublicKey(bufferArg);
  const conn   = new Connection(RPC_URL, "confirmed");
  const payer  = loadKeypair(PAYER_KEYPAIR_PATH);

  const info = await conn.getAccountInfo(buffer);
  if (!info) throw new Error(`Buffer ${buffer.toBase58()} not found`);
  console.log(`Buffer balance: ${(info.lamports / 1e9).toFixed(4)} SOL`);
  console.log(`Closing → recipient ${payer.publicKey.toBase58()} (also authority)`);

  // Close = enum tag 5 (UpgradeableLoaderInstruction::Close, no payload).
  const ix = new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    data: Buffer.from([5, 0, 0, 0]),
    keys: [
      { pubkey: buffer,           isSigner: false, isWritable: true  }, // buffer/programdata
      { pubkey: payer.publicKey,  isSigner: false, isWritable: true  }, // recipient
      { pubkey: payer.publicKey,  isSigner: true,  isWritable: false }, // authority
    ],
  });

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
  console.log(`✓ Closed: ${sig}`);
  const after = await conn.getBalance(payer.publicKey);
  console.log(`Payer balance: ${(after / 1e9).toFixed(4)} SOL`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
