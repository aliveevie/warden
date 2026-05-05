use anchor_lang::prelude::*;

pub const MAX_VK_LEN: usize = 256;
pub const MAX_POSITION_IDS: usize = 64;

/// Scope of the data a viewing key grantee may decrypt.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum VkScope {
    /// Full access to all settlement history.
    Full,
    /// Access restricted to a specific date range.
    DateRange { from: i64, to: i64 },
    /// Access restricted to a specific set of positions.
    PositionSet { position_ids: Vec<[u8; 16]> },
}

#[account]
#[derive(Debug)]
pub struct ViewingKeyGrant {
    /// The SettlementVault this grant applies to.
    pub vault: Pubkey,

    /// The grantee (auditor or compliance officer).
    pub grantee: Pubkey,

    /// The viewing key encrypted to the grantee's Ed25519 public key.
    pub encrypted_vk: Vec<u8>,

    /// Scope of data the grantee may access.
    pub scope: VkScope,

    pub granted_at: i64,

    pub revoked: bool,

    pub bump: u8,
}

impl ViewingKeyGrant {
    pub const SEED_PREFIX: &'static [u8] = b"vk_grant";

    pub const LEN: usize =
        8                              // discriminator
        + 32                           // vault
        + 32                           // grantee
        + 4 + MAX_VK_LEN               // encrypted_vk
        + 1 + 8 + 8 + 4 + (16 * MAX_POSITION_IDS) // scope (worst-case PositionSet)
        + 8                            // granted_at
        + 1                            // revoked
        + 1;                           // bump
}
