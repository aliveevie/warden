//! Smoke tests for warden-core that run real BPF in LiteSVM.
//!
//! These exercise the parts of the program that don't require a live Encrypt
//! or Ika simulator: agent creation, dWallet binding, error paths. The full
//! Encrypt+Ika happy path is exercised by the devnet integration script.

use anchor_lang::AnchorSerialize;
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

const WARDEN_SO: &[u8] = include_bytes!("../target/deploy/warden_core.so");

fn warden_program_id() -> Pubkey {
    Pubkey::new_from_array(warden_core::ID.to_bytes())
}

fn anchor_disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{}", name).as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}

fn boot() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.add_program(warden_program_id(), WARDEN_SO);
    (svm, payer)
}

fn create_agent_ix(payer_pk: Pubkey, authority_pk: Pubkey, agent_id: [u8; 32]) -> (Instruction, Pubkey) {
    let pid = warden_program_id();
    let (agent_pda, _) = Pubkey::find_program_address(&[b"agent", &agent_id], &pid);
    let mut data = anchor_disc("create_agent").to_vec();
    data.extend_from_slice(&agent_id);
    let ix = Instruction {
        program_id: pid,
        accounts: vec![
            AccountMeta::new(agent_pda, false),
            AccountMeta::new_readonly(authority_pk, true),
            AccountMeta::new(payer_pk, true),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };
    (ix, agent_pda)
}

fn bind_dwallet_ix(authority_pk: Pubkey, agent_pda: Pubkey, dwallet_pubkey: Pubkey) -> Instruction {
    let mut data = anchor_disc("bind_dwallet").to_vec();
    dwallet_pubkey.serialize(&mut data).unwrap();
    Instruction {
        program_id: warden_program_id(),
        accounts: vec![
            AccountMeta::new(agent_pda, false),
            AccountMeta::new_readonly(authority_pk, true),
        ],
        data,
    }
}

fn send(
    svm: &mut LiteSVM,
    fee_payer: &Keypair,
    signers: &[&Keypair],
    ix: Instruction,
) -> Result<(), String> {
    let msg = Message::new(&[ix], Some(&fee_payer.pubkey()));
    let tx = Transaction::new(signers, msg, svm.latest_blockhash());
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

#[test]
fn create_agent_persists_initial_state() {
    let (mut svm, payer) = boot();
    let agent_id = *b"warden-frontier-hackathon-test01";

    let (ix, agent_pda) = create_agent_ix(payer.pubkey(), payer.pubkey(), agent_id);
    send(&mut svm, &payer, &[&payer], ix).expect("create_agent succeeds");

    let raw = svm.get_account(&agent_pda).expect("agent PDA exists");
    assert_eq!(raw.owner.to_bytes(), warden_core::ID.to_bytes());

    // Anchor layout: 8-byte disc + Agent fields.
    // Agent: authority(32) + agent_id(32) + ika_dwallet(32) + proposals_seen(8) + proposals_authorised(8) + bump(1)
    let data = &raw.data[..];
    assert_eq!(&data[8..40], &payer.pubkey().to_bytes()[..], "authority persisted");
    assert_eq!(&data[40..72], &agent_id[..], "agent_id persisted");
    assert_eq!(&data[72..104], &[0u8; 32], "ika_dwallet starts zeroed");
    assert_eq!(u64::from_le_bytes(data[104..112].try_into().unwrap()), 0, "proposals_seen=0");
    assert_eq!(u64::from_le_bytes(data[112..120].try_into().unwrap()), 0, "proposals_authorised=0");
}

#[test]
fn bind_dwallet_records_pubkey_then_blocks_rebind() {
    let (mut svm, payer) = boot();
    let agent_id = *b"warden-bind-test-agent-id-pad-3x";

    let (init_ix, agent_pda) = create_agent_ix(payer.pubkey(), payer.pubkey(), agent_id);
    send(&mut svm, &payer, &[&payer], init_ix).unwrap();

    let dwallet_pubkey = Pubkey::new_unique();
    let bind_ix = bind_dwallet_ix(payer.pubkey(), agent_pda, dwallet_pubkey);
    send(&mut svm, &payer, &[&payer], bind_ix).expect("first bind succeeds");

    let raw = svm.get_account(&agent_pda).unwrap();
    assert_eq!(&raw.data[72..104], &dwallet_pubkey.to_bytes()[..], "dwallet recorded");

    // Second bind must fail (DwalletAlreadyBound).
    svm.expire_blockhash();
    let other = Pubkey::new_unique();
    let bind_ix_2 = bind_dwallet_ix(payer.pubkey(), agent_pda, other);
    let res = send(&mut svm, &payer, &[&payer], bind_ix_2);
    assert!(res.is_err(), "second bind must be rejected");
}

#[test]
fn bind_dwallet_from_wrong_authority_is_rejected() {
    let (mut svm, payer) = boot();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let agent_id = *b"unauth-bind-attempt-fixed-32-len";
    let (init_ix, agent_pda) = create_agent_ix(payer.pubkey(), payer.pubkey(), agent_id);
    send(&mut svm, &payer, &[&payer], init_ix).unwrap();

    let bind_ix = bind_dwallet_ix(attacker.pubkey(), agent_pda, Pubkey::new_unique());
    let res = send(&mut svm, &attacker, &[&attacker], bind_ix);
    assert!(res.is_err(), "bind by attacker must be rejected");
}
