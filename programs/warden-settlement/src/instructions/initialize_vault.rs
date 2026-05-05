use anchor_lang::prelude::*;
use crate::state::SettlementVault;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeVaultArgs {
    pub umbra_shield_addr:   Pubkey,
    pub principal_vk_hash:   [u8; 32],
    pub compliance_vk_hash:  [u8; 32],
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = SettlementVault::LEN,
        seeds = [SettlementVault::SEED_PREFIX, agent.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, SettlementVault>,

    /// CHECK: Validated by warden-policy program; caller is responsible for
    /// passing the correct AgentAccount pubkey.
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVault>, args: InitializeVaultArgs) -> Result<()> {
    let vault                  = &mut ctx.accounts.vault;
    vault.agent                = ctx.accounts.agent.key();
    vault.authority            = ctx.accounts.authority.key();
    vault.umbra_shield_addr    = args.umbra_shield_addr;
    vault.principal_vk_hash    = args.principal_vk_hash;
    vault.compliance_vk_hash   = args.compliance_vk_hash;
    vault.total_shielded_in    = 0;
    vault.total_shielded_out   = 0;
    vault.bump                 = ctx.bumps.vault;

    emit!(VaultInitialized {
        agent:             ctx.accounts.agent.key(),
        umbra_shield_addr: args.umbra_shield_addr,
    });

    Ok(())
}

#[event]
pub struct VaultInitialized {
    pub agent:             Pubkey,
    pub umbra_shield_addr: Pubkey,
}
