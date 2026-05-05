use anchor_lang::prelude::*;

/// On-chain policy parameters enforced at the signing layer.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct GuardrailSet {
    /// Maximum single trade size as basis points of total AUM.
    pub max_trade_size_bps: u16,

    /// Whitelisted Solana program IDs the agent may interact with.
    pub allowed_protocols: [Pubkey; 16],

    /// Minimum seconds between successive agent executions.
    pub cooldown_seconds: u32,

    /// Maximum number of concurrent open positions.
    pub max_open_positions: u8,

    /// Whitelisted SPL token mints the agent may hold or trade.
    pub allowed_assets: [Pubkey; 32],

    /// Maximum intra-day drawdown expressed in basis points (e.g. 500 = 5%).
    pub daily_loss_limit_bps: u16,
}

impl GuardrailSet {
    /// Byte size for account space calculation.
    pub const LEN: usize =
        2              // max_trade_size_bps
        + (32 * 16)    // allowed_protocols
        + 4            // cooldown_seconds
        + 1            // max_open_positions
        + (32 * 32)    // allowed_assets
        + 2;           // daily_loss_limit_bps
}
