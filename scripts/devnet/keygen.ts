#!/usr/bin/env bun
/**
 * Mint a fresh devnet keypair, request airdrop, and write it to ~/.config/solana/id.json.
 * Useful when running the demo without solana-cli installed.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const KP_PATH = path.join(os.homedir(), ".config/solana/id.json");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

async function main() {
  fs.mkdirSync(path.dirname(KP_PATH), { recursive: true });
  let kp: Keypair;
  if (fs.existsSync(KP_PATH)) {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KP_PATH, "utf-8"))));
    console.log(`Reusing existing keypair: ${kp.publicKey.toBase58()}`);
  } else {
    kp = Keypair.generate();
    fs.writeFileSync(KP_PATH, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`Wrote new keypair: ${KP_PATH}`);
    console.log(`Pubkey: ${kp.publicKey.toBase58()}`);
  }
  const conn = new Connection(RPC_URL, "confirmed");
  const balanceBefore = await conn.getBalance(kp.publicKey);
  console.log(`Balance: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balanceBefore < 5 * LAMPORTS_PER_SOL) {
    console.log("Requesting airdrop (devnet allows 2 SOL per request)...");
    for (let i = 0; i < 3; i++) {
      try {
        const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig, "confirmed");
        const b = await conn.getBalance(kp.publicKey);
        console.log(`  airdrop #${i + 1}: ${(b / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        if (b >= 5 * LAMPORTS_PER_SOL) break;
      } catch (e: any) {
        console.warn(`  airdrop #${i + 1} failed: ${e?.message ?? e}`);
      }
    }
  }
  console.log(`\nFinal balance: ${(await conn.getBalance(kp.publicKey) / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
