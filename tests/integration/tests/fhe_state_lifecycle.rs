//! End-to-end integration tests for warden-fhe-state.
//!
//! Loads the real BPF .so into LiteSVM and exercises:
//!   - initialize_state — creates EncryptedStateAccount with the agent's
//!     public-key hash bound to it
//!   - submit_proposal — opens a ProposalAccount in `Pending` status
//!   - update_encrypted_state — bumps state_version and stores a new ciphertext

use anchor_lang::AccountDeserialize;
use anchor_lang::AnchorSerialize;
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

const FHE_STATE_SO: &[u8] =
    include_bytes!("../../../target/deploy/warden_fhe_state.so");
const NOOP_SO: &[u8] = include_bytes!("../../../target/deploy/warden_settlement.so");

fn fhe_state_program_id() -> Pubkey {
    Pubkey::new_from_array(warden_fhe_state::ID.to_bytes())
}

fn discriminator(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let h     = Sha256::digest(format!("global:{}", name).as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}

fn boot() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let payer   = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    svm.add_program(fhe_state_program_id(), FHE_STATE_SO);
    // Encrypt program placeholder so any account-validation path that
    // references `Program<'info, Encrypt>` is happy. (Not invoked here.)
    let encrypt_id = Pubkey::new_from_array(
        warden_fhe_state::encrypt_program::ID.to_bytes(),
    );
    svm.add_program(encrypt_id, NOOP_SO);
    (svm, payer)
}

fn initialize_state_ix(
    payer: &Keypair,
    agent: Pubkey,
    agent_id: [u8; 32],
    fhe_pubkey_hash: [u8; 32],
) -> (Instruction, Pubkey) {
    let (state_pda, _) = Pubkey::find_program_address(
        &[b"fhe_state", &agent_id],
        &fhe_state_program_id(),
    );

    let mut data = discriminator("initialize_state").to_vec();
    data.extend_from_slice(&agent_id);
    data.extend_from_slice(&fhe_pubkey_hash);

    let ix = Instruction {
        program_id: fhe_state_program_id(),
        accounts: vec![
            AccountMeta::new(state_pda, false),
            AccountMeta::new_readonly(agent, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };
    (ix, state_pda)
}

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> Result<(), String> {
    let msg = Message::new(&[ix], Some(&signer.pubkey()));
    let tx  = Transaction::new(&[signer], msg, svm.latest_blockhash());
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

#[test]
fn s1_initialize_state_creates_account_with_pubkey_hash() {
    let (mut svm, payer) = boot();
    let agent_id          = [0xAAu8; 32];
    let pubkey_hash       = [0xBBu8; 32];

    let agent = Pubkey::new_unique();
    let (ix, state_pda) = initialize_state_ix(&payer, agent, agent_id, pubkey_hash);
    send(&mut svm, &payer, ix).expect("initialize_state succeeds");

    let raw = svm.get_account(&state_pda).expect("state PDA must exist");
    assert_eq!(raw.owner.to_bytes(), warden_fhe_state::ID.to_bytes());

    let st = warden_fhe_state::state::EncryptedStateAccount::try_deserialize(
        &mut &raw.data[..],
    )
    .expect("decode EncryptedStateAccount");
    assert_eq!(st.agent.to_bytes(), agent.to_bytes());
    assert_eq!(st.fhe_pubkey_hash, pubkey_hash);
    assert_eq!(st.state_version, 0);
    assert_eq!(st.computation_count, 0);
    assert_eq!(st.fhe_ciphertext.len(), 0);
}

#[test]
fn s2_submit_proposal_creates_pending_proposal() {
    let (mut svm, payer) = boot();
    let agent_id          = [0xCCu8; 32];
    let pubkey_hash       = [0xDDu8; 32];

    // Step 1: state account.
    let (init_ix, state_pda) = initialize_state_ix(
        &payer,
        Pubkey::new_unique(),
        agent_id,
        pubkey_hash,
    );
    send(&mut svm, &payer, init_ix).expect("init state");

    // Step 2: submit a proposal.
    let proposal_id  = [0x11u8; 32];
    let (proposal_pda, _) = Pubkey::find_program_address(
        &[b"proposal", &proposal_id],
        &fhe_state_program_id(),
    );

    let args = warden_fhe_state::instructions::submit_proposal::SubmitProposalArgs {
        proposal_id,
        encrypted_intent:  vec![1, 2, 3, 4, 5],
        fhe_proof:         vec![9, 8, 7, 6],
        result_commitment: [0x42u8; 32],
        compliance_inputs: warden_fhe_state::state::ComplianceGraphInputs::default(),
    };
    let mut data = discriminator("submit_proposal").to_vec();
    args.serialize(&mut data).unwrap();

    let ix = Instruction {
        program_id: fhe_state_program_id(),
        accounts: vec![
            AccountMeta::new(proposal_pda, false),
            AccountMeta::new_readonly(state_pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };
    send(&mut svm, &payer, ix).expect("submit_proposal succeeds");

    let raw = svm.get_account(&proposal_pda).expect("proposal PDA must exist");
    let p   = warden_fhe_state::state::ProposalAccount::try_deserialize(
        &mut &raw.data[..],
    )
    .expect("decode ProposalAccount");
    assert_eq!(p.encrypted_intent, vec![1, 2, 3, 4, 5]);
    assert_eq!(p.fhe_proof, vec![9, 8, 7, 6]);
    assert_eq!(p.result_commitment, [0x42u8; 32]);
    assert_eq!(p.state_version_at_creation, 0);
    assert!(matches!(
        p.status,
        warden_fhe_state::state::ProposalStatus::Pending
    ));
    assert!(p.compliance_inputs.is_some());
}

#[test]
fn s3_update_encrypted_state_bumps_version() {
    let (mut svm, payer) = boot();
    let agent_id          = [0xEEu8; 32];
    let pubkey_hash       = [0x55u8; 32];

    // For this test the authority must equal `state.agent`; pass the
    // payer's pubkey as agent so update_encrypted_state's constraint passes.
    let (init_ix, state_pda) = initialize_state_ix(
        &payer,
        payer.pubkey(),
        agent_id,
        pubkey_hash,
    );
    send(&mut svm, &payer, init_ix).unwrap();

    // Pre-condition: state_version == 0
    let raw = svm.get_account(&state_pda).unwrap();
    let st0 = warden_fhe_state::state::EncryptedStateAccount::try_deserialize(
        &mut &raw.data[..],
    )
    .unwrap();
    assert_eq!(st0.state_version, 0);

    // Build update_encrypted_state ix.
    // accounts: encrypted_state (mut), authority (signer)
    // args: new_ciphertext: Vec<u8>
    let new_ct = vec![0xAB; 64];
    let mut data = discriminator("update_encrypted_state").to_vec();
    new_ct.serialize(&mut data).unwrap();

    let ix = Instruction {
        program_id: fhe_state_program_id(),
        accounts: vec![
            AccountMeta::new(state_pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };
    send(&mut svm, &payer, ix).expect("update_encrypted_state succeeds");

    let raw = svm.get_account(&state_pda).unwrap();
    let st1 = warden_fhe_state::state::EncryptedStateAccount::try_deserialize(
        &mut &raw.data[..],
    )
    .unwrap();
    assert_eq!(st1.state_version, 1, "state_version should bump to 1");
    assert_eq!(st1.fhe_ciphertext, new_ct);
    assert_eq!(st1.computation_count, 1, "computation_count should bump to 1");
}
