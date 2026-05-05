# Warden — End-to-End System Architecture

---

## 1. System Overview

Warden is a multi-layer protocol that combines on-chain policy enforcement, cross-chain custody, confidential computation, private settlement, and locally-sovereign AI inference into a unified agent execution framework. The system is composed of four distinct planes that interact through well-defined interfaces:

| Plane | Responsibility |
|---|---|
| **Custody Plane** | Cross-chain asset control via Ika dWallets; policy enforcement via Anchor programs |
| **Computation Plane** | FHE-encrypted on-chain strategy state via Encrypt (REFHE protocol) |
| **Settlement Plane** | Confidential transfer execution and audit trail via Umbra SDK |
| **Intelligence Plane** | Local AI inference, RAG, and proposal generation via QVAC SDK |

These planes are deliberately decoupled. Each exposes a typed interface consumed by the Agent Orchestration Layer, which coordinates their interaction without creating cross-plane dependencies.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PRINCIPAL DEVICE                                 │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    INTELLIGENCE PLANE (QVAC)                         │   │
│  │                                                                      │   │
│  │  ┌────────────────┐  ┌───────────────────┐  ┌────────────────────┐  │   │
│  │  │  LLM Engine    │  │  Embedding / RAG  │  │  STT / Voice Input │  │   │
│  │  │ (llm-llamacpp) │  │ (embed-llamacpp)  │  │ (whispercpp)       │  │   │
│  │  └───────┬────────┘  └────────┬──────────┘  └──────────┬─────────┘  │   │
│  │          └───────────────────┼─────────────────────────┘            │   │
│  │                              ▼                                       │   │
│  │              ┌───────────────────────────────┐                       │   │
│  │              │     Action Proposal Engine    │                       │   │
│  │              │  (generates signed proposals) │                       │   │
│  │              └───────────────┬───────────────┘                       │   │
│  └──────────────────────────────┼───────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼───────────────────────────────────────┐   │
│  │              AGENT ORCHESTRATION LAYER (TypeScript SDK)              │   │
│  │                                                                      │   │
│  │   Policy Loader  ──────  Proposal Validator  ──────  Tx Builder      │   │
│  │        │                        │                        │           │   │
│  │        ▼                        ▼                        ▼           │   │
│  │   [Custody]              [FHE Verifier]           [Settlement]       │   │
│  │   Ika Client             Encrypt Client           Umbra Client       │   │
│  └──────┬────────────────────────┬─────────────────────────┬────────────┘   │
└─────────┼────────────────────────┼─────────────────────────┼────────────────┘
          │                        │                         │
          ▼                        ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SOLANA NETWORK (Devnet → Mainnet)                    │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐ │
│  │  warden-policy   │   │  warden-fhe-state    │   │  warden-settlement  │ │
│  │  (Anchor)        │   │  (Anchor + Encrypt)  │   │  (Anchor + Umbra)   │ │
│  │                  │   │                      │   │                     │ │
│  │  PolicyAccount   │   │  EncryptedStateAcct  │   │  SettlementVault    │ │
│  │  AgentAccount    │   │  FHE computation     │   │  ViewingKeyRegistry │ │
│  │  GuardrailSet    │   │  Result verification │   │  ConfidentialXfer   │ │
│  └────────┬─────────┘   └──────────┬───────────┘   └──────────┬──────────┘ │
│           └────────────────────────┴──────────────────────────┘            │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
           ┌─────────────────────────┴───────────────────────┐
           ▼                                                  ▼
