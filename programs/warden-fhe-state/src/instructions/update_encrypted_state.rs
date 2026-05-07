use anchor_lang::prelude::*;
use crate::{
    errors::WardenFheError,
    state::{EncryptedStateAccount, MAX_FHE_CIPHERTEXT_LEN},
};

#[derive(Accounts)]
pub struct UpdateEncryptedState<'info> {
    /// Only the authority that owns the agent may update the encrypted state.
    #[account(
        mut,
        constraint = encrypted_state.agent == authority.key()
            @ WardenFheError::Unauthorized,
    )]
    pub encrypted_state: Account<'info, EncryptedStateAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Writes a new encrypted state blob produced by the off-chain agent after a
/// successfully executed and authorised proposal. The state_version must be
/// incremented by the caller (warden-fhe-state increments it inside
/// finalise_proposal when compliant; this instruction is for out-of-band
/// refreshes such as rebalancing without a pending proposal).
pub fn handler(
    ctx: Context<UpdateEncryptedState>,
    new_ciphertext: Vec<u8>,
) -> Result<()> {
    require!(
        new_ciphertext.len() <= MAX_FHE_CIPHERTEXT_LEN,
        WardenFheError::StateCiphertextTooLarge
    );

    let clock = Clock::get()?;
    let state = &mut ctx.accounts.encrypted_state;

    state.fhe_ciphertext  = new_ciphertext;
    state.state_version  += 1;
    state.last_computation = clock.unix_timestamp;
    state.computation_count += 1;

    emit!(EncryptedStateUpdated {
        agent:         state.agent,
        state_version: state.state_version,
        updated_at:    clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct EncryptedStateUpdated {
    pub agent:         Pubkey,
    pub state_version: u64,
    pub updated_at:    i64,
}
