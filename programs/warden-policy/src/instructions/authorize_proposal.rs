use anchor_lang::prelude::*;
use crate::{errors::WardenPolicyError, state::PolicyAccount};

#[derive(Accounts)]
pub struct AuthorizeProposal<'info> {
    #[account(
        mut,
        constraint = !policy.paused @ WardenPolicyError::AgentPaused,
    )]
    pub policy: Account<'info, PolicyAccount>,

    /// CHECK: Caller must be the warden-fhe-state program (enforced via CPI).
    pub fhe_state_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<AuthorizeProposal>, proposal_id: [u8; 32]) -> Result<()> {
    let clock  = Clock::get()?;
    let policy = &mut ctx.accounts.policy;

    let cooldown_elapsed =
        clock.unix_timestamp - policy.last_execution
            >= policy.guardrail_set.cooldown_seconds as i64;

    require!(cooldown_elapsed, WardenPolicyError::CooldownNotElapsed);

    policy.nonce          += 1;
    policy.last_execution  = clock.unix_timestamp;

    emit!(ProposalAuthorized {
        agent_id:    policy.agent_id,
        proposal_id,
        nonce:       policy.nonce,
        authorized_at: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ProposalAuthorized {
    pub agent_id:       [u8; 32],
    pub proposal_id:    [u8; 32],
    pub nonce:          u64,
    pub authorized_at:  i64,
}
