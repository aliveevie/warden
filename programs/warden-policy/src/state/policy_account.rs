use anchor_lang::prelude::*;
use crate::state::GuardrailSet;

#[account]
#[derive(Debug)]
pub struct PolicyAccount {
    /// The authority that controls this policy (principal's signing key).
    pub authority: Pubkey,

    /// Deterministic 32-byte agent identifier.
    pub agent_id: [u8; 32],

    /// Ika dWallet ID bound to this agent. Zero until bind_dwallet is called.
    pub ika_dwallet_id: [u8; 32],

    /// Active guardrail parameters.
    pub guardrail_set: GuardrailSet,

    /// Replay-protection nonce; incremented on every authorized proposal.
    pub nonce: u64,

    /// Whether the agent is currently halted.
    pub paused: bool,

    /// Unix timestamp of account creation.
    pub created_at: i64,

    /// Unix timestamp of the last successfully executed proposal.
    pub last_execution: i64,

    /// Bump seed for the PDA.
    pub bump: u8,
}

impl PolicyAccount {
    pub const SEED_PREFIX: &'static [u8] = b"policy";

    pub const LEN: usize =
        8                   // discriminator
        + 32                // authority
        + 32                // agent_id
        + 32                // ika_dwallet_id
        + GuardrailSet::LEN // guardrail_set
        + 8                 // nonce
        + 1                 // paused
        + 8                 // created_at
        + 8                 // last_execution
        + 1;                // bump
}
