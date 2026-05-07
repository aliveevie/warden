use anchor_lang::prelude::*;
use ika_dwallet_anchor::{
    cpi::accounts::TransferAuthority,
    program::IkaDwallet,
};
use crate::{errors::WardenPolicyError, state::PolicyAccount};

#[derive(Accounts)]
pub struct BindDwallet<'info> {
    #[account(
        mut,
        has_one = authority @ WardenPolicyError::Unauthorized,
        seeds   = [PolicyAccount::SEED_PREFIX, policy.agent_id.as_ref()],
        bump    = policy.bump,
    )]
    pub policy: Account<'info, PolicyAccount>,

    /// The Ika dWallet account to bind. Must currently be owned by `authority`.
    /// CHECK: Validated by Ika's TransferAuthority CPI.
    #[account(mut)]
    pub dwallet: UncheckedAccount<'info>,

    /// The new authority PDA that this program will use to sign on behalf
    /// of the dWallet. Derived deterministically from the policy PDA.
    /// CHECK: PDA — seeds verified in constraints.
    #[account(
        seeds = [b"dwallet_authority", policy.key().as_ref()],
        bump,
    )]
    pub dwallet_authority: UncheckedAccount<'info>,

    pub authority:      Signer<'info>,
    pub ika_program:    Program<'info, IkaDwallet>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BindDwallet>, dwallet_id: [u8; 32]) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    require!(
        policy.ika_dwallet_id == [0u8; 32],
        WardenPolicyError::DwalletAlreadyBound
    );

    // Transfer dWallet authority from the user keypair to the policy PDA.
    // After this CPI, only this program can call approve_message on this dWallet.
    ika_dwallet_anchor::cpi::transfer_authority(
        CpiContext::new(
            ctx.accounts.ika_program.to_account_info(),
            TransferAuthority {
                dwallet:          ctx.accounts.dwallet.to_account_info(),
                current_authority: ctx.accounts.authority.to_account_info(),
                new_authority:    ctx.accounts.dwallet_authority.to_account_info(),
                system_program:   ctx.accounts.system_program.to_account_info(),
            },
        ),
    )?;

    policy.ika_dwallet_id = dwallet_id;

    emit!(DwalletBound {
        agent_id:   policy.agent_id,
        dwallet_id,
        bound_by:   ctx.accounts.authority.key(),
    });

    Ok(())
}

#[event]
pub struct DwalletBound {
    pub agent_id:   [u8; 32],
    pub dwallet_id: [u8; 32],
    pub bound_by:   Pubkey,
}
