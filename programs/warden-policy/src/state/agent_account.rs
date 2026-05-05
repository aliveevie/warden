use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct AgentAccount {
    /// The PolicyAccount this agent is governed by.
    pub policy: Pubkey,

    /// Total number of proposals processed (including rejected ones).
    pub proposal_count: u64,

    /// Cumulative settled volume in USD (scaled by 10^6).
    pub total_volume: u128,

    /// The EncryptedStateAccount holding this agent's FHE position blob.
    pub state_account: Pubkey,

    /// The SettlementVault used for all confidential settlements.
    pub settlement_vault: Pubkey,

    /// Bump seed for the PDA.
    pub bump: u8,
}

impl AgentAccount {
    pub const SEED_PREFIX: &'static [u8] = b"agent";

    pub const LEN: usize =
        8    // discriminator
        + 32 // policy
        + 8  // proposal_count
        + 16 // total_volume
        + 32 // state_account
        + 32 // settlement_vault
        + 1; // bump
}

/// Stores a pending guardrail update queued via update_guardrails.
/// Applied by a permissionless crank after TIMELOCK_SECONDS have elapsed.
#[account]
#[derive(Debug)]
pub struct PendingGuardrailUpdate {
    /// The PolicyAccount this update targets.
    pub policy: Pubkey,

    /// Serialized GuardrailSet to apply once the timelock elapses.
    pub pending_guardrail_set: Vec<u8>,

    /// Unix timestamp after which apply_guardrail_update may be called.
    pub apply_after: i64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

impl PendingGuardrailUpdate {
    pub const SEED_PREFIX: &'static [u8] = b"pending_update";
    pub const TIMELOCK_SECONDS: i64 = 86_400; // 24 hours
}
