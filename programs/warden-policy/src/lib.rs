use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("WRDNpo1icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMi");

#[program]
pub mod warden_policy {
    use super::*;

    /// Deploys a new policy account and guardrail set for an agent.
    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        args: InitializePolicyArgs,
    ) -> Result<()> {
        instructions::initialize_policy::handler(ctx, args)
    }

    /// Binds an Ika dWallet to this agent's policy account.
    pub fn bind_dwallet(
        ctx: Context<BindDwallet>,
        dwallet_id: [u8; 32],
    ) -> Result<()> {
        instructions::bind_dwallet::handler(ctx, dwallet_id)
    }

    /// Queues a guardrail update subject to a 24-hour timelock.
    pub fn update_guardrails(
        ctx: Context<UpdateGuardrails>,
        args: UpdateGuardrailsArgs,
    ) -> Result<()> {
        instructions::update_guardrails::handler(ctx, args)
    }

    /// Applies a pending guardrail update after the timelock has elapsed.
    pub fn apply_guardrail_update(
        ctx: Context<ApplyGuardrailUpdate>,
    ) -> Result<()> {
        instructions::update_guardrails::apply_handler(ctx)
    }

    /// Immediately halts all agent execution. No timelock.
    pub fn pause_agent(ctx: Context<PauseAgent>) -> Result<()> {
        instructions::pause_agent::handler(ctx)
    }

    /// Resumes a paused agent. Requires dual authorization (authority + Ika co-auth).
    pub fn resume_agent(
        ctx: Context<ResumeAgent>,
        ika_cosig: [u8; 64],
    ) -> Result<()> {
        instructions::pause_agent::resume_handler(ctx, ika_cosig)
    }

    /// Called via CPI from warden-fhe-state to mark a proposal as authorized.
    pub fn authorize_proposal(
        ctx: Context<AuthorizeProposal>,
        proposal_id: [u8; 32],
    ) -> Result<()> {
        instructions::authorize_proposal::handler(ctx, proposal_id)
    }

    /// Finalizes the agent and begins position wind-down.
    pub fn close_agent(ctx: Context<CloseAgent>) -> Result<()> {
        instructions::close_agent::handler(ctx)
    }
}
