use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct SettlementVault {
    /// The AgentAccount this vault serves.
    pub agent: Pubkey,

    /// Authority that controls vault operations (principal's key).
    pub authority: Pubkey,

    /// The agent's Umbra protocol shielded address.
    pub umbra_shield_addr: Pubkey,

    /// Keccak256 hash of the principal's full viewing key.
    pub principal_vk_hash: [u8; 32],

    /// Keccak256 hash of the compliance officer's scoped viewing key.
    pub compliance_vk_hash: [u8; 32],

    /// Cumulative shielded inflows in lamports (scaled by token decimals).
    pub total_shielded_in: u128,

    /// Cumulative shielded outflows in lamports.
    pub total_shielded_out: u128,

    pub bump: u8,
}

impl SettlementVault {
    pub const SEED_PREFIX: &'static [u8] = b"settlement_vault";

    pub const LEN: usize =
        8    // discriminator
        + 32 // agent
        + 32 // authority
        + 32 // umbra_shield_addr
        + 32 // principal_vk_hash
        + 32 // compliance_vk_hash
        + 16 // total_shielded_in
        + 16 // total_shielded_out
        + 1; // bump
}
