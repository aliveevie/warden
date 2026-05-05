use anchor_lang::prelude::*;
use crate::{errors::WardenPolicyError, state::PolicyAccount};

#[derive(Accounts)]
pub struct PauseAgent<'info> {
    #[account(
        mut,
        has_one = authority @ WardenPolicyError::Unauthorized,
        constraint = !policy.paused @ WardenPolicyError::AgentPaused,
    )]
    pub policy: Account<'info, PolicyAccount>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<PauseAgent>) -> Result<()> {
    ctx.accounts.policy.paused = true;

    emit!(AgentPaused {
        agent_id:  ctx.accounts.policy.agent_id,
        paused_by: ctx.accounts.authority.key(),
        paused_at: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ResumeAgent<'info> {
    #[account(
        mut,
        has_one = authority @ WardenPolicyError::Unauthorized,
        constraint = policy.paused @ WardenPolicyError::AgentNotPaused,
    )]
    pub policy: Account<'info, PolicyAccount>,

    pub authority: Signer<'info>,
}

/// `ika_cosig` is a 64-byte Ed25519 signature from the Ika Network over the
/// serialized (agent_id || authority_pubkey || clock.slot). Verified off-chain
/// by the caller before submission; on-chain verification is added in PR-1.
pub fn resume_handler(ctx: Context<ResumeAgent>, _ika_cosig: [u8; 64]) -> Result<()> {
    // TODO(PR-1): verify ika_cosig against IKA_NETWORK_PUBKEY on-chain.
    ctx.accounts.policy.paused = false;

    emit!(AgentResumed {
        agent_id:   ctx.accounts.policy.agent_id,
        resumed_by: ctx.accounts.authority.key(),
        resumed_at: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct AgentPaused {
    pub agent_id:  [u8; 32],
    pub paused_by: Pubkey,
    pub paused_at: i64,
}

#[event]
pub struct AgentResumed {
    pub agent_id:   [u8; 32],
    pub resumed_by: Pubkey,
    pub resumed_at: i64,
}
