use anchor_lang::prelude::*;
use crate::{errors::WardenPolicyError, state::PolicyAccount};

#[derive(Accounts)]
pub struct CloseAgent<'info> {
    #[account(
        mut,
        has_one  = authority @ WardenPolicyError::Unauthorized,
        close    = authority,
    )]
    pub policy: Account<'info, PolicyAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<CloseAgent>) -> Result<()> {
    emit!(AgentClosed {
        agent_id:  ctx.accounts.policy.agent_id,
        closed_by: ctx.accounts.authority.key(),
        closed_at: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct AgentClosed {
    pub agent_id:  [u8; 32],
    pub closed_by: Pubkey,
    pub closed_at: i64,
}
