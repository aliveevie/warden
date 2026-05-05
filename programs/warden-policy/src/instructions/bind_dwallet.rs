use anchor_lang::prelude::*;
use crate::{errors::WardenPolicyError, state::PolicyAccount};

#[derive(Accounts)]
pub struct BindDwallet<'info> {
    #[account(
        mut,
        has_one = authority @ WardenPolicyError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<BindDwallet>, dwallet_id: [u8; 32]) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    require!(
        policy.ika_dwallet_id == [0u8; 32],
        WardenPolicyError::DwalletAlreadyBound
    );

    policy.ika_dwallet_id = dwallet_id;

    emit!(DwalletBound {
        agent_id:    policy.agent_id,
        dwallet_id,
        bound_by:    ctx.accounts.authority.key(),
    });

    Ok(())
}

#[event]
pub struct DwalletBound {
    pub agent_id:   [u8; 32],
    pub dwallet_id: [u8; 32],
    pub bound_by:   Pubkey,
}
