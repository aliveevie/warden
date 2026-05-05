use anchor_lang::prelude::*;
use crate::state::{EncryptedStateAccount, MAX_FHE_CIPHERTEXT_LEN};

#[derive(Accounts)]
#[instruction(agent_id: [u8; 32])]
pub struct InitializeState<'info> {
    #[account(
        init,
        payer = authority,
        space = EncryptedStateAccount::LEN,
        seeds = [EncryptedStateAccount::SEED_PREFIX, agent_id.as_ref()],
        bump,
    )]
    pub encrypted_state: Account<'info, EncryptedStateAccount>,

    /// CHECK: Validated against agent_id via PDA derivation.
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeState>,
    agent_id: [u8; 32],
    fhe_pubkey_hash: [u8; 32],
) -> Result<()> {
    let state            = &mut ctx.accounts.encrypted_state;
    state.agent          = ctx.accounts.agent.key();
    state.fhe_ciphertext = vec![0u8; 0];
    state.fhe_pubkey_hash     = fhe_pubkey_hash;
    state.state_version  = 0;
    state.last_computation = 0;
    state.computation_count = 0;
    state.bump           = ctx.bumps.encrypted_state;

    let _ = agent_id; // used in PDA seeds

    emit!(StateInitialized {
        agent:           ctx.accounts.agent.key(),
        fhe_pubkey_hash,
    });

    Ok(())
}

#[event]
pub struct StateInitialized {
    pub agent:           Pubkey,
    pub fhe_pubkey_hash: [u8; 32],
}
