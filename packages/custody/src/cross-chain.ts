import { CrossChainTx } from "./types";

/**
 * Constructs a Bitcoin PSBT spending from an Ika dWallet-controlled UTXO.
 * Full implementation delivered in PR-1.
 */
export async function buildBitcoinPsbt(
  _dwalletId: Uint8Array,
  _recipientAddress: string,
  _amountSatoshis: bigint,
): Promise<CrossChainTx> {
  // TODO(PR-1)
  throw new Error("Not implemented — pending PR-1");
}

/**
 * Constructs an Ethereum transaction spending from an Ika dWallet-controlled
 * EOA.
 */
export async function buildEthereumTx(
  _dwalletId: Uint8Array,
  _to: string,
  _valueWei: bigint,
  _data: Uint8Array,
): Promise<CrossChainTx> {
  // TODO(PR-1)
  throw new Error("Not implemented — pending PR-1");
}