┌──────────────────────┐                         ┌───────────────────────────┐
│   IKA NETWORK        │                         │   EXTERNAL CHAINS         │
│                      │                         │                           │
│  MPC Coordination    │                         │  Bitcoin (native BTC)     │
│  2PC-MPC Protocol    │◄───────────────────────►│  Ethereum (native ETH)    │
│  dWallet Registry    │                         │  Any EVM / UTXO chain     │
│  Co-signing Service  │                         │                           │
└──────────────────────┘                         └───────────────────────────┘
```

---

## 3. On-Chain Programs

### 3.1 `warden-policy` Program

Manages agent lifecycle, policy definitions, and execution authorization. Written in Rust using the Anchor framework.

**Accounts**

```rust
PolicyAccount {
    authority:             Pubkey,       // Principal's signing key
    agent_id:              [u8; 32],     // Deterministic agent identifier
    ika_dwallet_id:        [u8; 32],     // Bound Ika dWallet address
    guardrail_set:         GuardrailSet, // Embedded policy parameters
    nonce:                 u64,          // Replay protection
    paused:                bool,         // Emergency kill switch
    created_at:            i64,
    last_execution:        i64,
}

GuardrailSet {
    max_trade_size_bps:    u16,          // Max trade as bps of AUM
    allowed_protocols:     [Pubkey; 16], // Whitelisted program IDs
    cooldown_seconds:      u32,          // Min interval between executions
    max_open_positions:    u8,           // Concurrent position limit
    allowed_assets:        [Pubkey; 32], // Whitelisted token mints
    daily_loss_limit_bps:  u16,          // Max drawdown per calendar day
}

AgentAccount {
    policy:                Pubkey,       // Linked PolicyAccount
    proposal_count:        u64,          // Total proposals processed
    total_volume:          u128,         // Cumulative settled volume (scaled)
    state_account:         Pubkey,       // Linked EncryptedStateAccount
    settlement_vault:      Pubkey,       // Linked SettlementVault
}
```

**Instructions**

| Instruction | Signers | Description |
|---|---|---|
| `initialize_policy` | authority | Deploys a new policy and guardrail set |
| `bind_dwallet` | authority | Associates an Ika dWallet with the agent |
| `update_guardrails` | authority | Modifies policy parameters (24-hour timelock enforced) |
| `pause_agent` | authority | Emergency halt; blocks all proposal execution |
| `resume_agent` | authority + ika_coauth | Resumes after halt with dual authorization |
| `authorize_proposal` | CPI from warden-fhe-state | Marks a proposal as policy-verified |
| `close_agent` | authority | Finalizes agent and settles remaining positions |

**Timelock:** `update_guardrails` stores a `PendingUpdate` account on-chain. A permissionless crank can apply it only after 24 hours have elapsed. This prevents an attacker who has compromised the authority key from silently widening the policy and draining assets in the same transaction.

---

### 3.2 `warden-fhe-state` Program

Manages encrypted position state and FHE computation verification. Integrates with the Encrypt network (REFHE protocol) for confidential on-chain computation.

**Accounts**

```rust
EncryptedStateAccount {
    agent:               Pubkey,     // Owning AgentAccount
    fhe_ciphertext:      Vec<u8>,    // REFHE-encrypted position blob
    fhe_pubkey_hash:     [u8; 32],   // Hash of the FHE encryption public key
    state_version:       u64,        // Monotonic version counter
    last_computation:    i64,
    computation_count:   u64,
}

ProposalAccount {
    agent:               Pubkey,
    proposer:            Pubkey,     // Off-chain agent signer (ephemeral key)
    encrypted_intent:    Vec<u8>,    // REFHE-encrypted action intent
    fhe_proof:           Vec<u8>,    // REFHE proof of policy compliance
    result_commitment:   [u8; 32],   // Pedersen commitment to the plain result
    status:              ProposalStatus,
    created_at:          i64,
    expires_at:          i64,
}

enum ProposalStatus {
    Pending,
    VerifiedCompliant,
    VerifiedNonCompliant,
    Executed,
    Expired,
}
```

**FHE Computation Flow**

```
Off-chain (Principal Device):

  1. Agent Orchestration Layer reads current EncryptedStateAccount.fhe_ciphertext
     and decrypts it locally using the principal's FHE private key.

  2. LLM (QVAC) generates an action intent: e.g.,
       { swap: { from: BTC, to: USDC, amount: 0.5 }, protocol: Jupiter }

  3. The intent is re-encrypted under the agent's REFHE public key
     → encrypted_intent

  4. The REFHE prover runs locally and generates a compliance proof:
       "encrypted_intent satisfies all GuardrailSet predicates
        without revealing position state or action parameters"

  5. ProposalAccount is created on-chain with:
       encrypted_intent, fhe_proof, result_commitment

