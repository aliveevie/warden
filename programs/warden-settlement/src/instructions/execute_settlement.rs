use anchor_lang::prelude::*;
use crate::{errors::WardenSettlementError, state::SettlementVault};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExecuteSettlementArgs {
    /// Umbra-encrypted recipient note commitment.
    pub recipient_commitment: [u8; 32],
    /// Umbra-encrypted amount ciphertext.
    pub encrypted_amount: Vec<u8>,
    /// Nullifier to prevent replay of this settlement.
    pub nullifier: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecuteSettlement<'info> {
    #[account(
        mut,
        has_one = authority @ WardenSettlementError::Unauthorized,
    )]
    pub vault: Account<'info, SettlementVault>,

    pub authority: Signer<'info>,
}

/// Performs a confidential transfer via Umbra.
///
/// TODO(PR-3): Replace stub with Umbra SDK CPI:
///   umbra::cpi::transfer(cpi_ctx, args.recipient_commitment, args.encrypted_amount)?;
pub fn handler(ctx: Context<ExecuteSettlement>, args: ExecuteSettlementArgs) -> Result<()> {
    ctx.accounts.vault.total_shielded_out += 1; // placeholder until Umbra CPI available

    // No amounts or recipients are emitted on-chain.
    emit!(SettlementExecuted {
        vault:     ctx.accounts.vault.key(),
        nullifier: args.nullifier,
    });

    Ok(())
}

#[event]
pub struct SettlementExecuted {
    pub vault:     Pubkey,
    /// Public nullifier prevents replay; contains no value or identity information.
    pub nullifier: [u8; 32],
}
