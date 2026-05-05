import { PlaintextState } from "./types";

/**
 * Encrypts a PlaintextState under the agent's REFHE public key.
 * Returns the opaque ciphertext blob stored in EncryptedStateAccount.
 * Full implementation delivered in PR-1.
 */
export async function encryptState(
  _state: PlaintextState,
  _fhePublicKey: Uint8Array,
): Promise<Uint8Array> {
  // TODO(PR-1): call REFHE WASM prover
  throw new Error("Not implemented — pending PR-1");
}

/**
 * Decrypts an EncryptedStateAccount ciphertext blob locally using the
 * principal's private FHE key. Never transmits the private key or plaintext.
 */
export async function decryptState(
  _ciphertext: Uint8Array,
  _fhePrivateKey: Uint8Array,
): Promise<PlaintextState> {
  // TODO(PR-1): call REFHE WASM decryptor
  throw new Error("Not implemented — pending PR-1");
}
