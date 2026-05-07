/**
 * Unit tests for the @warden/fhe compliance prover.
 * These tests run entirely in-process — no validator required.
 */

import { proveCompliance, encryptState, decryptState } from "@warden/fhe";

describe("@warden/fhe — proveCompliance", () => {
  const guardrails = {
    maxTradeBps:      500n,
    lossLimitBps:     200n,
    maxOpenPositions: 5n,
  };

  const baseState = {
    positions:   [],
    totalAumUsd: 1_000_000n,
    dailyPnlBps: 0,
    snapshotAt:  Math.floor(Date.now() / 1000),
  };

  // Use HTTPS Mock Service Worker would be ideal here, but we do simpler:
  // monkey-patch global fetch to return predictable handles.
  const originalFetch = global.fetch;
  beforeAll(() => {
    (global as any).fetch = async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        handle: "00".repeat(32), // 32 zero bytes hex
      }),
      text: async () => "",
      status: 200,
    });
  });
  afterAll(() => { (global as any).fetch = originalFetch; });

  it("returns result=true when all guardrails are satisfied", async () => {
    const { proof, handles } = await proveCompliance(
      baseState,
      {
        type:         "swap",
        protocol:     new Uint8Array(32),
        assetIn:      new Uint8Array(32),
        assetOut:     new Uint8Array(32),
        amount:       30_000n, // 3% of AUM, within maxTradeSizeBps=500
        minAmountOut: 0n,
      },
      guardrails,
    );

    const decoded = JSON.parse(new TextDecoder().decode(proof.fheProof)) as {
      result: boolean;
      predicates: { tradeSizeOk: boolean; lossOk: boolean; positionsOk: boolean };
    };
    expect(decoded.result).toBe(true);
    expect(decoded.predicates.tradeSizeOk).toBe(true);
    expect(decoded.predicates.lossOk).toBe(true);
    expect(decoded.predicates.positionsOk).toBe(true);

    // All six handles must be 32 bytes
    expect(handles.tradeSizeBpsHandle.length).toBe(32);
    expect(handles.dailyLossBpsHandle.length).toBe(32);
    expect(handles.maxOpenPosHandle.length).toBe(32);
  });

  it("returns result=false when trade size exceeds maxTradeBps", async () => {
    const { proof } = await proveCompliance(
      baseState,
      {
        type:         "swap",
        protocol:     new Uint8Array(32),
        assetIn:      new Uint8Array(32),
        assetOut:     new Uint8Array(32),
        amount:       60_000n, // 6% of AUM, exceeds maxTradeSizeBps=500
        minAmountOut: 0n,
      },
      guardrails,
    );

    const decoded = JSON.parse(new TextDecoder().decode(proof.fheProof));
    expect(decoded.result).toBe(false);
    expect(decoded.predicates.tradeSizeOk).toBe(false);
  });

  it("returns result=false when daily loss exceeds lossLimitBps", async () => {
    const { proof } = await proveCompliance(
      { ...baseState, dailyPnlBps: -350 }, // 3.5% loss, exceeds lossLimitBps=200
      {
        type:         "swap",
        protocol:     new Uint8Array(32),
        assetIn:      new Uint8Array(32),
        assetOut:     new Uint8Array(32),
        amount:       10_000n,
        minAmountOut: 0n,
      },
      guardrails,
    );
    const decoded = JSON.parse(new TextDecoder().decode(proof.fheProof));
    expect(decoded.result).toBe(false);
    expect(decoded.predicates.lossOk).toBe(false);
  });

  it("returns result=false when open positions reach maxOpenPositions", async () => {
    const fivePositions = Array.from({ length: 5 }, (_, i) => ({
      assetMint:  new Uint8Array(32),
      size:       1n,
      entryPrice: 100n,
      protocol:   new Uint8Array(32),
      openedAt:   i,
    }));

    const { proof } = await proveCompliance(
      { ...baseState, positions: fivePositions },
      {
        type:         "swap",
        protocol:     new Uint8Array(32),
        assetIn:      new Uint8Array(32),
        assetOut:     new Uint8Array(32),
        amount:       10_000n,
        minAmountOut: 0n,
      },
      guardrails, // maxOpenPositions=5, predicate is open < max → 5 < 5 is false
    );
    const decoded = JSON.parse(new TextDecoder().decode(proof.fheProof));
    expect(decoded.result).toBe(false);
    expect(decoded.predicates.positionsOk).toBe(false);
  });

  it("produces a 32-byte resultCommitment", async () => {
    const { proof } = await proveCompliance(
      baseState,
      {
        type:         "swap",
        protocol:     new Uint8Array(32),
        assetIn:      new Uint8Array(32),
        assetOut:     new Uint8Array(32),
        amount:       10_000n,
        minAmountOut: 0n,
      },
      guardrails,
    );
    expect(proof.resultCommitment.length).toBe(32);
    // Must not be all zeroes (commitment was actually computed)
    expect(proof.resultCommitment.some((b) => b !== 0)).toBe(true);
  });
});

describe("@warden/fhe — state encrypt/decrypt round-trip", () => {
  it("encrypts and decrypts a PlaintextState losslessly", async () => {
    const fhePrivateKey = new Uint8Array(32);
    crypto.getRandomValues(fhePrivateKey);
    // The state.ts derivePublicKey reverses bytes — so encrypt with the
    // reversed-bytes "public key" the same way it derives internally.
    const fhePublicKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) fhePublicKey[i] = fhePrivateKey[31 - i];

    const original = {
      positions: [
        {
          assetMint:  new Uint8Array(32).fill(0x11),
          size:       12_345_678n,
          entryPrice: 99_999n,
          protocol:   new Uint8Array(32).fill(0x22),
          openedAt:   1_700_000_000,
        },
      ],
      totalAumUsd: 5_000_000n,
      dailyPnlBps: -123,
      snapshotAt:  1_700_000_500,
    };

    const ciphertext = await encryptState(original, fhePublicKey);
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(ciphertext[0]).toBe(0x01); // version tag

    const decrypted = await decryptState(ciphertext, fhePrivateKey);

    expect(decrypted.totalAumUsd).toBe(original.totalAumUsd);
    expect(decrypted.dailyPnlBps).toBe(original.dailyPnlBps);
    expect(decrypted.snapshotAt).toBe(original.snapshotAt);
    expect(decrypted.positions.length).toBe(1);
    expect(decrypted.positions[0].size).toBe(original.positions[0].size);
    expect(decrypted.positions[0].entryPrice).toBe(original.positions[0].entryPrice);
    expect(decrypted.positions[0].openedAt).toBe(original.positions[0].openedAt);
  });

  it("rejects ciphertext with an unknown version tag", async () => {
    const bad   = new Uint8Array([0x99, 0x01, 0x02, 0x03]);
    const key   = new Uint8Array(32);
    await expect(decryptState(bad, key)).rejects.toThrow("Unknown ciphertext version");
  });

  it("rejects ciphertext that is too short", async () => {
    const bad = new Uint8Array([]);
    const key = new Uint8Array(32);
    await expect(decryptState(bad, key)).rejects.toThrow("too short");
  });
});
