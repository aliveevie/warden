use anchor_lang::prelude::*;
use crate::state::SettlementVault;

#[derive(Accounts)]
pub struct ShieldInflow<'info> {
    #[account(mut)]
    pub vault: Account<'info, SettlementVault>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Wraps a plaintext token receipt into an Umbra confidential balance.
///
/// TODO(PR-3): Replace stub with Umbra SDK CPI call:
///   umbra::cpi::shield(cpi_ctx, amount)?;
pub fn handler(ctx: Context<ShieldInflow>, amount: u64) -> Result<()> {
    ctx.accounts.vault.total_shielded_in += amount as u128;

    emit!(InflowShielded {
        vault:  ctx.accounts.vault.key(),
        // Amount is intentionally NOT emitted to preserve confidentiality.
        // The shielded record is recorded by the Umbra protocol, not here.
    });

    Ok(())
}

#[event]
pub struct InflowShielded {
    pub vault: Pubkey,
}
