/**
 * Cross-chain transaction construction for Ika dWallet-controlled keys.
 *
 * These utilities build raw unsigned transaction payloads. The caller passes
 * the payload to `requestCosignature` to obtain the Ika co-signature, then
 * broadcasts the fully-signed transaction on the target network.
 */

import { CrossChainTx } from "./types";

// ─── Bitcoin ──────────────────────────────────────────────────────────────────

/**
 * Constructs a single-input P2WPKH Bitcoin PSBT spending from the dWallet's
 * derived address.
 *
 * @param dwalletPublicKey  Compressed secp256k1 public key (33 bytes).
 * @param utxoTxid          Funding UTXO txid (32 bytes, little-endian).
 * @param utxoVout          Funding UTXO output index.
 * @param utxoAmountSats    UTXO value in satoshis (used to compute fee).
 * @param recipientAddress  Bech32 or legacy recipient address.
 * @param amountSatoshis    Transfer amount in satoshis (net of fee).
 * @param feeSatoshis       Miner fee in satoshis.
 */
export async function buildBitcoinPsbt(
  dwalletPublicKey: Uint8Array,
  utxoTxid: Uint8Array,
  utxoVout: number,
  utxoAmountSats: bigint,
  recipientAddress: string,
  amountSatoshis: bigint,
  feeSatoshis: bigint = 5_000n,
): Promise<CrossChainTx> {
  // Validate amounts
  if (amountSatoshis + feeSatoshis > utxoAmountSats) {
    throw new Error(
      `Insufficient UTXO: ${utxoAmountSats} sats < amount (${amountSatoshis}) + fee (${feeSatoshis})`,
    );
  }

  // Build a minimal PSBT v0 payload.
  // In production use the `bitcoinjs-lib` PSBT builder; here we produce a
  // deterministic byte layout sufficient for the Ika signer mock.
  const psbt = encodePsbtV0({
    inputs: [{
      txid:       utxoTxid,
      vout:       utxoVout,
      witnessUtxo: {
        scriptPubKey: p2wpkhScript(dwalletPublicKey),
        value:        utxoAmountSats,
      },
    }],
    outputs: [
      { address: recipientAddress, value: amountSatoshis },
    ],
    // Change back to the dWallet address if there is any
    ...(utxoAmountSats - amountSatoshis - feeSatoshis > 0n
      ? [{
          address: "dWalletChangeAddress", // resolved by caller
          value:   utxoAmountSats - amountSatoshis - feeSatoshis,
        }]
      : {}),
  });

  return { chain: "bitcoin", payload: psbt };
}

// ─── Ethereum ─────────────────────────────────────────────────────────────────

/**
 * Constructs an Ethereum EIP-1559 transaction (type 2) for the dWallet's EOA.
 *
 * @param chainId         EVM chain ID (e.g. 1 for mainnet, 11155111 for Sepolia).
 * @param nonce           Current nonce of the dWallet address.
 * @param to              Recipient hex address (0x…).
 * @param valueWei        ETH transfer amount in wei.
 * @param data            Call data bytes (empty for plain ETH transfer).
 * @param maxFeePerGas    EIP-1559 max fee per gas in wei.
 * @param maxPriorityFee  EIP-1559 max priority fee per gas in wei.
 * @param gasLimit        Gas limit.
 */
export async function buildEthereumTx(
  chainId: bigint,
  nonce: bigint,
  to: string,
  valueWei: bigint,
  data: Uint8Array,
  maxFeePerGas: bigint,
  maxPriorityFee: bigint,
  gasLimit: bigint = 21_000n,
): Promise<CrossChainTx> {
  // EIP-1559 transaction: type=2, RLP([chainId, nonce, maxPriorityFee,
  //   maxFeePerGas, gasLimit, to, value, data, [], []])
  // The Ika signer signs keccak256(0x02 || rlp_encoded_fields).
  const rlpPayload = rlpEncodeEip1559Tx({
    chainId,
    nonce,
    maxPriorityFeePerGas: maxPriorityFee,
    maxFeePerGas,
    gasLimit,
    to:    hexToBytes(to.replace(/^0x/, "")),
    value: valueWei,
    data,
    accessList: [],
  });

  return { chain: "ethereum", payload: rlpPayload };
}

// ─── Encoding helpers (production: replace with bitcoinjs-lib / ethers.js) ───

interface PsbtInput {
  txid: Uint8Array;
  vout: number;
  witnessUtxo: { scriptPubKey: Uint8Array; value: bigint };
}

interface PsbtOutput {
  address: string;
  value:   bigint;
}

function encodePsbtV0(opts: {
  inputs:  PsbtInput[];
  outputs: PsbtOutput[];
  [k: string]: unknown;
}): Uint8Array {
  // Minimal PSBT magic + version byte + a serialised repr of inputs/outputs.
  // The Ika pre-alpha mock signer treats the raw bytes as an opaque message.
  const magic  = new TextEncoder().encode("psbt\xff");
  const vers   = new Uint8Array([0x00]); // global unsigned tx version byte
  const body   = new TextEncoder().encode(JSON.stringify(opts));
  const result = new Uint8Array(magic.length + vers.length + body.length);
  result.set(magic, 0);
  result.set(vers, magic.length);
  result.set(body, magic.length + vers.length);
  return result;
}

function p2wpkhScript(compressedPubKey: Uint8Array): Uint8Array {
  // OP_0 <20-byte keyhash>  →  0x0014<hash160(pubkey)>
  const hash160 = new Uint8Array(20); // placeholder (real: ripemd160(sha256(pubkey)))
  hash160.set(compressedPubKey.slice(0, 20));
  return new Uint8Array([0x00, 0x14, ...hash160]);
}

interface Eip1559TxFields {
  chainId:             bigint;
  nonce:               bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas:        bigint;
  gasLimit:            bigint;
  to:                  Uint8Array;
  value:               bigint;
  data:                Uint8Array;
  accessList:          unknown[];
}

function rlpEncodeEip1559Tx(tx: Eip1559TxFields): Uint8Array {
  // Minimal deterministic encoding for the Ika pre-alpha mock signer.
  // Production code: use `ethers.Transaction.from(tx).unsignedSerialized`.
  const json = JSON.stringify({
    chainId:              tx.chainId.toString(),
    nonce:                tx.nonce.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
    maxFeePerGas:         tx.maxFeePerGas.toString(),
    gasLimit:             tx.gasLimit.toString(),
    to:                   Buffer.from(tx.to).toString("hex"),
    value:                tx.value.toString(),
    data:                 Buffer.from(tx.data).toString("hex"),
    accessList:           tx.accessList,
  });
  const typePrefix = new Uint8Array([0x02]); // EIP-2718 type 2
  const payload    = new TextEncoder().encode(json);
  const out        = new Uint8Array(typePrefix.length + payload.length);
  out.set(typePrefix, 0);
  out.set(payload, typePrefix.length);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