On-chain (warden-fhe-state):

  6. verify_proposal instruction:
       a. Fetches guardrail parameters from PolicyAccount (CPI)
       b. Verifies the REFHE proof against encrypted_intent
          and the guardrail commitments
       c. Checks: cooldown elapsed, not paused, daily loss limit not hit
       d. Sets ProposalAccount.status = VerifiedCompliant | VerifiedNonCompliant

  7. execute_proposal instruction (requires VerifiedCompliant):
       a. CPIs to warden-policy → authorize_proposal
       b. Updates EncryptedStateAccount.fhe_ciphertext with post-action state
       c. Emits an encrypted execution event (no plaintext in logs)
       d. Signals Ika dWallet that co-signing is authorized
```

**Key invariant:** The on-chain program never handles plaintext position data at any step. Guardrail compliance is verified entirely over ciphertext via the REFHE proof. An external observer learns only that the agent executed a policy-compliant action — not what that action was.

---

### 3.3 `warden-settlement` Program

Executes confidential asset transfers for all agent settlements using Umbra SDK primitives.

**Accounts**

```rust
SettlementVault {
    agent:               Pubkey,
    umbra_shield_addr:   Pubkey,     // Agent's Umbra shielded address
    principal_vk_hash:   [u8; 32],   // Hash of principal's viewing key
    compliance_vk_hash:  [u8; 32],   // Hash of compliance officer's viewing key
    total_shielded_in:   u128,       // Cumulative shielded inflows
    total_shielded_out:  u128,       // Cumulative shielded outflows
}

ViewingKeyGrant {
    vault:               Pubkey,
    grantee:             Pubkey,     // Auditor or compliance officer
    encrypted_vk:        Vec<u8>,    // Viewing key encrypted to grantee's pubkey
    scope:               VKScope,
    granted_at:          i64,
    revoked:             bool,
}

enum VKScope {
    Full,
    DateRange   { from: i64, to: i64 },
    PositionSet { position_ids: Vec<[u8; 16]> },
}
```

**Instructions**

| Instruction | Description |
|---|---|
| `initialize_vault` | Creates the SettlementVault; registers the shielded address with Umbra |
| `shield_inflow` | Wraps a plaintext token receipt into an Umbra confidential balance |
| `execute_settlement` | Performs a confidential transfer from the agent vault to a counterparty |
| `unshield_to_principal` | Withdraws shielded balance to the principal's address; requires viewing key |
| `grant_viewing_key` | Issues a scoped viewing key to an auditor or compliance officer |
| `revoke_viewing_key` | Nullifies an outstanding viewing key grant |

---

## 4. Ika dWallet Integration (Custody Plane)

### 4.1 dWallet Binding

Each Warden agent is bound to an Ika dWallet at initialization. The dWallet is a 2PC-MPC construct co-signed by the principal's user key share and the Ika Network's key share. The `warden-policy` program is registered as the enforcement layer — Ika's co-signing service will not produce its share unless a valid `VerifiedCompliant` proposal exists on-chain.

```
dWallet creation:

Principal Device                Ika Network               Solana
────────────────                ───────────               ──────
1. Generate local key share
2. POST /dwallet/create ──────► Register dWallet ID
                                Store Ika key share
3.                              Return dWallet ID ───────► bind_dwallet
                                                           PolicyAccount.ika_dwallet_id = ID

Signing condition registered with Ika Network:
  - PolicyAccount.paused == false
  - ProposalAccount.status == VerifiedCompliant
  - ProposalAccount.result_commitment matches tx being signed
  - Cooldown interval satisfied
