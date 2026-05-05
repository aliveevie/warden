use anchor_lang::prelude::*;
use crate::{
    errors::WardenFheError,
    state::{ProposalAccount, ProposalStatus},
};

#[derive(Accounts)]
pub struct VerifyProposal<'info> {
    #[account(
        mut,
        constraint = proposal.status == ProposalStatus::Pending
            @ WardenFheError::ProposalNotPending,
        constraint = Clock::get().unwrap().unix_timestamp < proposal.expires_at
            @ WardenFheError::ProposalExpired,
    )]
    pub proposal: Account<'info, ProposalAccount>,
}

/// Verifies the REFHE compliance proof and marks the proposal accordingly.
///
/// TODO(PR-1): Replace this stub with a live CPI to the Encrypt network's
/// on-chain verifier program. The stub sets VerifiedCompliant unconditionally
/// to allow the rest of the execution pipeline to be tested end-to-end.
pub fn handler(ctx: Context<VerifyProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    // --- STUB: always compliant -------------------------------------------
    // PR-1 will replace this block with:
    //   encrypt_verifier::cpi::verify_proof(cpi_ctx, proposal.fhe_proof, ...)?;
    //   proposal.status = if result.compliant { VerifiedCompliant } else { VerifiedNonCompliant };
    // -----------------------------------------------------------------------
    proposal.status = ProposalStatus::VerifiedCompliant;

    emit!(ProposalVerified {
        proposal:  proposal.key(),
        compliant: true,
    });

    Ok(())
}

#[event]
pub struct ProposalVerified {
    pub proposal:  Pubkey,
    pub compliant: bool,
}
