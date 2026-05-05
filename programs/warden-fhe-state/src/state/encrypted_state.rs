use anchor_lang::prelude::*;

/// Maximum byte length of a REFHE-encrypted state blob.
pub const MAX_FHE_CIPHERTEXT_LEN: usize = 8_192;

#[account]
#[derive(Debug)]
pub struct EncryptedStateAccount {
    /// The AgentAccount this state belongs to.
    pub agent: Pubkey,

    /// REFHE-encrypted position state blob. Layout is opaque to on-chain code.
    pub fhe_ciphertext: Vec<u8>,

    /// Keccak256 hash of the FHE encryption public key used to produce
    /// fhe_ciphertext. Used to bind state to a specific principal key.
    pub fhe_pubkey_hash: [u8; 32],

    /// Monotonically increasing version counter. Prevents stale-state replays.
    pub state_version: u64,

    /// Unix timestamp of the last successful FHE computation.
    pub last_computation: i64,

    /// Total number of computations executed against this state.
    pub computation_count: u64,

    pub bump: u8,
}

impl EncryptedStateAccount {
    pub const SEED_PREFIX: &'static [u8] = b"fhe_state";

    pub const LEN: usize =
        8                          // discriminator
        + 32                       // agent
        + 4 + MAX_FHE_CIPHERTEXT_LEN // fhe_ciphertext (vec len prefix + data)
        + 32                       // fhe_pubkey_hash
        + 8                        // state_version
        + 8                        // last_computation
        + 8                        // computation_count
        + 1;                       // bump
}
