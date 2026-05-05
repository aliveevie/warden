use anchor_lang::prelude::*;
use crate::{
    errors::WardenSettlementError,
    state::{SettlementVault, ViewingKeyGrant, VkScope, MAX_VK_LEN},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GrantViewingKeyArgs {
    pub grantee:      Pubkey,
    pub encrypted_vk: Vec<u8>,
    pub scope:        VkScope,
}

#[derive(Accounts)]
#[instruction(args: GrantViewingKeyArgs)]
pub struct GrantViewingKey<'info> {
    #[account(
        has_one = authority @ WardenSettlementError::Unauthorized,
    )]
    pub vault: Account<'info, SettlementVault>,

    #[account(
        init,
        payer  = authority,
        space  = ViewingKeyGrant::LEN,
        seeds  = [ViewingKeyGrant::SEED_PREFIX, vault.key().as_ref(), args.grantee.as_ref()],
        bump,
    )]
    pub grant: Account<'info, ViewingKeyGrant>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<GrantViewingKey>, args: GrantViewingKeyArgs) -> Result<()> {
    require!(
        args.encrypted_vk.len() <= MAX_VK_LEN,
        WardenSettlementError::Unauthorized
    );

    let grant           = &mut ctx.accounts.grant;
    grant.vault         = ctx.accounts.vault.key();
    grant.grantee       = args.grantee;
    grant.encrypted_vk  = args.encrypted_vk;
    grant.scope         = args.scope;
    grant.granted_at    = Clock::get()?.unix_timestamp;
    grant.revoked       = false;
    grant.bump          = ctx.bumps.grant;

    emit!(ViewingKeyGranted {
        vault:   ctx.accounts.vault.key(),
        grantee: args.grantee,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct RevokeViewingKey<'info> {
    #[account(
        has_one = authority @ WardenSettlementError::Unauthorized,
    )]
    pub vault: Account<'info, SettlementVault>,

    #[account(
        mut,
        constraint = !grant.revoked @ WardenSettlementError::ViewingKeyRevoked,
    )]
    pub grant: Account<'info, ViewingKeyGrant>,

    pub authority: Signer<'info>,
}

pub fn revoke_handler(ctx: Context<RevokeViewingKey>) -> Result<()> {
    ctx.accounts.grant.revoked = true;

    emit!(ViewingKeyRevoked {
        vault:   ctx.accounts.vault.key(),
        grantee: ctx.accounts.grant.grantee,
    });

    Ok(())
}

#[event]
pub struct ViewingKeyGranted {
    pub vault:   Pubkey,
    pub grantee: Pubkey,
}

#[event]
pub struct ViewingKeyRevoked {
    pub vault:   Pubkey,
    pub grantee: Pubkey,
}
