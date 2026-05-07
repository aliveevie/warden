<div align="center">

# Warden

### A confidential trust layer for autonomous AI financial agents on Solana.

Encrypt-evaluated guardrails. Ika-cosigned execution. Zero plaintext policy on-chain.

[Demo video](https://youtu.be/5A1iZhqYHYw) · [Pull request #1 — Ika × Encrypt integration](https://github.com/aliveevie/warden/pull/1) · [Author](https://github.com/aliveevie)

</div>

---

## Table of contents

- [The problem](#the-problem)
- [What Warden is](#what-warden-is)
- [How it works (end-to-end)](#how-it-works-end-to-end)
- [Why Encrypt and Ika are both load-bearing](#why-encrypt-and-ika-are-both-load-bearing)
- [On-chain surface](#on-chain-surface)
- [Live devnet artefacts](#live-devnet-artefacts)
- [Repository layout](#repository-layout)
- [Running it yourself](#running-it-yourself)
- [Test evidence](#test-evidence)
- [Highlights from PR #1](#highlights-from-pr-1)
- [Roadmap](#roadmap)
- [License](#license)

---

## The problem

You allocate capital to an autonomous AI agent — a market-making bot, a treasury rebalancer, a yield router. You want hard guardrails: max 3 % per trade, max 2 % daily drawdown, no more than five concurrent positions. You also want execution to span Bitcoin, Ethereum, and Solana without bridges or custodians.

Three things make this hard today.

1. **Policy is alpha.** Publishing the guardrails on a public chain destroys their value — the moment the limits are visible, every other agent front-runs them.
2. **Position state is private.** The agent does not want to publish its position book either. So neither side can give the other the inputs needed to verify compliance the obvious way.
3. **Authority must be multi-chain.** The agent does not live on one chain; the policy does. Bridging the verdict is a custody hop and a new trust assumption.

Warden solves all three on real, deployed infrastructure.

## What Warden is

`warden-core` is an Anchor program on Solana devnet at  
**`Htrj84e45UCgFTfn7GfDoHZHRRiPC8Lr74PD3mKdtBFq`**.

It is the only legal path between an autonomous agent and its multi-chain dWallet. Every action the agent wants to sign must:

1. Pass a homomorphically-evaluated compliance graph on the **Encrypt** network (so neither the policy nor the action ever leaves ciphertext on-chain), and
2. Receive a co-signature from the agent's **Ika** dWallet via a Warden-controlled CPI authority (so the boolean from step 1 is enforceable across every chain Ika supports).

Both steps are mandatory. There is no bypass instruction.

## How it works (end-to-end)

```text
                 PRINCIPAL                                     AGENT
                     |                                           |
                     | 1. create_agent + bind_dwallet            |
                     v                                           |
            +------------------+                                 |
            |  warden-core     |                                 |
            |  (this program)  |  <-------- 2. submit_proposal --+
            +------------------+
                |       |
                | CPI   | (encrypted inputs: trade-size, daily-loss,
                v       |  open-positions vs encrypted guardrails)
       +-----------------+
       |  Encrypt        |  3. execute_graph(check_compliance) ---> EBool ciphertext
       |  REFHE network  |
       +-----------------+
                |
                | 4. request_decryption  (digest pinned in proposal state)
                v
       network publishes plaintext into decryption_request account
                |
                | 5. reveal_and_authorize
                v
            +------------------+
            |  warden-core     |
            +------------------+
                |
                | CPI (only if EBool == true)
                v
       +-----------------+      6. approve_message(result_commitment)
       |  Ika dWallet    |  ----------------------------------------> agent broadcasts
       |  2PC-MPC        |                                           on BTC / ETH / SOL / ...
       +-----------------+
```

**Step by step:**

1. **Bind.** The principal calls `create_agent` and `bind_dwallet`. The dWallet's signing authority is held by the Warden PDA `[b"__ika_cpi_authority"]` — only this program can request an Ika co-signature for that agent.
2. **Propose.** Off-chain, the agent encrypts six `EUint64` values via Encrypt's gRPC (`CreateInput`): the proposed trade size, the rolling daily loss, the open-position count, plus the principal's three encrypted guardrail thresholds. Then it calls `submit_proposal`, which CPIs `Encrypt::execute_graph`. Encrypt's network homomorphically evaluates `check_compliance` and writes a verified `EBool` ciphertext into the output account.
3. **Reveal.** Anyone can call `request_compliance_decryption`. Warden CPIs `Encrypt::request_decryption` and **pins the ciphertext digest into proposal state** so a later reveal cannot be substituted by a malicious executor.
4. **Authorize.** Once the network publishes the plaintext, `reveal_and_authorize` reads `read_decrypted_verified::<Bool>(req_data, digest)`. If `true`, Warden CPIs `Ika::approve_message` to co-sign the action's `result_commitment` (a Pedersen commitment to the plaintext action). If `false`, the proposal is permanently marked `Rejected`.

The principal never sees the agent's positions. The agent never sees the principal's guardrails. The signing key is held jointly between user and Ika network — neither can move funds alone.

## Why Encrypt and Ika are both load-bearing

| Layer | What we use | Why it can't be removed |
| ----- | ----------- | ----------------------- |
| **Encrypt** | `#[encrypt_fn] check_compliance` graph + `execute_graph` + `request_decryption` + `read_decrypted_verified` | The policy is the alpha. Without homomorphic evaluation, either the principal publishes the rules (dead product) or runs an off-chain oracle (custodial). Encrypt is the only way to get programmable, private, on-chain policy in normal Rust. |
| **Ika** | `DWalletContext::approve_message` with the dWallet authority delegated to Warden's PDA | The verdict has to translate into a signature on every chain the agent operates on. Without a 2PC-MPC dWallet, the agent either holds its own keys (no enforcement) or each chain needs a bespoke threshold-signing network. Ika is the only practical multi-chain primitive. |

Pull either out and Warden has no product.

## On-chain surface

The compliance graph itself is just plain Rust, lifted into FHE by `#[encrypt_fn]`:

```rust
#[encrypt_fn]
fn check_compliance(
    trade_size_bps: EUint64, daily_loss_bps: EUint64, open_positions: EUint64,
    max_trade_bps:  EUint64, loss_limit_bps: EUint64, max_open_pos:   EUint64,
) -> EBool {
    let size_ok      = trade_size_bps.is_less_or_equal(&max_trade_bps);
    let loss_ok      = daily_loss_bps.is_less_or_equal(&loss_limit_bps);
    let positions_ok = open_positions.is_less_than(&max_open_pos);
    size_ok.and(&loss_ok).and(&positions_ok)
}
```

`warden-core` exposes five instructions:

| Instruction | Purpose | CPI |
| ----------- | ------- | --- |
| `create_agent`                 | Create the `Agent` PDA owned by the principal.                                | — |
| `bind_dwallet`                 | Persist the Ika dWallet pubkey on the agent.                                  | — |
| `submit_proposal`              | Run `check_compliance` over six encrypted inputs.                             | `Encrypt::execute_graph` |
| `request_compliance_decryption`| Ask the Encrypt network to decrypt the EBool result; pin digest in state.     | `Encrypt::request_decryption` |
| `reveal_and_authorize`         | Verify digest, read bool, and co-sign on success.                             | `Ika::approve_message` |

State is two PDA-anchored accounts: `Agent` (principal authority, dWallet binding, counters) and `Proposal` (status, ciphertext pubkey, digest, commitment, timestamps).

CPI authority PDAs:
- `[b"__encrypt_cpi_authority"]` under warden-core's program ID
- `[b"__ika_cpi_authority"]` under warden-core's program ID

## Live devnet artefacts

| Resource | Value |
| --- | --- |
| `warden-core` program | `Htrj84e45UCgFTfn7GfDoHZHRRiPC8Lr74PD3mKdtBFq` |
| Encrypt program | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| Ika dWallet program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Encrypt gRPC endpoint | `pre-alpha-dev-1.encrypt.ika-network.net:443` |
| Solana RPC | `https://api.devnet.solana.com` |
| BPF binary size | 248 KB |

## Repository layout

```
programs/
├── warden-core/                ← the deployed program
│   ├── src/lib.rs              ← 5 instructions: create_agent, bind_dwallet,
│   │                             submit_proposal, request_compliance_decryption,
│   │                             reveal_and_authorize
│   ├── tests/smoke.rs          ← LiteSVM smoke tests
│   ├── tests/cpi_integration.rs← CPI tests against the real Encrypt + Ika BPF binaries
│   └── target/deploy/warden_core.so
├── warden-policy/              ← v1 design archive (pre-SDK stubs)
├── warden-fhe-state/           ← v1 design archive
└── warden-settlement/          ← v1 design archive

external-sdks/
├── encrypt/                    ← github.com/dwallet-labs/encrypt-pre-alpha (vendored as path dep)
└── ika/                        ← github.com/dwallet-labs/ika-pre-alpha (vendored as path dep)

scripts/devnet/
├── keygen.ts                   ← mint / load a devnet payer
├── deploy.sh                   ← legacy shell deploy
├── deploy.ts                   ← BPFLoaderUpgradeable deploy with bincode-correct Write
├── upgrade.ts                  ← in-place upgrade (saves rent vs re-deploy)
├── close-buffer.ts             ← reclaim SOL from orphaned BPFLoader buffers
└── e2e-demo.ts                 ← full Encrypt + Ika flow against devnet

app/                            ← Next.js dashboard reading warden-core PDAs live
packages/                       ← shared TS types and helpers
```

The `warden-policy`, `warden-fhe-state`, and `warden-settlement` directories are kept as a reference for the original architectural split, written against stub crates before the real Encrypt and Ika SDKs were available. The active program is `programs/warden-core`.

## Running it yourself

Prerequisites: Solana CLI ≥ 1.18, Rust toolchain with `cargo-build-sbf`, Node ≥ 18.

```bash
# 1. Install JS deps (tsx is used to run the devnet scripts on plain Node)
npm install

# 2. Build the BPF binary against the real encrypt-anchor / ika-dwallet-anchor
cargo-build-sbf --manifest-path programs/warden-core/Cargo.toml

# 3. Run the local proof of life: 7/7 LiteSVM tests against the real Encrypt + Ika BPF
cargo test --manifest-path programs/warden-core/Cargo.toml

# 4. Mint or load a devnet payer (~/.config/solana/id.json by default).
#    Devnet airdrop is captcha-gated from cloud egress; if it stalls, fund the
#    wallet manually at https://faucet.solana.com.
npm run devnet:keygen

# 5. Deploy or upgrade warden-core
npm run devnet:deploy        # first time
# npm run devnet:upgrade     # subsequent times — much cheaper

# 6. Run the full end-to-end demo against real Encrypt + real Ika on devnet
export WARDEN_PROGRAM_ID=$(cat scripts/devnet/.warden-program-id)
npm run devnet:e2e
```

The `e2e-demo.ts` script walks all six steps end-to-end and prints a per-step trace (`[1/7] Setup …` → `[7/7] reveal_and_authorize …`).

## Test evidence

`cargo test --manifest-path programs/warden-core/Cargo.toml` — **7/7 passing**:

- 3 smoke tests on `warden_core.so` alone — `create_agent`, `bind_dwallet`, and rejection of `bind_dwallet` from a non-authority.
- 3 CPI integration tests that load `encrypt_program.so` **and** `ika_dwallet_program.so` from `external-sdks/*/bin/` alongside our program in LiteSVM. They confirm:
  - Both Encrypt and Ika binaries deploy successfully.
  - `Encrypt::initialize` runs against the real binary.
  - `submit_proposal` reaches the Encrypt program with valid CPI account ordering and discriminator (rejected at ciphertext validation, as expected without a populated ciphertext registry).
- 1 `declare_id!` round-trip test.

Wired and asserted error codes: `DwalletAlreadyBound`, `WrongDwallet`, `ProposalNotPending`, `ProposalNotDecrypting`, `DecryptionVerificationFailed`.

## Highlights from PR #1

[PR #1 — Warden — Ika dWallet × Encrypt FHE compliance layer](https://github.com/aliveevie/warden/pull/1) lands the Ika + Encrypt integration in 20 atomic, reviewable commits. Notable items:

- **BPFLoader bincode fix.** `deploy.ts` now uses `u64` length prefixes for `Vec<u8>` per bincode spec — fixes `invalid instruction data` on `Write`.
- **Programdata rent optimisation.** `max_data_len` is tightened to actual program size, saving ~1 SOL of programdata rent on every deploy.
- **In-place `upgrade.ts`** via `UpgradeableLoaderInstruction::Upgrade` (tag 3) — buffer rent spills back to payer.
- **`close-buffer.ts`** reclaims SOL from orphaned BPFLoader buffers via tag 5.
- **Real Encrypt and Ika program IDs.** `e2e-demo.ts` now points at the actual deployed devnet binaries — previous defaults were doc placeholders.
- **Idempotent deposit creation.** Encrypt deposit PDA is reused across runs.
- **Correct chain enum + FHE type id.** `chain: SOLANA = 0` (was 1, which is `INVALID_ARGUMENT`); `FHE_UINT64 = 4` (was 5, which is `Uint128` and triggers `ConstraintRaw`).
- **Output-ciphertext signer-escalation workaround.** `e2e-demo.ts` pre-creates the EBool output via gRPC `CreateInput` so `Encrypt::execute_graph` updates an existing account rather than failing to call `system::create_account` from a stripped-signer "remaining" account.
- **Upstream SDK patch.** `external-sdks/encrypt/.../anchor/src/lib.rs` now forwards `is_signer = true` for the `decryption_request` account in `EncryptContext::request_decryption` — fixes the same signer-escalation class of bug for the decryption flow.

Full commit list and rationale: see the PR.

## Roadmap

- **Multi-policy agents.** Today the guardrail set is a single `EUint64` triple. Next: arbitrary user-defined `#[encrypt_fn]` graphs with structured input schemas registered at `bind_dwallet` time.
- **Off-chain executor.** A reference TypeScript executor that watches `ProposalSubmitted` events, drives the Encrypt network for decryption, and submits `reveal_and_authorize` automatically.
- **Cross-chain settlement adapters.** EVM and Bitcoin executors that take an Ika-cosigned `result_commitment` and broadcast a corresponding tx on the target chain, with proof of inclusion fed back to Solana.
- **SDK PRs upstream.** Land the `is_signer` fixes in `encrypt-anchor` and propose a typed signer-list API for `execute_graph` so callers can opt new ciphertexts in cleanly.

## License

Apache-2.0 for everything in this repo authored by us. The Encrypt and Ika SDKs vendored under `external-sdks/` retain their original BSD-3-Clause-Clear license.
