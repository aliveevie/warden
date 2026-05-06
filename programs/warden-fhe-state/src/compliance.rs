use encrypt_dsl::*;
use encrypt_types::*;

/// Guardrail compliance function executed by the Encrypt network.
///
/// All inputs are encrypted `EUint64` values — the Encrypt executor evaluates
/// this function homomorphically without ever seeing plaintext values.
/// The output is an `EBool` ciphertext stored in a ciphertext account on-chain.
///
/// Predicates asserted (over encrypted data):
///   1. trade_size_bps ≤ max_trade_bps        — trade within size limit
///   2. daily_loss_bps ≤ loss_limit_bps        — daily loss within limit
///   3. open_positions < max_open_positions    — position count within limit
///
/// The Pedersen commitment to the plaintext result is submitted off-chain
/// alongside the proposal, and bound to the ciphertext output by the
/// Encrypt executor's commitment scheme.
#[encrypt_fn]
pub fn check_guardrail_compliance(
    // Encrypted position state inputs (provided by agent off-chain)
    trade_size_bps:   EUint64,
    daily_loss_bps:   EUint64,
    open_positions:   EUint64,
    // Guardrail thresholds (from PolicyAccount — public values encrypted
    // by the agent to enable homomorphic comparison)
    max_trade_bps:    EUint64,
    loss_limit_bps:   EUint64,
    max_open_pos:     EUint64,
) -> EBool {
    let size_ok      = trade_size_bps <= max_trade_bps;
    let loss_ok      = daily_loss_bps <= loss_limit_bps;
    let positions_ok = open_positions < max_open_pos;

    size_ok & loss_ok & positions_ok
}
