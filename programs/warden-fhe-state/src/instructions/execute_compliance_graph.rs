use anchor_lang::prelude::*;
use encrypt_anchor::{
    cpi::accounts::ExecuteGraph,
    program::Encrypt,
    EncryptCpi,
};
use crate::{
    compliance::check_guardrail_compliance,
    errors::WardenFheError,
    state::{EncryptedStateAccount, ProposalAccount, ProposalStatus},
};

#[derive(Accounts)]
pub struct ExecuteComplianceGraph<'info> {
    #[account(
        mut,
        constraint = proposal.status == ProposalStatus::Pending
            @ WardenFheError::ProposalNotPending,
        constraint = Clock::get().unwrap().unix_timestamp < proposal.expires_at
            @ WardenFheError::ProposalExpired,
    )]
    pub proposal: Account<'info, ProposalAccount>,

    pub encrypted_state: Account<'info, EncryptedStateAccount>,

    /// Output ciphertext account created by the Encrypt program to hold the
    /// EBool result of check_guardrail_compliance.
    /// CHECK: Created and managed by the Encrypt program.
    #[account(mut)]
    pub output_ciphertext: UncheckedAccount<'info>,

    /// Payer for the output ciphertext account rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub encrypt_program: Program<'info, Encrypt>,
    pub system_program:  Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteComplianceGraph>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.compliance_inputs.is_some(),
        WardenFheError::MissingComplianceInputs
    );

    let inputs = proposal.compliance_inputs.as_ref().unwrap();

    // Build the Encrypt computation graph from the #[encrypt_fn] DSL function.
    // The macro expands check_guardrail_compliance into a DAG of FHE ops.
    // execute_graph submits that DAG to the Encrypt program, which creates
    // the output_ciphertext account and emits an event for the off-chain executor.
    let graph = check_guardrail_compliance::graph(
        inputs.trade_size_bps_handle,
        inputs.daily_loss_bps_handle,
        inputs.open_positions_handle,
        inputs.max_trade_bps_handle,
        inputs.loss_limit_bps_handle,
        inputs.max_open_pos_handle,
    );

    encrypt_anchor::cpi::execute_graph(
        CpiContext::new(
            ctx.accounts.encrypt_program.to_account_info(),
            ExecuteGraph {
                output_ciphertext: ctx.accounts.output_ciphertext.to_account_info(),
                payer:             ctx.accounts.payer.to_account_info(),
                system_program:    ctx.accounts.system_program.to_account_info(),
            },
        ),
        graph,
    )?;

    // Record the output ciphertext account so finalise_proposal can read it.
    proposal.output_ciphertext = ctx.accounts.output_ciphertext.key();
    proposal.status            = ProposalStatus::GraphExecuted;

    emit!(ComplianceGraphExecuted {
        proposal:          proposal.key(),
        output_ciphertext: ctx.accounts.output_ciphertext.key(),
    });

    Ok(())
}

#[event]
pub struct ComplianceGraphExecuted {
    pub proposal:          Pubkey,
    pub output_ciphertext: Pubkey,
}