```

### 4.2 Cross-Chain Asset Control

Ika's dWallet provides signing capability for any UTXO or account-model chain without wrapping or bridging assets.

```
Cross-chain execution example (sell native BTC, receive USDC settlement on Solana):

Principal Device
  │
  ├── 1. QVAC LLM generates intent: sell 0.5 BTC → USDC
  ├── 2. REFHE prover generates compliance proof
  ├── 3. ProposalAccount created on-chain → status: VerifiedCompliant
  ├── 4. Bitcoin PSBT constructed (spends from dWallet-controlled UTXO)
  │
  └── 5. Request co-signature from Ika Network
          Ika Network:
            a. Queries Solana: ProposalAccount.status == VerifiedCompliant ✓
            b. Verifies result_commitment matches PSBT output
            c. Contributes Ika key share → full Bitcoin signature produced
            d. PSBT finalized and broadcast to Bitcoin mempool

Counterparty (Solana):
  └── 6. USDC settlement routed through warden-settlement
          execute_settlement → Umbra confidential transfer
          → agent SettlementVault (shielded)
```

### 4.3 Guardrail Enforcement at the Signing Layer

Because Ika's co-signature is required for every dWallet transaction, the guardrails are enforced cryptographically, not merely checked in application logic. An attacker who compromises the agent's off-chain process cannot bypass spending limits, cooldowns, or the protocol whitelist — the dWallet simply will not produce a valid signature without on-chain verification.

---

## 5. Encrypt FHE Integration (Computation Plane)

### 5.1 Key Hierarchy

```
Principal Master Keypair (principal device — never leaves device)
    │
    ├─► FHE Encryption Keypair
    │       Public key:   stored as hash in EncryptedStateAccount
    │       Private key:  held only on principal device
    │       Purpose:      encrypts/decrypts position state blob
    │
    ├─► REFHE Proving Key
    │       Purpose:      generates compliance proofs off-chain
    │       Verification key: embedded in warden-fhe-state program
    │
    └─► Agent Signing Key (ephemeral, rotated per session)
            Purpose:      signs ProposalAccount submissions
            Derived from: master keypair via BIP32-style path
```

### 5.2 State Encryption Scheme

The position state blob stored in `EncryptedStateAccount` is a REFHE-encrypted struct:

```
PlaintextState {
    positions: [Position; 32],
    total_aum_usd:     u128,    // Scaled fixed-point
    daily_pnl_bps:     i32,
    open_position_count: u8,
}

Position {
    asset_mint:        [u8; 32],
    size:              u128,    // Scaled fixed-point
    entry_price:       u128,
    protocol:          [u8; 32],
    opened_at:         i64,
}
```

This blob is encrypted with the principal's FHE public key on the device before being written to the account. The program can operate on it homomorphically (via REFHE) without the chain ever seeing plaintext values.

### 5.3 Compliance Proof Circuit

The REFHE proof asserts the following predicates without revealing any inputs:

```
prove(
    encrypted_state:    Ciphertext<PlaintextState>,
    encrypted_intent:   Ciphertext<ActionIntent>,
    guardrail_set:      GuardrailSet,              // public input
    result_commitment:  PedersenCommitment,        // public input
) → Proof

Predicates proven:
  1. intent.trade_size_usd <= (state.total_aum_usd * guardrail.max_trade_size_bps / 10000)
  2. intent.protocol ∈ guardrail.allowed_protocols
  3. intent.asset_mint ∈ guardrail.allowed_assets
  4. (state.open_position_count + delta) <= guardrail.max_open_positions
  5. state.daily_pnl_bps >= -guardrail.daily_loss_limit_bps
  6. result_commitment commits to (post_state, action_summary) correctly
