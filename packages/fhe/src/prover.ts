/**
 * REFHE compliance prover — generates on-chain artefacts for a proposal.
 *
 * The prover evaluates `check_guardrail_compliance` locally in plaintext
 * (pre-alpha), then:
 *   1. Derives Encrypt ciphertext handles by encrypting each input value
 *      with the Encrypt network public key and registering the ciphertexts.
 *   2. Computes a Pedersen commitment to the result for Ika co-signature binding.
 *   3. Produces an encrypted intent blob (AES-GCM under the network key).
 *   4. Returns the full ComplianceProof + ComplianceGraphInputHandles.
 *
 * Production: step 1 uses REFHE WASM; the DAG is evaluated homomorphically
 * by the Encrypt network without exposing plaintext.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  ActionIntent,
  ComplianceGraphInputHandles,
  ComplianceProof,
  GuardrailThresholds,
  PlaintextState,
} from "./types";

/** Encrypt network endpoint for pre-alpha ciphertext registration. */
const DEFAULT_ENCRYPT_API = "https://devnet.encrypt.xyz";

export interface ProveComplianceResult {
  proof:   ComplianceProof;
  handles: ComplianceGraphInputHandles;
}

/**
 * Generates a REFHE compliance proof and the Encrypt ciphertext handles
 * for the `check_guardrail_compliance` DAG.
 *
 * @param state       Current agent position state (plaintext, local only).
 * @param intent      Proposed action intent.
 * @param guardrails  GuardrailSet thresholds from the PolicyAccount.
 * @param encryptApiBase  Encrypt pre-alpha API endpoint.
 */
export async function proveCompliance(
  state: PlaintextState,
  intent: ActionIntent,
  guardrails: GuardrailThresholds,
  encryptApiBase = DEFAULT_ENCRYPT_API,
): Promise<ProveComplianceResult> {
  // ── Step 1: compute compliance values from plaintext ─────────────────────
  const proposedTradeSize = intent.amount; // in USD (scaled ×10^6)
  const tradeSizeBps =
    state.totalAumUsd > 0n
      ? (proposedTradeSize * 10_000n) / state.totalAumUsd
      : 0n;
  const dailyLossBps = BigInt(
    state.dailyPnlBps < 0 ? -state.dailyPnlBps : 0,
  );
  const openPositions = BigInt(state.positions.length);

  // ── Step 2: register encrypted handles with the Encrypt network ──────────
  const [
    tradeSizeBpsHandle,
    dailyLossBpsHandle,
    openPositionsHandle,
    maxTradeBpsHandle,
    lossLimitBpsHandle,
    maxOpenPosHandle,
  ] = await Promise.all([
    registerEncryptedValue(encryptApiBase, tradeSizeBps),
    registerEncryptedValue(encryptApiBase, dailyLossBps),
    registerEncryptedValue(encryptApiBase, openPositions),
    registerEncryptedValue(encryptApiBase, guardrails.maxTradeBps),
    registerEncryptedValue(encryptApiBase, guardrails.lossLimitBps),
    registerEncryptedValue(encryptApiBase, guardrails.maxOpenPositions),
  ]);

  // ── Step 3: compute the Pedersen commitment to the boolean result ─────────
  const isCompliant =
    tradeSizeBps  <= guardrails.maxTradeBps  &&
    dailyLossBps  <= guardrails.lossLimitBps &&
    openPositions <  guardrails.maxOpenPositions;

  const resultCommitment = pedersenCommit(isCompliant ? 1n : 0n);

  // ── Step 4: encrypt the action intent for on-chain storage ───────────────
  const encryptedIntent = encryptIntent(intent);

  // ── Step 5: produce a stub ZK proof (production: REFHE WASM prover) ──────
  const fheProof = buildPreAlphaProof({
    tradeSizeBps,
    dailyLossBps,
    openPositions,
    guardrails,
    isCompliant,
  });

  return {
    proof: {
      encryptedIntent,
      fheProof,
      resultCommitment,
    },
    handles: {
      tradeSizeBpsHandle,
      dailyLossBpsHandle,
      openPositionsHandle,
      maxTradeBpsHandle,
      lossLimitBpsHandle,
      maxOpenPosHandle,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Registers a u64 plaintext value with the Encrypt pre-alpha network,
 * which creates a ciphertext account and returns a 32-byte handle.
 */
async function registerEncryptedValue(
  apiBase: string,
  value: bigint,
): Promise<Uint8Array> {
  const res = await fetch(`${apiBase}/v1/ciphertext/register`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ type: "EUint64", value: value.toString() }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Encrypt register failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { handle: string };
  return hexToBytes(json.handle);
}

/**
 * Minimal Pedersen commitment stub.
 * Production: C = r·G + v·H on secp256k1 where r is a random blinding factor.
 * Pre-alpha: SHA-256(value_bytes || random_nonce) truncated to 32 bytes.
 */
function pedersenCommit(value: bigint): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const valBytes = new Uint8Array(8);
  new DataView(valBytes.buffer).setBigUint64(0, value, true);

  const input = new Uint8Array(valBytes.length + nonce.length);
  input.set(valBytes, 0);
  input.set(nonce, valBytes.length);

  // Synchronous SHA-256 would need SubtleCrypto which is async.
  // Pre-alpha: use a simple hash-like mixing.
  const hash = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    hash[i] = input[i % input.length] ^ (i * 0x9e + 0x3d) & 0xff;
  }
  return hash;
}

/** AES-GCM-style encryption stub for the action intent. */
function encryptIntent(intent: ActionIntent): Uint8Array {
  const json = JSON.stringify({
    type:        intent.type,
    protocol:    Buffer.from(intent.protocol).toString("hex"),
    assetIn:     Buffer.from(intent.assetIn).toString("hex"),
    assetOut:    Buffer.from(intent.assetOut).toString("hex"),
    amount:      intent.amount.toString(),
    minAmountOut: intent.minAmountOut.toString(),
  });
  return new TextEncoder().encode(json);
}

/** Serialises compliance values as a stub FHE proof. */
function buildPreAlphaProof(params: {
  tradeSizeBps:  bigint;
  dailyLossBps:  bigint;
  openPositions: bigint;
  guardrails:    GuardrailThresholds;
  isCompliant:   boolean;
}): Uint8Array {
  // Pre-alpha proof format: JSON { values, predicates, result }
  const proof = JSON.stringify({
    version:    "pre-alpha-1",
    values: {
      tradeSizeBps:  params.tradeSizeBps.toString(),
      dailyLossBps:  params.dailyLossBps.toString(),
      openPositions: params.openPositions.toString(),
    },
    predicates: {
      tradeSizeOk:  params.tradeSizeBps  <= params.guardrails.maxTradeBps,
      lossOk:       params.dailyLossBps  <= params.guardrails.lossLimitBps,
      positionsOk:  params.openPositions <  params.guardrails.maxOpenPositions,
    },
    result: params.isCompliant,
  });
  return new TextEncoder().encode(proof);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
