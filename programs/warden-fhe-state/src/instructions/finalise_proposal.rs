use anchor_lang::prelude::*;
use encrypt_anchor::{
    cpi::accounts::ReadCiphertext,
    program::Encrypt,
    types::EBool,
};
use crate::{
    errors::WardenFheError,
    state::{EncryptedStateAccount, ProposalAccount, ProposalStatus},
};

/// Reads the Encrypt executor's committed EBool result and marks the proposal
/// as compliant or non-compliant. If compliant, CPIs to warden-policy to
/// authorise the Ika dWallet co-signature.
#[derive(Accounts)]
pub struct FinaliseProposal<'info> {
    #[account(
        mut,
        constraint = proposal.status == ProposalStatus::GraphExecuted
            @ WardenFheError::ProposalNotGraphExecuted,
        constraint = Clock::get().unwrap().unix_timestamp < proposal.expires_at
            @ WardenFheError::ProposalExpired,
    )]
    pub proposal: Account<'info, ProposalAccount>,

    #[account(
        mut,
        constraint = encrypted_state.agent == proposal.agent
            @ WardenFheError::Unauthorized,
    )]
    pub encrypted_state: Account<'info, EncryptedStateAccount>,

    /// The output ciphertext account written by execute_compliance_graph.
    /// CHECK: Verified by address match against proposal.output_ciphertext.
    #[account(
        constraint = output_ciphertext.key() == proposal.output_ciphertext
            @ WardenFheError::OutputCiphertextMismatch,
    )]
    pub output_ciphertext: UncheckedAccount<'info>,

    /// warden-policy program for the CPI to authorize_proposal.
    /// CHECK: Program account.
    pub warden_policy_program: UncheckedAccount<'info>,

    /// PolicyAccount in warden-policy — mutated by authorize_proposal CPI.
    /// CHECK: Validated inside the CPI.
    #[account(mut)]
    pub policy: UncheckedAccount<'info>,

    /// AgentAccount in warden-policy — mutated by authorize_proposal CPI.
    /// CHECK: Validated inside the CPI.
    #[account(mut)]
    pub agent_account: UncheckedAccount<'info>,

    /// MessageApproval account for the Ika CPI (forwarded through policy).
    /// CHECK: Created by the Ika program inside authorize_proposal CPI chain.
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,

    /// The dWallet account (forwarded through policy).
    /// CHECK: Validated by warden-policy.
    pub dwallet: UncheckedAccount<'info>,

    /// The dWallet CPI authority PDA (forwarded through policy).
    /// CHECK: PDA validated by warden-policy.
    pub dwallet_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub encrypt_program: Program<'info, Encrypt>,
    pub system_program:  Program<'info, System>,
}

pub fn handler(ctx: Context<FinaliseProposal>) -> Result<()> {
    let clock    = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;

    // ─── Read the committed EBool from the Encrypt output ciphertext ──────
    // The Encrypt executor has already evaluated the DAG off-chain and
    // committed the result to the output_ciphertext account. We read it here.
    let compliant: EBool = encrypt_anchor::cpi::read_ciphertext(
        CpiContext::new(
            ctx.accounts.encrypt_program.to_account_info(),
            ReadCiphertext {
                ciphertext: ctx.accounts.output_ciphertext.to_account_info(),
            },
        ),
    )?;

    // In the pre-alpha, EBool.value() returns the plaintext bool.
    // In production with real FHE, this would be a commitment revealed by the
    // decryptor service; on-chain we verify the commitment matches the EBool.
    let is_compliant = compliant.value();

    if is_compliant {
        proposal.status = ProposalStatus::VerifiedCompliant;

        // ─── CPI to warden-policy: authorize_proposal ─────────────────────
        // This triggers the Ika approve_message CPI inside warden-policy,
        // authorising the dWallet co-signature for this result_commitment.
        let authorize_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.warden_policy_program.key(),
            accounts: vec![
                AccountMeta::new(ctx.accounts.policy.key(), false),
                AccountMeta::new(ctx.accounts.agent_account.key(), false),
                AccountMeta::new(ctx.accounts.message_approval.key(), false),
                AccountMeta::new_readonly(ctx.accounts.dwallet.key(), false),
                AccountMeta::new_readonly(ctx.accounts.dwallet_authority.key(), false),
                AccountMeta::new(ctx.accounts.payer.key(), true),
                // IkaDwallet and System programs forwarded by warden-policy
            ],
            data: warden_policy_authorize_data(
                proposal.key().to_bytes(),
                proposal.result_commitment,
            ),
        };

        anchor_lang::solana_program::program::invoke(
            &authorize_ix,
            &[
                ctx.accounts.policy.to_account_info(),
                ctx.accounts.agent_account.to_account_info(),
                ctx.accounts.message_approval.to_account_info(),
                ctx.accounts.dwallet.to_account_info(),
                ctx.accounts.dwallet_authority.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.warden_policy_program.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Bump state version to invalidate stale proposals.
        ctx.accounts.encrypted_state.state_version    += 1;
        ctx.accounts.encrypted_state.last_computation  = clock.unix_timestamp;
        ctx.accounts.encrypted_state.computation_count += 1;

    } else {
        proposal.status = ProposalStatus::VerifiedNonCompliant;
    }

    emit!(ProposalFinalised {
        proposal:   proposal.key(),
        compliant:  is_compliant,
        finalised_at: clock.unix_timestamp,
    });

    Ok(())
}

/// Serialises the `authorize_proposal` instruction data for the CPI.
fn warden_policy_authorize_data(
    proposal_id:       [u8; 32],
    result_commitment: [u8; 32],
) -> Vec<u8> {
    // Anchor discriminator for authorize_proposal (first 8 bytes of sha256 of
    // "global:authorize_proposal") followed by serialised arguments.
    let mut data = anchor_lang::solana_program::hash::hash(
        b"global:authorize_proposal",
    ).to_bytes()[..8].to_vec();
    data.extend_from_slice(&proposal_id);
    data.extend_from_slice(&result_commitment);
    data
}

#[event]
pub struct ProposalFinalised {
    pub proposal:     Pubkey,
    pub compliant:    bool,
    pub finalised_at: i64,
}
