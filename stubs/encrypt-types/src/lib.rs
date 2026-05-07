//! Local stub for `encrypt-types`. Mirrors the public surface used by
//! warden-fhe-state's compliance DSL plus the `EBool` returned by
//! `encrypt_anchor::cpi::read_ciphertext`.

use anchor_lang::prelude::*;
use std::ops::BitAnd;

/// Encrypted u64 — in the real crate this wraps an REFHE ciphertext handle.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct EUint64(pub [u8; 32]);

/// Encrypted bool — homomorphic comparison output.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct EBool(pub [u8; 32]);

impl EBool {
    /// In the real crate this triggers a decryption of the committed
    /// plaintext via the executor's commitment scheme. The stub returns
    /// the low bit of the handle so the type-checker is satisfied.
    pub fn value(&self) -> bool {
        self.0[0] & 1 == 1
    }
}

impl PartialOrd for EUint64 {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.0.partial_cmp(&other.0)
    }
}
impl PartialEq for EUint64 {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl BitAnd for EBool {
    type Output = EBool;
    fn bitand(self, rhs: EBool) -> EBool {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = self.0[i] & rhs.0[i];
        }
        EBool(out)
    }
}

/// Computation graph submitted to the Encrypt program via `execute_graph`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct ComputationGraph {
    pub nodes: Vec<u8>,
}
