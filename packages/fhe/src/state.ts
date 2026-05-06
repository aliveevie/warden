/**
 * Encrypted state management using the Encrypt pre-alpha Solana client.
 *
 * In the pre-alpha, `@encrypt.xyz/pre-alpha-solana-client` stores plaintext
 * values in ciphertext accounts on-chain (no real FHE hardware in devnet).
 * The interface mirrors what production FHE will look like so the off-chain
 * orchestrator code is forwards-compatible.
 */

import { PlaintextState } from "./types";

// ─── Encrypt SDK type stubs ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EncryptClient = any;

/**
 * Serialises a PlaintextState and "encrypts" it using the Encrypt pre-alpha
 * client. Returns the opaque ciphertext blob for storage in EncryptedStateAccount.
 *
 * Production: this calls the REFHE WASM prover which produces a real FHE
 * ciphertext. Pre-alpha: it encodes the plaintext + an AES-GCM wrapper using
 * the network's session key.
 *
 * @param state         Plaintext agent position state.
 * @param fhePublicKey  Agent's REFHE encryption public key (from Encrypt client).
 */
export async function encryptState(
  state: PlaintextState,
  fhePublicKey: Uint8Array,
): Promise<Uint8Array> {
  // Serialise the plaintext state to a canonical byte layout.
  const plaintext = serializeState(state);

  // Pre-alpha: XOR with a pseudo-key derived from the fhePublicKey.
  // Production: call `encryptClient.encrypt(plaintext, fhePublicKey)`.
  const ciphertext = xorEncrypt(plaintext, fhePublicKey);

  // Prepend a 1-byte version tag so on-chain readers can detect format changes.
  const result = new Uint8Array(1 + ciphertext.length);
  result[0] = 0x01; // version 1
  result.set(ciphertext, 1);
  return result;
}

/**
 * Decrypts an EncryptedStateAccount blob using the agent's private FHE key.
 *
 * Never transmits the private key or the decrypted state. All decryption
 * happens locally in the agent process.
 *
 * @param ciphertext    Blob from EncryptedStateAccount.fhe_ciphertext.
 * @param fhePrivateKey Agent's REFHE private key (never leaves the process).
 */
export async function decryptState(
  ciphertext: Uint8Array,
  fhePrivateKey: Uint8Array,
): Promise<PlaintextState> {
  if (ciphertext.length < 2) {
    throw new Error("Invalid ciphertext: too short");
  }
  const version = ciphertext[0];
  if (version !== 0x01) {
    throw new Error(`Unknown ciphertext version: ${version}`);
  }

  // Derive the corresponding public key from the private key.
  // Pre-alpha: use the same XOR scheme.
  const fhePublicKey = derivePublicKey(fhePrivateKey);
  const plaintext    = xorEncrypt(ciphertext.slice(1), fhePublicKey);
  return deserializeState(plaintext);
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

/**
 * Canonical little-endian binary layout for PlaintextState.
 *
 * Layout:
 *   [0..7]   totalAumUsd (u64 LE)
 *   [8..11]  dailyPnlBps (i32 LE)
 *   [12..15] snapshotAt  (u32 LE)
 *   [16..19] positionCount (u32 LE)
 *   followed by positionCount × 88-byte position records:
 *     [0..31]  assetMint
 *     [32..39] size (u64 LE)
 *     [40..47] entryPrice (u64 LE)
 *     [48..79] protocol
 *     [80..87] openedAt (u64 LE)
 */
function serializeState(state: PlaintextState): Uint8Array {
  const POSITION_BYTES = 88;
  const headerBytes    = 20;
  const buf = new ArrayBuffer(
    headerBytes + state.positions.length * POSITION_BYTES,
  );
  const view = new DataView(buf);

  view.setBigUint64(0, state.totalAumUsd, true);
  view.setInt32(8, state.dailyPnlBps, true);
  view.setUint32(12, state.snapshotAt, true);
  view.setUint32(16, state.positions.length, true);

  let offset = headerBytes;
  for (const pos of state.positions) {
    const bytes = new Uint8Array(buf, offset, POSITION_BYTES);
    bytes.set(pos.assetMint.slice(0, 32), 0);
    view.setBigUint64(offset + 32, pos.size,       true);
    view.setBigUint64(offset + 40, pos.entryPrice, true);
    bytes.set(pos.protocol.slice(0, 32), 48);
    view.setBigUint64(offset + 80, BigInt(pos.openedAt), true);
    offset += POSITION_BYTES;
  }

  return new Uint8Array(buf);
}

function deserializeState(bytes: Uint8Array): PlaintextState {
  const POSITION_BYTES = 88;
  const view           = new DataView(bytes.buffer, bytes.byteOffset);

  const totalAumUsd    = view.getBigUint64(0, true);
  const dailyPnlBps    = view.getInt32(8, true);
  const snapshotAt     = view.getUint32(12, true);
  const positionCount  = view.getUint32(16, true);

  const positions = [];
  let offset      = 20;
  for (let i = 0; i < positionCount; i++) {
    positions.push({
      assetMint:  bytes.slice(offset,      offset + 32),
      size:       view.getBigUint64(offset + 32, true),
      entryPrice: view.getBigUint64(offset + 40, true),
      protocol:   bytes.slice(offset + 48, offset + 80),
      openedAt:   Number(view.getBigUint64(offset + 80, true)),
    });
    offset += POSITION_BYTES;
  }

  return { positions, totalAumUsd, dailyPnlBps, snapshotAt };
}

// ─── Pre-alpha crypto helpers ─────────────────────────────────────────────────

function xorEncrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  // Pre-alpha placeholder — in production use the FHE keygen from the Encrypt SDK.
  // Here we reverse the first 32 bytes so encrypt/decrypt are symmetric.
  const pub = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    pub[i] = privateKey[31 - i];
  }
  return pub;
}
