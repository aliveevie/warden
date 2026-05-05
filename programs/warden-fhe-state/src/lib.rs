use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("WRDNfhe2icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMj");

#[program]
pub mod warden_fhe_state {
    use super::*;

    /// Initialises the encrypted state account for an agent.
    pub fn initialize_state(
        ctx: Context<InitializeState>,
        agent_id: [u8; 32],
        fhe_pubkey_hash: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_state::handler(ctx, agent_id, fhe_pubkey_hash)
    }

    /// Submits an encrypted action proposal with a REFHE compliance proof.
    pub fn submit_proposal(
        ctx: Context<SubmitProposal>,
        args: SubmitProposalArgs,
    ) -> Result<()> {
        instructions::submit_proposal::handler(ctx, args)
    }

    /// Verifies the REFHE proof and marks the proposal as compliant or not.
    /// TODO(PR-1): replace stub with live REFHE verifier CPI.
    pub fn verify_proposal(ctx: Context<VerifyProposal>) -> Result<()> {
        instructions::verify_proposal::handler(ctx)
    }

    /// Executes a verified-compliant proposal and updates encrypted state.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        instructions::execute_proposal::handler(ctx)
    }
}
