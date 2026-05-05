use anchor_lang::prelude::*;

pub const MAX_ENCRYPTED_INTENT_LEN: usize = 4_096;
pub const MAX_FHE_PROOF_LEN: usize = 8_192;

/// Lifecycle of a submitted action proposal.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    VerifiedCompliant,
    VerifiedNonCompliant,
    Executed,
    Expired,
}

#[account]
#[derive(Debug)]
pub struct ProposalAccount {
    /// The AgentAccount this proposal targets.
    pub agent: Pubkey,

    /// Ephemeral session key that signed this proposal off-chain.
    pub proposer: Pubkey,

    /// REFHE-encrypted action intent (swap, rebalance, etc.).
    pub encrypted_intent: Vec<u8>,

    /// REFHE compliance proof asserting guardrail satisfaction over ciphertext.
    pub fhe_proof: Vec<u8>,

    /// Pedersen commitment to the plaintext result; used by Ika co-signer.
    pub result_commitment: [u8; 32],

    /// State version of EncryptedStateAccount at proposal creation time.
    pub state_version_at_creation: u64,

    pub status: ProposalStatus,

    pub created_at: i64,
    pub expires_at: i64,

    pub bump: u8,
}

impl ProposalAccount {
    pub const SEED_PREFIX: &'static [u8] = b"proposal";
    /// Proposals expire after 10 minutes if not executed.
    pub const TTL_SECONDS: i64 = 600;

    pub const LEN: usize =
        8                                  // discriminator
        + 32                               // agent
        + 32                               // proposer
        + 4 + MAX_ENCRYPTED_INTENT_LEN     // encrypted_intent
        + 4 + MAX_FHE_PROOF_LEN            // fhe_proof
        + 32                               // result_commitment
        + 8                                // state_version_at_creation
        + 1                                // status (enum variant)
        + 8                                // created_at
        + 8                                // expires_at
        + 1;                               // bump
}
