//! End-to-end integration tests that load the BPF .so artifacts into LiteSVM
//! and exercise real on-chain transactions against warden-policy.
//!
//! These are NOT mock tests — every byte of the program is executed by the
//! Solana SBF VM. State assertions read account data straight off the
//! LiteSVM ledger. We construct instructions using solana-sdk 2.0 types
//! directly (rather than going through Anchor's helpers) because anchor 0.30
//! pins solana-program 1.18 while litesvm pulls in solana-program 2.0.

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

const POLICY_SO: &[u8] = include_bytes!("../../../target/deploy/warden_policy.so");
// Reuse the settlement .so as a placeholder executable for the Ika program
// account. Anchor's `Program<'info, IkaDwallet>` validation only checks the
// address and `executable` flag — it never invokes the program in our
// non-CPI tests (initialize_policy, pause_agent, resume_agent).
const NOOP_PROGRAM_SO: &[u8] = include_bytes!("../../../target/deploy/warden_settlement.so");

// We translate the program's own Pubkey (from solana-program 1.18) into the
// 2.0 type by going through bytes — the wire format is identical.
fn policy_program_id() -> Pubkey {
    Pubkey::new_from_array(warden_policy::ID.to_bytes())
}
fn ika_program_id() -> Pubkey {
    Pubkey::new_from_array(warden_policy::ika_program::ID.to_bytes())
}

// 8-byte Anchor discriminator for "global:<ix_name>".
fn discriminator(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let preimage = format!("global:{}", name);
    let h        = Sha256::digest(preimage.as_bytes());
    let mut d    = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}

fn make_guardrails() -> warden_policy::state::GuardrailSet {
    use anchor_lang::prelude::Pubkey as AnchorPk;
    use warden_policy::state::{MAX_ALLOWED_PROTOCOLS, MAX_ALLOWED_ASSETS};
    warden_policy::state::GuardrailSet {
        max_trade_size_bps:    500,
        allowed_protocols:     [AnchorPk::default(); MAX_ALLOWED_PROTOCOLS],
        cooldown_seconds:      30,
        max_open_positions:    5,
        allowed_assets:        [AnchorPk::default(); MAX_ALLOWED_ASSETS],
        daily_loss_limit_bps:  300,
    }
}

fn boot() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let payer   = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.add_program(policy_program_id(), POLICY_SO);
    // Load any executable BPF binary at the Ika program ID so Anchor's
    // `Program<'info, IkaDwallet>` account validation accepts it. The
    // program is never invoked in these tests.
    svm.add_program(ika_program_id(), NOOP_PROGRAM_SO);
    (svm, payer)
}

fn agent_id_seed(label: &[u8]) -> [u8; 32] {
    let mut id = [0u8; 32];
    id[..label.len().min(32)].copy_from_slice(&label[..label.len().min(32)]);
    id
}

fn pdas(agent_id: &[u8; 32]) -> (Pubkey, Pubkey) {
    let pid = policy_program_id();
    let (policy_pda, _) = Pubkey::find_program_address(&[b"policy", agent_id], &pid);
    let (agent_pda, _)  = Pubkey::find_program_address(&[b"agent",  agent_id], &pid);
    (policy_pda, agent_pda)
}