```

The proof is generated off-chain by the REFHE prover on the principal device and verified on-chain by `warden-fhe-state` in the `verify_proposal` instruction.

---

## 6. QVAC Integration (Intelligence Plane)

### 6.1 Component Map

| QVAC Module | Role in Warden |
|---|---|
| `@qvac/llm-llamacpp` | Core decision engine — reads market context, generates action intents |
| `@qvac/embed-llamacpp` | RAG over local trade history, strategy notes, protocol docs |
| `@qvac/transcription-whispercpp` | Voice input for strategy adjustments and policy updates |

All modules run entirely on the principal device. No data is transmitted to any external inference service.

### 6.2 Intelligence Plane Data Flow

```
Market Data Sources (on-chain reads, public APIs)
    │
    ▼
Context Builder
  - Current encrypted state (decrypted locally by FHE private key)
  - Recent trade history (fetched from SettlementVault via viewing key)
  - Strategy parameters (loaded from local RAG index)
  - Live market feeds (Jupiter price API, on-chain oracle reads)
    │
    ▼
@qvac/llm-llamacpp  ◄──  @qvac/embed-llamacpp (RAG retrieval)
    │
    ▼
Action Proposal Generator
  - Output: structured ActionIntent JSON
  - Signed by agent's ephemeral session key
    │
    ▼
REFHE Prover (local)
  - Input:  ActionIntent + current PlaintextState
  - Output: encrypted_intent + fhe_proof + result_commitment
    │
    ▼
Agent Orchestration Layer
  - Submits ProposalAccount to Solana
```

### 6.3 RAG Index

The local RAG index (`@qvac/embed-llamacpp`) is maintained on the principal device and updated continuously:

```
Index contents:
  - Agent's own trade history (decrypted from SettlementVault viewing key)
  - Strategy configuration documents (plain text, authored by principal)
  - Protocol documentation (Jupiter, Orca, Drift — indexed at setup)
  - Risk notes authored by the principal

Embedding model: local (no internet required after initial model download)
Storage:         local SQLite with vector extension (e.g., sqlite-vss)
Update cadence:  after each executed ProposalAccount
```

### 6.4 Voice Interface

`@qvac/transcription-whispercpp` enables offline voice commands for strategy adjustment:

```
Supported voice commands (examples):
  "Reduce max position size to five percent"
    → updates local strategy config → triggers update_guardrails (with timelock)

  "Pause the agent"
    → calls pause_agent instruction immediately (no timelock)

  "Show me today's performance"
    → decrypts SettlementVault history locally → summarized by LLM → spoken reply
```

Voice commands are parsed by the local LLM, converted to typed SDK calls, and require a hardware confirmation (button press or biometric) before any on-chain instruction is submitted.

---

## 7. Umbra SDK Integration (Settlement Plane)

### 7.1 Shielded Address Lifecycle

```
Agent initialization:
  1. warden-settlement generates a deterministic shielded address
     derived from the AgentAccount public key + a blinding factor
  2. Shielded address registered with the Umbra protocol
  3. Address stored in SettlementVault.umbra_shield_addr

Inflow (trade proceeds arrive):
  1. Counterparty sends USDC/SOL to the agent's public address
  2. shield_inflow wraps the receipt into Umbra confidential balance
  3. Public record: "some amount was shielded" — no amount or origin visible

Outflow (rebalancing, yield collection, principal withdrawal):
  1. execute_settlement constructs an Umbra confidential transfer
  2. Recipient's shielded address and transfer amount are encrypted
  3. Public record: "a shielded transfer occurred" — nothing else visible

Principal withdrawal:
  1. unshield_to_principal decrypts via viewing key
  2. Transfers from shielded → principal's designated withdrawal address
  3. Optional: generate compliance report before unshielding
```

### 7.2 Viewing Key Architecture

Warden issues three categories of viewing keys:

```
VK Type           Holder              Scope                   Use
──────────────    ──────────────────  ──────────────────────  ─────────────────────────
Principal VK      Agent principal     Full (all time)         Full audit, tax reporting
Compliance VK     Auditor / regulator DateRange or PositionSet  Regulatory disclosure
Counterparty VK   Trade counterparty  PositionSet (single)    Verify receipt of funds
```

Viewing keys are issued on-chain via `grant_viewing_key` and encrypted to the grantee's public key before storage. The Warden application provides a local decryption UI — the grantee pastes their private key, the app decrypts the VK locally, and renders a full settlement report without any data leaving their device.

### 7.3 Compliance Report Generation

```
Local report generation flow (no external service required):

