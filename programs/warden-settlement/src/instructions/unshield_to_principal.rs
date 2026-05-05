use anchor_lang::prelude::*;
use crate::{errors::WardenSettlementError, state::SettlementVault};

#[derive(Accounts)]
pub struct UnshieldToPrincipal<'info> {
    #[account(
        mut,
        has_one = authority @ WardenSettlementError::Unauthorized,
    )]
    pub vault: Account<'info, SettlementVault>,

    pub authority: Signer<'info>,
}

/// Withdraws from shielded balance to the principal's address.
///
/// TODO(PR-3): Replace stub with Umbra SDK unshield CPI.
pub fn handler(ctx: Context<UnshieldToPrincipal>, _amount: u64) -> Result<()> {
    emit!(PrincipalUnshielded {
        vault: ctx.accounts.vault.key(),
    });

    Ok(())
}

#[event]
pub struct PrincipalUnshielded {
    pub vault: Pubkey,
}
