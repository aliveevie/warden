use anchor_lang::prelude::*;
use crate::{
    errors::WardenFheError,
    state::{EncryptedStateAccount, ProposalAccount, ProposalStatus},
};

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(
        mut,
        constraint = proposal.status == ProposalStatus::VerifiedCompliant
            @ WardenFheError::ProposalNotCompliant,
        constraint = Clock::get().unwrap().unix_timestamp < proposal.expires_at
            @ WardenFheError::ProposalExpired,
    )]
    pub proposal: Account<'info, ProposalAccount>,

    #[account(
        mut,
        constraint = encrypted_state.agent == proposal.agent
            @ WardenFheError::Unauthorized,
        constraint = encrypted_state.state_version == proposal.state_version_at_creation
            @ WardenFheError::StateVersionMismatch,
    )]
    pub encrypted_state: Account<'info, EncryptedStateAccount>,
}

pub fn handler(ctx: Context<ExecuteProposal>) -> Result<()> {
    let clock    = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;
    let state    = &mut ctx.accounts.encrypted_state;

    proposal.status = ProposalStatus::Executed;

    // State version is bumped so stale proposals cannot be replayed.
    state.state_version      += 1;
    state.last_computation    = clock.unix_timestamp;
    state.computation_count  += 1;

    // The updated encrypted state blob is written by the off-chain orchestrator
    // in the same transaction via a separate instruction. On-chain we record
    // only the version bump and metadata.

    emit!(ProposalExecuted {
        proposal:      proposal.key(),
        agent:         proposal.agent,
        result_commitment: proposal.result_commitment,
        state_version: state.state_version,
        executed_at:   clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ProposalExecuted {
    pub proposal:          Pubkey,
    pub agent:             Pubkey,
    pub result_commitment: [u8; 32],
    pub state_version:     u64,
    pub executed_at:       i64,
}
