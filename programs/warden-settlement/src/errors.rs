use anchor_lang::prelude::*;

#[error_code]
pub enum WardenSettlementError {
    #[msg("Caller is not the vault authority")]
    Unauthorized,

    #[msg("Viewing key has already been revoked")]
    ViewingKeyRevoked,

    #[msg("Transfer amount exceeds available shielded balance")]
    InsufficientBalance,

    #[msg("Umbra shield operation failed")]
    ShieldFailed,

    #[msg("Umbra unshield operation failed")]
    UnshieldFailed,

    #[msg("Invalid shielded address format")]
    InvalidShieldedAddress,
}