fn initialize_policy_ix(
    payer: &Keypair,
    agent_id: [u8; 32],
) -> Instruction {
    let (policy_pda, agent_pda) = pdas(&agent_id);

    // Args = InitializePolicyArgs { agent_id, guardrail_set }
    let args = warden_policy::instructions::initialize_policy::InitializePolicyArgs {
        agent_id,
        guardrail_set: make_guardrails(),
    };

    let mut data = discriminator("initialize_policy").to_vec();
    args.serialize(&mut data).expect("serialize args");

    Instruction {
        program_id: policy_program_id(),
        accounts:   vec![
            AccountMeta::new(policy_pda, false),
            AccountMeta::new(agent_pda,  false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(ika_program_id(),   false),
        ],
        data,
    }
}

fn pause_ix(payer_pk: Pubkey, policy_pda: Pubkey) -> Instruction {
    Instruction {
        program_id: policy_program_id(),
        accounts:   vec![
            AccountMeta::new(policy_pda, false),
            AccountMeta::new_readonly(payer_pk, true),
        ],
        data: discriminator("pause_agent").to_vec(),
    }
}

fn resume_ix(payer_pk: Pubkey, policy_pda: Pubkey) -> Instruction {
    let mut data = discriminator("resume_agent").to_vec();
    data.extend_from_slice(&[0u8; 64]); // ika_cosig
    Instruction {
        program_id: policy_program_id(),
        accounts:   vec![
            AccountMeta::new(policy_pda, false),
            AccountMeta::new_readonly(payer_pk, true),
        ],
        data,
    }
}

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> Result<(), String> {
    let msg = Message::new(&[ix], Some(&signer.pubkey()));
    let tx  = Transaction::new(&[signer], msg, svm.latest_blockhash());
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

#[test]
fn t1_initialize_policy_creates_pdas_and_persists_state() {
    let (mut svm, payer) = boot();
    let agent_id          = agent_id_seed(b"warden-test-1");
    let (policy_pda, _)   = pdas(&agent_id);

    send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id))
        .expect("initialize_policy succeeds");

    let raw = svm.get_account(&policy_pda).expect("policy PDA must exist");
    assert_eq!(raw.owner.to_bytes(), warden_policy::ID.to_bytes());

    let policy = warden_policy::state::PolicyAccount::try_deserialize(&mut &raw.data[..])
        .expect("decode PolicyAccount");
    assert_eq!(policy.authority.to_bytes(), payer.pubkey().to_bytes());
    assert_eq!(policy.agent_id, agent_id);
    assert_eq!(policy.guardrail_set.max_trade_size_bps, 500);
    assert_eq!(policy.guardrail_set.cooldown_seconds, 30);
    assert_eq!(policy.guardrail_set.max_open_positions, 5);
    assert_eq!(policy.guardrail_set.daily_loss_limit_bps, 300);
    assert!(!policy.paused);
    assert_eq!(policy.nonce, 0);
}

#[test]
fn t2_pause_then_resume_flips_paused_flag() {
    let (mut svm, payer) = boot();
    let agent_id          = agent_id_seed(b"pause-test");
    let (policy_pda, _)   = pdas(&agent_id);

    send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id)).unwrap();

    send(&mut svm, &payer, pause_ix(payer.pubkey(), policy_pda)).expect("pause OK");
    let raw = svm.get_account(&policy_pda).unwrap();
    let p   = warden_policy::state::PolicyAccount::try_deserialize(&mut &raw.data[..]).unwrap();
    assert!(p.paused, "expected paused=true after pause_agent");

    send(&mut svm, &payer, resume_ix(payer.pubkey(), policy_pda)).expect("resume OK");
    let raw = svm.get_account(&policy_pda).unwrap();
    let p   = warden_policy::state::PolicyAccount::try_deserialize(&mut &raw.data[..]).unwrap();
    assert!(!p.paused, "expected paused=false after resume_agent");
}

#[test]
fn t3_pause_from_wrong_authority_is_rejected() {
    let (mut svm, payer) = boot();
    let attacker          = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let agent_id        = agent_id_seed(b"unauth-test");
    let (policy_pda, _) = pdas(&agent_id);
    send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id)).unwrap();

    let result = send(&mut svm, &attacker, pause_ix(attacker.pubkey(), policy_pda));
    assert!(result.is_err(),
            "expected pause_agent by attacker to be rejected, got Ok()");
}

#[test]
fn t4_double_initialize_is_rejected() {
    let (mut svm, payer) = boot();
    let agent_id          = agent_id_seed(b"double-init");

    send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id))
        .expect("first initialize OK");

    // Need a fresh blockhash for second tx in some envs.
    svm.expire_blockhash();
    let second = send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id));
    assert!(second.is_err(),
            "expected second initialize_policy on same agent_id to fail");
}

#[test]
fn t5_resume_when_not_paused_is_rejected() {
    let (mut svm, payer) = boot();
    let agent_id          = agent_id_seed(b"resume-not-paused");
    let (policy_pda, _)   = pdas(&agent_id);

    send(&mut svm, &payer, initialize_policy_ix(&payer, agent_id)).unwrap();

    let result = send(&mut svm, &payer, resume_ix(payer.pubkey(), policy_pda));
    assert!(result.is_err(),
            "expected resume on a non-paused agent to fail");
}
