use anchor_lang::prelude::*;

#[error_code]
pub enum WardenFheError {
    #[msg("REFHE proof verification failed")]
    ProofVerificationFailed,

    #[msg("Proposal is not in Pending status")]
    ProposalNotPending,

    #[msg("Proposal is not in VerifiedCompliant status")]
    ProposalNotCompliant,

    #[msg("Proposal has expired")]
    ProposalExpired,

    #[msg("FHE ciphertext exceeds maximum allowed size")]
    CiphertextTooLarge,

    #[msg("State version mismatch — stale read")]
    StateVersionMismatch,

    #[msg("Caller is not the agent authority")]
    Unauthorized,
}
