/**
 * Ika dWallet lifecycle — creation and co-signature requests.
 *
 * Pre-alpha implementation targets the Ika Network devnet via gRPC.
 * The 2PC-MPC protocol runs between:
 *   - the local agent (holds `localShare`)
 *   - the Ika Network (holds its share, conditionally releases the co-signature
 *     only when the on-chain signing condition is satisfied)
 *
 * In the pre-alpha the Ika Network uses a mock signer so real 2PC is
 * simulated — signatures are produced without a multi-round DKG.
 */

import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  DwalletConfig,
  DwalletKeyShare,
  DwalletSigningCondition,
  CosignatureResult,
} from "./types";

// ─── gRPC service stubs ───────────────────────────────────────────────────────
// The `ika-grpc` npm package exports generated gRPC-Web stubs.
// Type-only import so tsc doesn't fail if the package isn't installed during
// the hackathon; remove `type` once the package is available.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IkaDwalletClient = any;

/**
 * Creates an Ika dWallet via the 2PC-MPC protocol.
 *
 * Flow:
 *   1. Generate a local secret share locally (randomBytes(32)).
 *   2. POST the public share + signing condition to the Ika gRPC endpoint.
 *   3. The Ika Network runs DKG (simulated in pre-alpha) and returns the
 *      combined dWallet public key and the network-side ID.
 *   4. Return the DwalletKeyShare (caller persists localShare securely).
 *
 * @param config         Ika Network connection parameters.
 * @param condition      On-chain signing condition to register.
 * @param existingLocal  Optional: provide a pre-generated local share (for
 *                       deterministic testing). If omitted, 32 random bytes
 *                       are generated.
 */
export async function createDwallet(
  config: DwalletConfig,
  condition: DwalletSigningCondition,
  existingLocal?: Uint8Array,
): Promise<DwalletKeyShare> {
  // ── Step 1: local key material ────────────────────────────────────────────
  const localShare = existingLocal ?? crypto.getRandomValues(new Uint8Array(32));

  // ── Step 2: register with Ika Network ────────────────────────────────────
  // gRPC-JSON transcoding over HTTP/2. The Ika pre-alpha exposes a REST
  // gateway at /v1/dwallet/create for environments without native gRPC.
  const response = await fetch(`${config.ikaApiBase}/v1/dwallet/create`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localPublicShare:      Buffer.from(localShare).toString("hex"),
      enforcerProgramId:     condition.enforcerProgramId,
      requiredProposalStatus: condition.requiredProposalStatus,
      signatureScheme:       "secp256k1",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ika createDwallet failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    dwalletId:  string;
    publicKey:  string;
    networkKey: string;
  };

  return {
    dwalletId:  hexToBytes(json.dwalletId),
    localShare,
    publicKey:  hexToBytes(json.publicKey),
  };
}

/**
 * Requests a co-signature from the Ika Network.
 *
 * The network checks on Solana that `warden-policy` has emitted a
 * `ProposalAuthorized` event for this `dwalletId` with the given
 * `resultCommitment` before producing its share.
 *
 * @param config            Ika Network connection parameters.
 * @param dwalletId         The 32-byte Ika dWallet network ID.
 * @param txPayload         Raw serialised transaction bytes to sign.
 * @param resultCommitment  Pedersen commitment matching the on-chain approval.
 * @param localShare        The caller's local key share for the 2PC round.
 * @param timeoutMs         Max milliseconds to wait for the co-signature.
 */
export async function requestCosignature(
  config: DwalletConfig,
  dwalletId: Uint8Array,
  txPayload: Uint8Array,
  resultCommitment: Uint8Array,
  localShare: Uint8Array,
  timeoutMs = 60_000,
): Promise<CosignatureResult> {
  const body = {
    dwalletId:        Buffer.from(dwalletId).toString("hex"),
    message:          Buffer.from(txPayload).toString("hex"),
    resultCommitment: Buffer.from(resultCommitment).toString("hex"),
    localShare:       Buffer.from(localShare).toString("hex"),
  };

  const response = await fetchWithTimeout(
    `${config.ikaApiBase}/v1/dwallet/cosign`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ika cosign failed (${response.status}): ${text}`);
  }

  const json = await response.json() as {
    signature:  string;
    recoveryId: number;
  };

  return {
    signature:  hexToBytes(json.signature),
    recoveryId: json.recoveryId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