1. Principal loads viewing key (decrypted locally)
2. warden-settlement fetches all SettlementVault events for the VKScope period
3. QVAC LLM summarizes the decrypted history:
     - Total inflows / outflows by asset
     - Per-trade settlement details
     - Net PnL (computed from decrypted state snapshots)
     - Protocol-level breakdown
4. Report exported as PDF (local render) or JSON
5. Optional: Merkle proof of completeness generated from on-chain event log
```

---

## 8. Agent Orchestration Layer

The Agent Orchestration Layer is a TypeScript process running on the principal device. It is the single integration point across all four planes.

### 8.1 Module Structure

```
packages/
├── @warden/sdk                    # Public SDK (agent deployment + management)
│   ├── agent.ts                   # Agent lifecycle (create, pause, close)
│   ├── policy.ts                  # Policy + guardrail management
│   └── audit.ts                   # Viewing key issuance + report generation
│
├── @warden/custody                # Ika dWallet bindings
│   ├── dwallet.ts                 # dWallet creation, binding, signing requests
│   └── cross-chain.ts             # UTXO/EVM transaction construction
│
├── @warden/fhe                    # Encrypt REFHE bindings
│   ├── state.ts                   # Encrypt/decrypt position state
│   ├── prover.ts                  # REFHE proof generation (WASM)
│   └── proposal.ts                # ProposalAccount submission + monitoring
│
├── @warden/settlement             # Umbra SDK bindings
│   ├── vault.ts                   # SettlementVault management
│   ├── transfer.ts                # Confidential transfer execution
│   └── viewing-key.ts             # VK issuance, revocation, report generation
│
└── @warden/brain                  # QVAC intelligence plane
    ├── inference.ts               # @qvac/llm-llamacpp wrapper
    ├── rag.ts                     # @qvac/embed-llamacpp RAG index management
    ├── voice.ts                   # @qvac/transcription-whispercpp integration
    └── context-builder.ts         # Assembles LLM context from all data sources
```

### 8.2 Execution Loop

```
                     ┌─────────────────────────────────────────┐
                     │         EXECUTION LOOP (per cycle)      │
                     └────────────────────┬────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  1. FETCH CONTEXT                                     │
              │     - Decrypt EncryptedStateAccount locally           │
              │     - Read market feeds (Jupiter, on-chain oracles)   │
              │     - RAG retrieval from local index                  │
              └───────────────────────────┬──────────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  2. GENERATE INTENT (QVAC LLM — local)               │
              │     - LLM produces structured ActionIntent            │
              │     - No data leaves the device                       │
              └───────────────────────────┬──────────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  3. PROVE COMPLIANCE (REFHE prover — local)          │
              │     - Encrypt intent under FHE public key            │
              │     - Generate REFHE proof of guardrail satisfaction  │
              │     - Compute result_commitment                       │
              └───────────────────────────┬──────────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  4. SUBMIT PROPOSAL (Solana)                         │
              │     - Create ProposalAccount on-chain                │
              │     - warden-fhe-state verifies REFHE proof          │
              │     - Status: VerifiedCompliant | VerifiedNonCompliant│
              └───────────────────────────┬──────────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  5. EXECUTE (Ika dWallet co-signs)                   │
              │     - Ika Network verifies on-chain proposal status   │
              │     - Co-signature produced                           │
              │     - Transaction broadcast to target chain           │
              └───────────────────────────┬──────────────────────────┘
                                          │
              ┌───────────────────────────▼──────────────────────────┐
              │  6. SETTLE (Umbra confidential transfer)             │
              │     - Settlement proceeds shielded into vault        │
              │     - EncryptedStateAccount updated                  │
              │     - Local RAG index updated                        │
              └───────────────────────────┬──────────────────────────┘
                                          │
                           (wait cooldown_seconds, repeat)
