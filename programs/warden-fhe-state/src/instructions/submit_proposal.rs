use anchor_lang::prelude::*;
use crate::{
    errors::WardenFheError,
    state::{
        ComplianceGraphInputs, EncryptedStateAccount, ProposalAccount, ProposalStatus,
        MAX_ENCRYPTED_INTENT_LEN, MAX_FHE_PROOF_LEN,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubmitProposalArgs {
    pub proposal_id:        [u8; 32],
    pub encrypted_intent:   Vec<u8>,
    pub fhe_proof:          Vec<u8>,
    pub result_commitment:  [u8; 32],
    /// Ciphertext handles for the Encrypt compliance graph.
    /// Must be provided so execute_compliance_graph can run immediately
    /// without a separate update.
    pub compliance_inputs:  ComplianceGraphInputs,
}

#[derive(Accounts)]
#[instruction(args: SubmitProposalArgs)]
pub struct SubmitProposal<'info> {
    #[account(
        init,
        payer = proposer,
        space = ProposalAccount::LEN,
        seeds = [ProposalAccount::SEED_PREFIX, args.proposal_id.as_ref()],
        bump,
    )]
    pub proposal: Account<'info, ProposalAccount>,

    pub encrypted_state: Account<'info, EncryptedStateAccount>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SubmitProposal>, args: SubmitProposalArgs) -> Result<()> {
    require!(
        args.encrypted_intent.len() <= MAX_ENCRYPTED_INTENT_LEN,
        WardenFheError::CiphertextTooLarge
    );
    require!(
        args.fhe_proof.len() <= MAX_FHE_PROOF_LEN,
        WardenFheError::CiphertextTooLarge
    );

    let clock    = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;

    proposal.agent                     = ctx.accounts.encrypted_state.agent;
    proposal.proposer                  = ctx.accounts.proposer.key();
    proposal.encrypted_intent          = args.encrypted_intent;
    proposal.fhe_proof                 = args.fhe_proof;
    proposal.result_commitment         = args.result_commitment;
    proposal.state_version_at_creation = ctx.accounts.encrypted_state.state_version;
    proposal.compliance_inputs         = Some(args.compliance_inputs);
    proposal.output_ciphertext         = Pubkey::default();
    proposal.status                    = ProposalStatus::Pending;
    proposal.created_at                = clock.unix_timestamp;
    proposal.expires_at                = clock.unix_timestamp + ProposalAccount::TTL_SECONDS;
    proposal.bump                      = ctx.bumps.proposal;

    emit!(ProposalSubmitted {
        proposal:   proposal.key(),
        agent:      proposal.agent,
        proposer:   proposal.proposer,
        created_at: clock.unix_timestamp,
        expires_at: proposal.expires_at,
    });

    Ok(())
}

#[event]
pub struct ProposalSubmitted {
    pub proposal:   Pubkey,
    pub agent:      Pubkey,
    pub proposer:   Pubkey,
    pub created_at: i64,
    pub expires_at: i64,
}
