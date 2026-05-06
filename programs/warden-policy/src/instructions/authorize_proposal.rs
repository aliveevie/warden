use anchor_lang::prelude::*;
use ika_dwallet_anchor::{
    cpi::accounts::ApproveMessage,
    program::IkaDwallet,
    SignatureScheme,
};
use crate::{errors::WardenPolicyError, state::{AgentAccount, PolicyAccount}};

/// Signature scheme used for dWallet signing.
/// Secp256k1 covers Bitcoin and Ethereum transaction signing.
const DWALLET_SIG_SCHEME: SignatureScheme = SignatureScheme::Secp256k1;

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32], result_commitment: [u8; 32])]
pub struct AuthorizeProposal<'info> {
    #[account(
        mut,
        constraint = !policy.paused @ WardenPolicyError::AgentPaused,
        seeds = [PolicyAccount::SEED_PREFIX, policy.agent_id.as_ref()],
        bump  = policy.bump,
    )]
    pub policy: Account<'info, PolicyAccount>,

    #[account(
        mut,
        seeds = [AgentAccount::SEED_PREFIX, policy.agent_id.as_ref()],
        bump  = agent.bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    // ─── Ika dWallet accounts ─────────────────────────────────────────────
    /// The MessageApproval account created by Ika to record the approval.
    /// CHECK: Created and owned by the Ika program; validated by CPI.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,

    /// The dWallet account whose ID is stored in policy.ika_dwallet_id.
    /// CHECK: Validated by Ika program during CPI; we check the ID matches.
    #[account(
        constraint = dwallet.key().to_bytes() == policy.ika_dwallet_id
            @ WardenPolicyError::DwalletNotBound,
    )]
    pub dwallet: UncheckedAccount<'info>,

    /// The CPI authority PDA that owns the dWallet on behalf of this program.
    /// Derived from the policy PDA so only this program can sign.
    /// CHECK: PDA — seeds verified below.
    #[account(
        seeds = [b"dwallet_authority", policy.key().as_ref()],
        bump,
    )]
    pub dwallet_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub ika_program:    Program<'info, IkaDwallet>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AuthorizeProposal>,
    proposal_id: [u8; 32],
    result_commitment: [u8; 32],
) -> Result<()> {
    let clock  = Clock::get()?;
    let policy = &mut ctx.accounts.policy;
    let agent  = &mut ctx.accounts.agent;

    // ─── Guardrail: cooldown period ───────────────────────────────────────
    let elapsed = clock.unix_timestamp - policy.last_execution;
    require!(
        elapsed >= policy.guardrail_set.cooldown_seconds as i64,
        WardenPolicyError::CooldownNotElapsed
    );

    // ─── Ika CPI: approve_message ─────────────────────────────────────────
    // The result_commitment (Pedersen commitment to the plaintext action) is
    // the message we ask the Ika validator network to co-sign. The co-sig
    // proves that this exact action was policy-verified on Solana.
    let authority_bump = ctx.bumps.dwallet_authority;
    let policy_key     = policy.key();
    let authority_seeds = &[
        b"dwallet_authority",
        policy_key.as_ref(),
        &[authority_bump],
    ];

    ika_dwallet_anchor::cpi::approve_message(
        CpiContext::new_with_signer(
            ctx.accounts.ika_program.to_account_info(),
            ApproveMessage {
                message_approval: ctx.accounts.message_approval.to_account_info(),
                dwallet:          ctx.accounts.dwallet.to_account_info(),
                authority:        ctx.accounts.dwallet_authority.to_account_info(),
                payer:            ctx.accounts.payer.to_account_info(),
                system_program:   ctx.accounts.system_program.to_account_info(),
            },
            &[authority_seeds],
        ),
        result_commitment.to_vec(),
        DWALLET_SIG_SCHEME,
    )?;

    // ─── Update policy state ──────────────────────────────────────────────
    policy.nonce          += 1;
    policy.last_execution  = clock.unix_timestamp;
    agent.proposal_count  += 1;

    emit!(ProposalAuthorized {
        agent_id:         policy.agent_id,
        proposal_id,
        result_commitment,
        nonce:            policy.nonce,
        authorized_at:    clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ProposalAuthorized {
    pub agent_id:         [u8; 32],
    pub proposal_id:      [u8; 32],
    pub result_commitment: [u8; 32],
    pub nonce:            u64,
    pub authorized_at:    i64,
}
