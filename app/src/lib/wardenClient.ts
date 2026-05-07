/**
 * Live reader for warden-core PDAs on Solana devnet.
 *
 * Decodes Anchor account layouts directly — no IDL needed.
 * Used by the /monitor page to render real-time agent + proposal state.
 */

import { Connection, PublicKey } from "@solana/web3.js";

export const WARDEN_PROGRAM_ID = new PublicKey(
  // Compiled into warden-core declare_id!
  "Htrj84e45UCgFTfn7GfDoHZHRRiPC8Lr74PD3mKdtBFq",
);

export const ENCRYPT_PROGRAM_ID = new PublicKey(
  "Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx",
);

export const IKA_PROGRAM_ID = new PublicKey(
  "DWaL1c2nc3J3Eiduwq6EJovDfBPPH2gERKy1TqSkbRWq",
);

export const DEVNET_RPC = "https://api.devnet.solana.com";

// ── Account layouts (must match programs/warden-core/src/lib.rs) ────────────

export interface Agent {
  pda:                 string;
  authority:           string;
  agentId:             string; // hex
  ikaDwallet:          string;
  proposalsSeen:       bigint;
  proposalsAuthorised: bigint;
}

export type ProposalStatus =
  | "PendingDecryption"
  | "Decrypting"
  | "Authorised"
  | "Rejected";

export interface Proposal {
  pda:               string;
  agent:             string;
  proposalId:        string; // hex
  resultCommitment:  string; // hex
  outputCiphertext:  string;
  decryptionRequest: string;
  pendingDigest:     string;
  status:            ProposalStatus;
  createdAt:         number;
}

const STATUS_VARIANTS: ProposalStatus[] = [
  "PendingDecryption",
  "Decrypting",
  "Authorised",
  "Rejected",
];

// ── Decoders ────────────────────────────────────────────────────────────────

const ANCHOR_DISC_LEN = 8;

function readPubkey(data: Buffer, off: number): string {
  return new PublicKey(data.subarray(off, off + 32)).toBase58();
}
function readHex(data: Buffer, off: number, len: number): string {
  return data.subarray(off, off + len).toString("hex");
}
function readU64(data: Buffer, off: number): bigint {
  return data.readBigUInt64LE(off);
}
function readI64(data: Buffer, off: number): number {
  return Number(data.readBigInt64LE(off));
}

function decodeAgent(pda: PublicKey, data: Buffer): Agent {
  // 8 disc + authority(32) + agent_id(32) + ika_dwallet(32) + proposals_seen(u64)
  // + proposals_authorised(u64) + bump(u8)
  let o = ANCHOR_DISC_LEN;
  const authority = readPubkey(data, o); o += 32;
  const agentId   = readHex(data, o, 32); o += 32;
  const dw        = readPubkey(data, o); o += 32;
  const seen      = readU64(data, o); o += 8;
  const auth      = readU64(data, o); o += 8;
  return {
    pda:                 pda.toBase58(),
    authority,
    agentId,
    ikaDwallet:          dw,
    proposalsSeen:       seen,
    proposalsAuthorised: auth,
  };
}

function decodeProposal(pda: PublicKey, data: Buffer): Proposal {
  // 8 disc + agent(32) + proposal_id(32) + result_commitment(32) + output_ct(32)
  // + decryption_request(32) + pending_digest(32) + status(u8) + created_at(i64) + bump(u8)
  let o = ANCHOR_DISC_LEN;
  const agent  = readPubkey(data, o); o += 32;
  const pid    = readHex(data, o, 32); o += 32;
  const rc     = readHex(data, o, 32); o += 32;
  const out    = readPubkey(data, o); o += 32;
  const dr     = readPubkey(data, o); o += 32;
  const dig    = readHex(data, o, 32); o += 32;
  const statusByte = data.readUInt8(o); o += 1;
  const createdAt  = readI64(data, o); o += 8;
  return {
    pda:               pda.toBase58(),
    agent,
    proposalId:        pid,
    resultCommitment:  rc,
    outputCiphertext:  out,
    decryptionRequest: dr,
    pendingDigest:     dig,
    status:            STATUS_VARIANTS[statusByte] ?? "PendingDecryption",
    createdAt,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export function agentPda(agentId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), Buffer.from(agentId)],
    WARDEN_PROGRAM_ID,
  );
  return pda;
}

export function proposalPda(proposalId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), Buffer.from(proposalId)],
    WARDEN_PROGRAM_ID,
  );
  return pda;
}

export async function fetchAgent(
  conn: Connection,
  agentId: Uint8Array,
): Promise<Agent | null> {
  const pda = agentPda(agentId);
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  return decodeAgent(pda, info.data as Buffer);
}

/** Fetch ALL proposals owned by warden-core. Sorted newest first. */
export async function fetchAllProposals(conn: Connection): Promise<Proposal[]> {
  // gPA filter: discriminator for Anchor account "Proposal" = sha256("account:Proposal")[..8]
  const accs = await conn.getProgramAccounts(WARDEN_PROGRAM_ID, {
    commitment: "confirmed",
    filters:    [{ memcmp: { offset: 0, bytes: anchorAccountDisc("Proposal") } }],
  });
  const proposals = accs
    .map(({ pubkey, account }) =>
      decodeProposal(pubkey, account.data as Buffer))
    .sort((a, b) => b.createdAt - a.createdAt);
  return proposals;
}

/** Browser-safe SHA256 → first 8 bytes → base58 (for memcmp filter). */
function anchorAccountDisc(name: string): string {
  // SHA256 in Node's native crypto isn't available in browser; we precompute
  // the discriminators here so fetchAllProposals works without crypto-browserify.
  // Matches anchor-lang's `account:<Name>` discriminator scheme.
  const KNOWN: Record<string, string> = {
    // SHA256("account:Proposal")[..8] base58-encoded
    Proposal: bs58Encode(sha256First8("account:Proposal")),
    Agent:    bs58Encode(sha256First8("account:Agent")),
  };
  return KNOWN[name] ?? "";
}

// Tiny in-file sha256 + base58. Avoids pulling node:crypto into a browser bundle.
function sha256First8(input: string): Uint8Array {
  // Synchronous SHA-256 via the Web Crypto subtle API isn't available; we ship
  // a minimal pure-JS implementation. For an 8-byte prefix this is fine.
  return js_sha256_first8(new TextEncoder().encode(input));
}
function js_sha256_first8(msg: Uint8Array): Uint8Array {
  // Dirt-simple SHA-256 — sufficient for the discriminator prefix only.
  // (Pulled-in routine inlined to keep this file self-contained.)
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const ml = msg.length;
  const padLen = (((ml + 9) + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[ml] = 0x80;
  const bitLen = BigInt(ml) * 8n;
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(padLen - 8, bitLen, false);
  const H = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) W[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(W[j-15], 7) ^ rotr(W[j-15], 18) ^ (W[j-15] >>> 3);
      const s1 = rotr(W[j-2], 17) ^ rotr(W[j-2], 19) ^ (W[j-2] >>> 10);
      W[j] = (W[j-16] + s0 + W[j-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[j] + W[j]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0]+a)|0; H[1] = (H[1]+b)|0; H[2] = (H[2]+c)|0; H[3] = (H[3]+d)|0;
    H[4] = (H[4]+e)|0; H[5] = (H[5]+f)|0; H[6] = (H[6]+g)|0; H[7] = (H[7]+h)|0;
  }
  const out = new Uint8Array(8);
  const dvOut = new DataView(out.buffer);
  dvOut.setUint32(0, H[0], false);
  dvOut.setUint32(4, H[1], false);
  return out;
}

const BS58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = BS58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
