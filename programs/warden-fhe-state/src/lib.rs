use anchor_lang::prelude::*;

pub mod compliance;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("WRDNfhe2icyMPVQeT2BpnmFYQBkzH1jEA3E6W3HmPuMj");

/// Encrypt program deployed on Solana devnet.
pub mod encrypt_program {
    anchor_lang::declare_id!("4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8");
}

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

    /// Submits an action proposal with the encrypted intent, FHE proof,
    /// result commitment, and the ciphertext handles for the compliance graph.
    pub fn submit_proposal(
        ctx: Context<SubmitProposal>,
        args: SubmitProposalArgs,
    ) -> Result<()> {
        instructions::submit_proposal::handler(ctx, args)
    }

    /// Dispatches the `check_guardrail_compliance` DAG to the Encrypt program.
    /// The Encrypt off-chain executor evaluates the graph homomorphically and
    /// commits the EBool result to `output_ciphertext`.
    pub fn execute_compliance_graph(
        ctx: Context<ExecuteComplianceGraph>,
    ) -> Result<()> {
        instructions::execute_compliance_graph::handler(ctx)
    }

    /// Reads the committed EBool from the Encrypt output ciphertext.
    /// If compliant, marks the proposal VerifiedCompliant and CPIs to
    /// warden-policy to authorise the Ika dWallet co-signature.
    pub fn finalise_proposal(
        ctx: Context<FinaliseProposal>,
    ) -> Result<()> {
        instructions::finalise_proposal::handler(ctx)
    }

    /// Marks a VerifiedCompliant proposal as Executed after the dWallet
    /// co-signature is confirmed on the target chain. Also bumps state version.
    pub fn execute_proposal(
        ctx: Context<ExecuteProposal>,
    ) -> Result<()> {
        instructions::execute_proposal::handler(ctx)
    }

    /// Writes a new FHE-encrypted state blob to the EncryptedStateAccount.
    /// Called by the off-chain orchestrator after a successful execution to
    /// reflect updated position state.
    pub fn update_encrypted_state(
        ctx: Context<UpdateEncryptedState>,
        new_ciphertext: Vec<u8>,
    ) -> Result<()> {
        instructions::update_encrypted_state::handler(ctx, new_ciphertext)
    }
}
