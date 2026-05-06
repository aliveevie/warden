use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("WRDNpo1icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMi");

/// Ika dWallet program deployed on Solana devnet.
pub mod ika_program {
    anchor_lang::declare_id!("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
}

#[program]
pub mod warden_policy {
    use super::*;

    /// Deploys a new PolicyAccount and AgentAccount for an agent principal.
    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        args: InitializePolicyArgs,
    ) -> Result<()> {
        instructions::initialize_policy::handler(ctx, args)
    }

    /// Binds an Ika dWallet (identified by its 32-byte on-chain ID) to this
    /// agent and transfers CPI authority to the policy PDA so the program can
    /// call `approve_message` on the dWallet's behalf.
    pub fn bind_dwallet(
        ctx: Context<BindDwallet>,
        dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::bind_dwallet::handler(ctx, dwallet_id)
    }

    /// Queues a guardrail update. A permissionless crank may apply it via
    /// `apply_guardrail_update` only after the 24-hour timelock elapses.
    pub fn update_guardrails(
        ctx: Context<UpdateGuardrails>,
        args: UpdateGuardrailsArgs,
    ) -> Result<()> {
        instructions::update_guardrails::handler(ctx, args)
    }

    /// Applies a pending guardrail update after its timelock has elapsed.
    pub fn apply_guardrail_update(
        ctx: Context<ApplyGuardrailUpdate>,
    ) -> Result<()> {
        instructions::update_guardrails::apply_handler(ctx)
    }

    /// Immediately halts all agent execution. No timelock — designed for
    /// emergency use.
    pub fn pause_agent(ctx: Context<PauseAgent>) -> Result<()> {
        instructions::pause_agent::handler(ctx)
    }

    /// Resumes a paused agent. Requires the authority key plus a valid Ika
    /// co-authorization signature over (agent_id || authority || slot).
    pub fn resume_agent(
        ctx: Context<ResumeAgent>,
        ika_cosig: [u8; 64],
    ) -> Result<()> {
        instructions::pause_agent::resume_handler(ctx, ika_cosig)
    }

    /// Called via CPI from `warden-fhe-state` after a proposal passes the
    /// REFHE compliance check. Emits the Ika `approve_message` CPI to
    /// authorize the dWallet co-signature for the proposal's result.
    pub fn authorize_proposal(
        ctx: Context<AuthorizeProposal>,
        proposal_id: [u8; 32],
        result_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::authorize_proposal::handler(ctx, proposal_id, result_commitment)
    }

    /// Initiates agent wind-down and closes the PolicyAccount.
    pub fn close_agent(ctx: Context<CloseAgent>) -> Result<()> {
        instructions::close_agent::handler(ctx)
    }
}
