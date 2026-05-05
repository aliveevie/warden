use anchor_lang::prelude::*;
use crate::{
    errors::WardenPolicyError,
    state::{GuardrailSet, PendingGuardrailUpdate, PolicyAccount},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateGuardrailsArgs {
    pub new_guardrail_set: GuardrailSet,
}

#[derive(Accounts)]
pub struct UpdateGuardrails<'info> {
    #[account(
        has_one = authority @ WardenPolicyError::Unauthorized,
    )]
    pub policy: Account<'info, PolicyAccount>,

    #[account(
        init_if_needed,
        payer  = authority,
        space  = 8 + 32 + 512 + 8 + 1,
        seeds  = [PendingGuardrailUpdate::SEED_PREFIX, policy.key().as_ref()],
        bump,
    )]
    pub pending_update: Account<'info, PendingGuardrailUpdate>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UpdateGuardrails>, args: UpdateGuardrailsArgs) -> Result<()> {
    let clock       = Clock::get()?;
    let apply_after = clock.unix_timestamp + PendingGuardrailUpdate::TIMELOCK_SECONDS;

    let pending          = &mut ctx.accounts.pending_update;
    pending.policy       = ctx.accounts.policy.key();
    pending.pending_guardrail_set = args.new_guardrail_set.try_to_vec()?;
    pending.apply_after  = apply_after;
    pending.bump         = ctx.bumps.pending_update;

    emit!(GuardrailUpdateQueued {
        policy:      ctx.accounts.policy.key(),
        apply_after,
        queued_by:   ctx.accounts.authority.key(),
    });

    Ok(())
}

/// Permissionless crank — anyone may call this after the timelock elapses.
#[derive(Accounts)]
pub struct ApplyGuardrailUpdate<'info> {
    #[account(mut)]
    pub policy: Account<'info, PolicyAccount>,

    #[account(
        mut,
        close  = authority,
        seeds  = [PendingGuardrailUpdate::SEED_PREFIX, policy.key().as_ref()],
        bump   = pending_update.bump,
    )]
    pub pending_update: Account<'info, PendingGuardrailUpdate>,

    /// Receives the rent lamports from the closed PendingGuardrailUpdate account.
    #[account(mut)]
    pub authority: SystemAccount<'info>,
}

pub fn apply_handler(ctx: Context<ApplyGuardrailUpdate>) -> Result<()> {
    let clock   = Clock::get()?;
    let pending = &ctx.accounts.pending_update;

    require!(
        clock.unix_timestamp >= pending.apply_after,
        WardenPolicyError::TimelockNotElapsed
    );

    let new_set = GuardrailSet::try_from_slice(&pending.pending_guardrail_set)
        .map_err(|_| error!(WardenPolicyError::Unauthorized))?;

    ctx.accounts.policy.guardrail_set = new_set;

    emit!(GuardrailUpdateApplied {
        policy:     ctx.accounts.policy.key(),
        applied_at: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct GuardrailUpdateQueued {
    pub policy:      Pubkey,
    pub apply_after: i64,
    pub queued_by:   Pubkey,
}

#[event]
pub struct GuardrailUpdateApplied {
    pub policy:     Pubkey,
    pub applied_at: i64,
}