```

### 8.3 Error Handling and Fallback

| Failure Mode | Handling |
|---|---|
| REFHE proof generation failure | Action aborted; error logged locally; state unchanged |
| ProposalAccount returns `VerifiedNonCompliant` | Action aborted; LLM re-prompted with constraint feedback |
| Ika co-signature timeout | Retry up to 3 times with exponential backoff; then pause agent |
| Umbra settlement failure | Proposal marked failed; assets remain in intermediate account; retry on next cycle |
| LLM produces malformed intent | Schema validation rejects it before proof generation; re-prompt |
| Principal device offline | Agent execution suspended; no action taken; resumes on reconnect |

---

## 9. Data Flow Summary

```
PRINCIPAL DEVICE                    SOLANA                     EXTERNAL
─────────────────                   ──────                     ────────

1. Voice / typed strategy input
   │
   ├─[QVAC STT]──────► Parsed command
   │
   ├─[QVAC LLM]──────► ActionIntent struct
   │
   ├─[REFHE prover]──► ProposalAccount ────────────────────────────────►│
   │                                   verify_proposal                  │
   │                                   ← VerifiedCompliant              │
   │                                                                    │
   ├─[Ika Client]────────────────────────────────────────── Ika Network │
   │                   Check proposal status ◄──────────────────────── │
   │                   Co-sign ──────────────────────────────────────── │
   │                                                  Bitcoin/ETH tx ──►│
   │                                                                    │
   ├─[Umbra Client]──► execute_settlement                               │
   │                   Confidential transfer committed                  │
   │                                                                    │
   ├─ Update EncryptedStateAccount (new FHE ciphertext)                 │
   │                                                                    │
   └─ Update local RAG index                                            │
