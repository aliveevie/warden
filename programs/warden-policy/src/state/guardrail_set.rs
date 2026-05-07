use anchor_lang::prelude::*;

/// Maximum number of whitelisted protocols an agent can interact with.
/// Sized to keep `GuardrailSet` under the BPF 4 KB stack frame budget when
/// the handler copies args by value. Larger whitelists belong in dedicated
/// accounts referenced by Pubkey, not embedded inline.
pub const MAX_ALLOWED_PROTOCOLS: usize = 4;

/// Maximum number of whitelisted assets.
pub const MAX_ALLOWED_ASSETS: usize = 8;

/// On-chain policy parameters enforced at the signing layer.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct GuardrailSet {
    /// Maximum single trade size as basis points of total AUM.
    pub max_trade_size_bps: u16,

    /// Whitelisted Solana program IDs the agent may interact with.
    pub allowed_protocols: [Pubkey; MAX_ALLOWED_PROTOCOLS],

    /// Minimum seconds between successive agent executions.
    pub cooldown_seconds: u32,

    /// Maximum number of concurrent open positions.
    pub max_open_positions: u8,

    /// Whitelisted SPL token mints the agent may hold or trade.
    pub allowed_assets: [Pubkey; MAX_ALLOWED_ASSETS],

    /// Maximum intra-day drawdown expressed in basis points (e.g. 500 = 5%).
    pub daily_loss_limit_bps: u16,
}

impl GuardrailSet {
    /// Byte size for account space calculation.
    pub const LEN: usize =
        2                                 // max_trade_size_bps
        + (32 * MAX_ALLOWED_PROTOCOLS)    // allowed_protocols
        + 4                               // cooldown_seconds
        + 1                               // max_open_positions
        + (32 * MAX_ALLOWED_ASSETS)       // allowed_assets
        + 2;                              // daily_loss_limit_bps
}
