use anchor_lang::prelude::*;

// Sized to keep total ProposalAccount space below Solana's 10 KB inner-CPI
// realloc cap. Larger ciphertexts/proofs should be split across multiple
// chunks or stored in a side account.
pub const MAX_ENCRYPTED_INTENT_LEN: usize = 1_024;
pub const MAX_FHE_PROOF_LEN: usize = 2_048;

/// 6 × 32-byte ciphertext handles for the compliance DAG inputs.
pub const COMPLIANCE_INPUTS_LEN: usize = 6 * 32; // 192

/// Lifecycle of a submitted action proposal.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Freshly submitted; compliance graph not yet dispatched.
    Pending,
    /// execute_compliance_graph has been called; awaiting Encrypt executor.
    GraphExecuted,
    /// Encrypt result read: compliant — authorize_proposal CPI fired.
    VerifiedCompliant,
    /// Encrypt result read: non-compliant — action blocked.
    VerifiedNonCompliant,
    /// Final on-chain action executed post-dWallet co-signature.
    Executed,
    /// TTL elapsed without finalisation.
    Expired,
}

/// Packed ciphertext handle references for the Encrypt compliance graph.
/// Each handle is a 32-byte key pointing to a ciphertext account.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct ComplianceGraphInputs {
    pub trade_size_bps_handle: [u8; 32],
    pub daily_loss_bps_handle: [u8; 32],
    pub open_positions_handle: [u8; 32],
    pub max_trade_bps_handle:  [u8; 32],
    pub loss_limit_bps_handle: [u8; 32],
    pub max_open_pos_handle:   [u8; 32],
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

    /// Ciphertext handle inputs for the Encrypt compliance graph.
    /// Set at submit time; consumed by execute_compliance_graph.
    pub compliance_inputs: Option<ComplianceGraphInputs>,

    /// Account key of the Encrypt-managed output ciphertext.
    /// Written by execute_compliance_graph; read by finalise_proposal.
    pub output_ciphertext: Pubkey,

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
        + 1 + COMPLIANCE_INPUTS_LEN        // Option<ComplianceGraphInputs>
        + 32                               // output_ciphertext
        + 1                                // status (enum variant)
        + 8                                // created_at
        + 8                                // expires_at
        + 1;                               // bump
}