```

---

## 10. Security Model

### 10.1 Trust Boundaries

| Boundary | Trust Level | Enforcement Mechanism |
|---|---|---|
| Principal device → Solana | Untrusted channel | All sensitive data encrypted before transmission; FHE proofs verified on-chain |
| Principal device → Ika Network | Untrusted channel | Ika verifies Solana state independently; 2PC-MPC requires both shares |
| Solana programs → each other | CPI-controlled | Account ownership and discriminator checks on every CPI |
| Agent off-chain process | Untrusted process | Guardrails enforced at signing layer (Ika co-sig); agent cannot exceed policy regardless of process compromise |
| Auditor / grantee | Partial trust | Viewing keys are scoped; grantee sees only what the VKScope allows |

### 10.2 Threat Model

| Threat | Mitigation |
|---|---|
| Compromised agent process (off-chain) | Ika co-sig refused without on-chain VerifiedCompliant proposal; guardrails enforced at cryptographic layer |
| Front-running by on-chain observers | Action intents are REFHE-encrypted; only result_commitment is public; plaintext never appears on-chain |
| Principal key compromise | Ika dWallet requires both key shares; compromised principal key alone cannot produce valid signatures without Ika co-sig |
| Viewing key exfiltration | Scoped by VKScope; compromise of a compliance VK reveals only the authorized subset; principal VK held only on principal device |
| Guardrail widening attack | 24-hour timelock on `update_guardrails`; emergency pause available without timelock |
| Replay attacks | Nonce field on PolicyAccount; each ProposalAccount has an `expires_at`; executed proposals cannot be re-submitted |
| LLM hallucination / adversarial prompts | ActionIntent schema validation before proof generation; REFHE prover rejects intents that violate guardrails regardless of LLM output |

### 10.3 Key Storage

```
Key                     Storage Location              Backup
──────────────────────  ────────────────────────────  ─────────────────────────────
Principal master key    Device secure enclave (TEE)   BIP39 mnemonic (offline)
FHE private key         Derived from master key       Re-derivable from master
REFHE proving key       Local filesystem (public)     Re-downloadable from Encrypt
Agent session key       In-memory only (ephemeral)    Regenerated each session
Viewing keys (held)     Encrypted local store         Backed up with master key
```

---

## 11. Repository Layout

```
warden/
│
├── programs/                          # Solana Anchor programs (Rust)
│   ├── warden-policy/
│   │   ├── src/
│   │   │   ├── lib.rs                 # Program entrypoint
│   │   │   ├── instructions/
│   │   │   │   ├── initialize_policy.rs
│   │   │   │   ├── bind_dwallet.rs
│   │   │   │   ├── update_guardrails.rs
│   │   │   │   ├── pause_agent.rs
│   │   │   │   └── close_agent.rs
│   │   │   ├── state/
│   │   │   │   ├── policy_account.rs
│   │   │   │   ├── agent_account.rs
│   │   │   │   └── guardrail_set.rs
│   │   │   └── errors.rs
│   │   └── Cargo.toml
│   │
│   ├── warden-fhe-state/
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── instructions/
│   │   │   │   ├── verify_proposal.rs
│   │   │   │   └── execute_proposal.rs
│   │   │   └── state/
│   │   │       ├── encrypted_state.rs
│   │   │       └── proposal_account.rs
│   │   └── Cargo.toml
│   │
│   └── warden-settlement/
│       ├── src/
│       │   ├── lib.rs
│       │   ├── instructions/
│       │   │   ├── initialize_vault.rs
│       │   │   ├── shield_inflow.rs
│       │   │   ├── execute_settlement.rs
│       │   │   ├── unshield_to_principal.rs
│       │   │   ├── grant_viewing_key.rs
│       │   │   └── revoke_viewing_key.rs
│       │   └── state/
│       │       ├── settlement_vault.rs
│       │       └── viewing_key_grant.rs
│       └── Cargo.toml
│
├── packages/                          # TypeScript SDK packages
│   ├── sdk/                           # @warden/sdk — public-facing SDK
│   ├── custody/                       # @warden/custody — Ika dWallet bindings
│   ├── fhe/                           # @warden/fhe — REFHE prover + state management
│   ├── settlement/                    # @warden/settlement — Umbra SDK bindings
│   └── brain/                         # @warden/brain — QVAC intelligence plane
│       ├── inference.ts               # @qvac/llm-llamacpp wrapper
│       ├── rag.ts                     # @qvac/embed-llamacpp RAG index
│       ├── voice.ts                   # @qvac/transcription-whispercpp
│       └── context-builder.ts
│
├── app/                               # Next.js dashboard
│   ├── pages/
│   │   ├── deploy/                    # Agent deployment wizard
│   │   ├── monitor/                   # Live agent status + execution log
│   │   └── audit/                     # Viewing key management + compliance reports
│   └── components/
│
├── tests/                             # Integration tests
│   ├── policy.test.ts
│   ├── fhe-state.test.ts
│   ├── settlement.test.ts
│   └── e2e/
│       └── full-execution-cycle.test.ts
│
├── scripts/
│   ├── deploy.ts                      # Program deployment to devnet
│   └── seed.ts                        # Test agent initialization
│
├── Anchor.toml
├── package.json
└── ARCHITECTURE.md
```

---

## 12. External Protocol Dependencies

| Protocol | Version / Network | Integration Point |
|---|---|---|
| Ika Network | Devnet pre-alpha | dWallet creation, co-signing service, signing condition registration |
| Encrypt (REFHE) | Devnet pre-alpha | On-chain proof verification in `warden-fhe-state`; off-chain WASM prover |
| Umbra SDK | Latest | `warden-settlement` program; confidential transfer primitives; viewing key scheme |
| QVAC SDK | `@qvac/llm-llamacpp`, `@qvac/embed-llamacpp`, `@qvac/transcription-whispercpp` | Local inference in `@warden/brain` |
| Solana / Anchor | `solana-program 1.18`, `anchor 0.30` | All on-chain programs |
| Jupiter Aggregator | V6 API | Price feeds and swap routing for action execution |
