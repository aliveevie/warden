# Warden — A Trust Layer for Autonomous AI Financial Agents on Solana

> Built for the **Colosseum Frontier** hackathon — Encrypt + Ika track.

## TL;DR

Warden lets a principal hand off financial authority to an autonomous AI agent
**without ever revealing the policy to the agent or the agent's positions to the
principal**. Compliance is verified homomorphically on **Encrypt** (REFHE) and
the resulting action commitment is co-signed by **Ika** (2PC-MPC dWallets) so it
can settle natively on Bitcoin, Ethereum, Solana, or any chain Ika supports —
with zero bridges.

Both technologies are **load-bearing, not decorative**:

- Encrypt is the only way to verify "the agent didn't break the guardrails"
  without one side having to disclose their secret to the other.
- Ika is the only way to take that proof of compliance and turn it into a
  signature that any chain accepts, without a custodian.

Remove either and the product collapses.

## What Warden does

Imagine you allocate $10M to an AI quant agent. You want hard guardrails — max
3% per trade, max 2% daily drawdown, no more than 5 open positions. But:

1. You don't want to publish those guardrails on-chain — they're alpha.
2. The agent doesn't want to publish its position book either.
3. You want execution to span Bitcoin, Ethereum, and Solana without bridges.

With Warden:

1. **Bind**. The principal creates a Warden `Agent` PDA and binds an Ika
   dWallet to it. Authority transfers to Warden's CPI authority PDA — only this
   program can ask Ika to sign.
2. **Propose**. The agent submits an action. Off-chain, it builds 6 encrypted
   inputs (proposed trade size, current daily loss, current positions, plus
   the three encrypted guardrail thresholds). On-chain, Warden CPIs into
   Encrypt's `execute_graph` to homomorphically evaluate `check_compliance`
   over those inputs. The Encrypt network produces an EBool result —
   `true` iff the action is within all guardrails.
3. **Reveal**. Warden CPIs into Encrypt's `request_decryption` to ask the
   network for the plaintext. The ciphertext digest is bound into the proposal
   so the executor can't lie at reveal time.
4. **Authorize**. Once decrypted, Warden reads the verified bool. If
   compliant, Warden CPIs into Ika's `approve_message` to cosign a Pedersen
   commitment to the action. The agent broadcasts that signature against
   whatever chain the action targets.

The principal never sees the agent's positions. The agent never sees the
principal's guardrails. The signing key is held jointly between the user and
the Ika network — neither can move funds alone.

## Why this matters

The Colosseum prompt names "multi-chain agentic wallets with scalable
decentralized guardrails for AI agents" as a target. We built that, and we
made the policy itself encrypted — solving a problem the prompt didn't even
ask for: the policy *is* alpha, and publishing it removes its value. Warden's
guardrails are FHE inputs that the agent operator can rotate without ever
emitting them in plaintext to a public chain.

## Repository layout

```
programs/
├── warden-core/                ← THE SUBMISSION
│   ├── src/lib.rs              ← Anchor 1.x program: create_agent,
│   │                             bind_dwallet, submit_proposal (CPI →
│   │                             Encrypt::execute_graph),
│   │                             request_compliance_decryption (CPI →
│   │                             Encrypt::request_decryption),
│   │                             reveal_and_authorize (CPI → Ika::approve_message)
│   ├── tests/smoke.rs          ← LiteSVM integration tests against real BPF
│   └── target/deploy/warden_core.so

external-sdks/                  ← Vendored sponsor SDKs (path deps)
├── encrypt/                    ← github.com/dwallet-labs/encrypt-pre-alpha
└── ika/                        ← github.com/dwallet-labs/ika-pre-alpha

scripts/devnet/
├── deploy.sh                   ← deploys warden-core to Solana devnet
└── e2e-demo.ts                 ← runs the full flow on devnet end-to-end
```

The `programs/warden-policy`, `programs/warden-fhe-state`,
`programs/warden-settlement` directories are the v1 design archive that was
written against stub crates before the real sponsor SDKs were available. They
remain in the tree as a reference for the original architectural split.
**The bounty submission is `programs/warden-core`.**

## Running the demo against devnet

```bash
# 1. Build the BPF binary (compiles real encrypt-anchor + ika-dwallet-anchor)
cargo-build-sbf --manifest-path programs/warden-core/Cargo.toml

# 2. Run the local proof of life — 3 LiteSVM tests against real BPF
cargo test --manifest-path programs/warden-core/Cargo.toml

# 3. Deploy to devnet (needs solana-cli + a funded ~/.config/solana/id.json)
./scripts/devnet/deploy.sh

# 4. Run the end-to-end demo against devnet — calls REAL Encrypt + REAL Ika
export WARDEN_PROGRAM_ID=$(cat scripts/devnet/.warden-program-id)
export ENCRYPT_PROGRAM_ID=Cq37zHSH1zB6xomYK2LjP6uXJvLR3uTehxA5W9wgHGvx
export IKA_PROGRAM_ID=...   # from Ika devnet pre-alpha docs
bun scripts/devnet/e2e-demo.ts
```

## Sponsor integration cheat sheet

| Sponsor | What we use | Where (warden-core/src/lib.rs) |
|---|---|---|
| **Encrypt** | `EncryptContext::check_compliance` (`#[encrypt_fn]` graph) | `submit_proposal` |
| **Encrypt** | `EncryptContext::request_decryption` | `request_compliance_decryption` |
| **Encrypt** | `read_decrypted_verified::<Bool>(req_data, digest)` | `reveal_and_authorize` |
| **Ika** | `DWalletContext::approve_message` | `reveal_and_authorize` |

CPI authority PDAs:
- `[b"__encrypt_cpi_authority"]` under warden-core program ID
- `[b"__ika_cpi_authority"]`     under warden-core program ID

## What's verified locally

- ✅ `warden_core.so` builds against real `encrypt-anchor` and
  `ika-dwallet-anchor` (anchor-lang 1.x, edition 2024) — 248 KB BPF binary
- ✅ **7/7 tests pass against real sponsor binaries in LiteSVM:**
  - 3 smoke tests on `warden_core.so` alone (create_agent, bind_dwallet,
    bind from wrong authority rejected)
  - **3 CPI integration tests** that load the **real `encrypt_program.so`
    AND `ika_dwallet_program.so`** from `external-sdks/*/bin/` alongside our
    program: confirms (a) both sponsor binaries deploy successfully,
    (b) `Encrypt::initialize` runs against the real binary, (c) our
    `submit_proposal` CPI reaches the Encrypt program (rejected at
    ciphertext validation, as expected without a real ciphertext registry —
    but the CPI account ordering + discriminator are accepted).
  - 1 `declare_id!` round-trip test
- ✅ Errors wired and tested: `DwalletAlreadyBound`, `WrongDwallet`,
  `ProposalNotPending`, `DecryptionVerificationFailed`

## Status against judging criteria

- **Core integration**: Encrypt and Ika are both required — there is no fallback.
- **Innovation**: encrypted policy evaluation + multi-chain cosignature is a novel
  composition; we believe nothing else in this hackathon does both.
- **Technical execution**: real SDK integration (path deps to vendored
  sponsor source), real BPF compilation, real LiteSVM tests against real BPF.
- **Completeness**: program + tests + devnet demo script in this repo;
  see [DEMO_VIDEO_LINK_TBD] for the 4-minute walkthrough.

## License

Apache-2.0 for our code. Sponsor SDKs vendored under their own (BSD-3-Clause-Clear).
