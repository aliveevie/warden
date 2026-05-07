// SPDX-License-Identifier: BSD-3-Clause-Clear
//
// Warden Core — Frontier hackathon submission (PR-1: Ika + Encrypt).
//
// A trust layer for autonomous AI financial agents on Solana.
//
//   1. The principal binds an Ika dWallet to an Agent. Authority is transferred
//      to this program's CPI authority PDA so only Warden can request signatures.
//   2. Off-chain, the agent encrypts its position state and the proposed action
//      under the Encrypt network's REFHE key, producing ciphertext accounts.
//   3. The agent submits a `Proposal`. Warden CPIs into the Encrypt program to
//      run the `check_compliance` graph homomorphically over the encrypted
//      inputs, producing an EBool ciphertext stored in an output account.
//   4. Anyone may call `request_compliance_decryption` to ask the Encrypt
//      network to decrypt the result. The returned digest is bound into the
//      proposal so the next step can verify the same ciphertext is being read.
//   5. After the network publishes the plaintext, `reveal_and_authorize` reads
//      the verified bool. If true, Warden CPIs into Ika `approve_message` to
//      cosign the action's `result_commitment`. The agent can then broadcast
//      the cosigned action against any chain Ika supports (BTC/ETH/Solana/...).
//
// Both Encrypt and Ika are essential: Encrypt makes the policy private and
// verifiable, Ika makes the resulting cosignature multi-chain. Neither is
// substitutable.

use anchor_lang::prelude::*;
use encrypt_anchor::EncryptContext;
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_types::encrypted::{EBool, EUint64, Bool};
use ika_dwallet_anchor::DWalletContext;

declare_id!("Htrj84e45UCgFTfn7GfDoHZHRRiPC8Lr74PD3mKdtBFq");

// ─── Compliance graph ────────────────────────────────────────────────────────
//
// Evaluated homomorphically by the Encrypt network. The agent never sees its
// own guardrails in the clear; the principal never sees the agent's positions.
// Both sides see only the EBool result on completion.

/// Returns true when the proposed action would not exceed any guardrail:
///   trade_size_bps <= max_trade_bps  AND
///   daily_loss_bps <= loss_limit_bps AND
///   open_positions <  max_open_pos
#[encrypt_fn]
fn check_compliance(
    trade_size_bps: EUint64,
    daily_loss_bps: EUint64,
    open_positions: EUint64,
    max_trade_bps:  EUint64,
    loss_limit_bps: EUint64,
    max_open_pos:   EUint64,
) -> EBool {
    let size_ok      = trade_size_bps.is_less_or_equal(&max_trade_bps);
    let loss_ok      = daily_loss_bps.is_less_or_equal(&loss_limit_bps);
    let positions_ok = open_positions.is_less_than(&max_open_pos);
    size_ok.and(&loss_ok).and(&positions_ok)
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Agent {
    /// The principal authority that controls this agent off-chain.
    pub authority: Pubkey,
    /// 32-byte deterministic agent identifier (used as PDA seed).
    pub agent_id: [u8; 32],
    /// Ika dWallet pubkey bound to this agent. Zero until bound.
    pub ika_dwallet: Pubkey,
    /// Number of proposals processed (compliant or not).
    pub proposals_seen: u64,
    /// Number of proposals that were authorised (cosigned by Ika).
    pub proposals_authorised: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum ProposalStatus {
    /// Submitted; compliance graph dispatched, no decryption requested yet.
    PendingDecryption,
    /// `request_compliance_decryption` fired; waiting for Encrypt to publish.
    Decrypting,
    /// Encrypt revealed result=true; Ika cosignature requested.
    Authorised,
    /// Encrypt revealed result=false; action permanently rejected.
    Rejected,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub agent: Pubkey,
    /// Identifier supplied by the agent; PDA seed.
    pub proposal_id: [u8; 32],
    /// Pedersen commitment to the plaintext (asset, amount, recipient, ...).
    /// Becomes the message Ika is asked to cosign on success.
    pub result_commitment: [u8; 32],
    /// Output ciphertext account holding the EBool produced by Encrypt.
    pub output_ciphertext: Pubkey,
    /// Decryption-request account; populated at request_compliance_decryption.
    pub decryption_request: Pubkey,
    /// Digest of the output ciphertext at decryption-request time. Verified
    /// against the request account at reveal time so the network can't lie.
    pub pending_digest: [u8; 32],
    pub status: ProposalStatus,
    pub created_at: i64,
    pub bump: u8,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod warden_core {
    use super::*;

    /// Initialise an `Agent` PDA. Authority is the principal's keypair.
    pub fn create_agent(ctx: Context<CreateAgent>, agent_id: [u8; 32]) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.authority            = ctx.accounts.authority.key();
        agent.agent_id             = agent_id;
        agent.ika_dwallet          = Pubkey::default();
        agent.proposals_seen       = 0;
        agent.proposals_authorised = 0;
        agent.bump                 = ctx.bumps.agent;
        emit!(AgentCreated {
            agent_id,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }

    /// Records the dWallet pubkey on the Agent. The actual authority transfer
    /// is performed off-chain via the Ika gRPC `transfer_ownership` flow before
    /// this is called — we just persist the binding.
    pub fn bind_dwallet(ctx: Context<BindDwallet>, dwallet_pubkey: Pubkey) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        require_keys_eq!(agent.authority, ctx.accounts.authority.key());
        require!(agent.ika_dwallet == Pubkey::default(), WardenError::DwalletAlreadyBound);
        agent.ika_dwallet = dwallet_pubkey;
        emit!(DwalletBound {
            agent_id: agent.agent_id,
            dwallet: dwallet_pubkey,
        });
        Ok(())
    }

    /// Submit an action proposal. Runs the `check_compliance` Encrypt graph
    /// over six encrypted inputs (the proposed trade size & loss & positions
    /// vs the agent's encrypted guardrails). Result lands in `output_ct`.
    pub fn submit_proposal(
        ctx: Context<SubmitProposal>,
        proposal_id: [u8; 32],
        result_commitment: [u8; 32],
        cpi_authority_bump: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Build EncryptContext from supplied accounts.
        let encrypt_ctx = EncryptContext {
            encrypt_program:        ctx.accounts.encrypt_program.to_account_info(),
            config:                 ctx.accounts.encrypt_config.to_account_info(),
            deposit:                ctx.accounts.encrypt_deposit.to_account_info(),
            cpi_authority:          ctx.accounts.encrypt_cpi_authority.to_account_info(),
            caller_program:         ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
            payer:                  ctx.accounts.payer.to_account_info(),
            event_authority:        ctx.accounts.event_authority.to_account_info(),
            system_program:         ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };

        // The `#[encrypt_fn]` macro generates a method on EncryptContext that
        // runs the graph and routes inputs/outputs to the supplied ciphertext
        // accounts. Six inputs, one output.
        let trade_size_ct = ctx.accounts.trade_size_ct.to_account_info();
        let loss_bps_ct   = ctx.accounts.loss_bps_ct.to_account_info();
        let positions_ct  = ctx.accounts.positions_ct.to_account_info();
        let max_trade_ct  = ctx.accounts.max_trade_ct.to_account_info();
        let loss_limit_ct = ctx.accounts.loss_limit_ct.to_account_info();
        let max_pos_ct    = ctx.accounts.max_pos_ct.to_account_info();
        let output_ct     = ctx.accounts.output_ct.to_account_info();

        encrypt_ctx.check_compliance(
            trade_size_ct,
            loss_bps_ct,
            positions_ct,
            max_trade_ct,
            loss_limit_ct,
            max_pos_ct,
            output_ct.clone(),
        )?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.agent              = ctx.accounts.agent.key();
        proposal.proposal_id        = proposal_id;
        proposal.result_commitment  = result_commitment;
        proposal.output_ciphertext  = output_ct.key();
        proposal.decryption_request = Pubkey::default();
        proposal.pending_digest     = [0u8; 32];
        proposal.status             = ProposalStatus::PendingDecryption;
        proposal.created_at         = clock.unix_timestamp;
        proposal.bump               = ctx.bumps.proposal;

        let agent = &mut ctx.accounts.agent;
        agent.proposals_seen += 1;

        emit!(ProposalSubmitted {
            agent: agent.key(),
            proposal_id,
            result_commitment,
        });
        Ok(())
    }

    /// Asks the Encrypt network to decrypt the EBool output of the compliance
    /// graph. Stores the ciphertext digest so reveal can verify integrity.
    pub fn request_compliance_decryption(
        ctx: Context<RequestComplianceDecryption>,
        cpi_authority_bump: u8,
    ) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        require!(
            proposal.status == ProposalStatus::PendingDecryption,
            WardenError::ProposalNotPending,
        );

        let encrypt_ctx = EncryptContext {
            encrypt_program:        ctx.accounts.encrypt_program.to_account_info(),
            config:                 ctx.accounts.encrypt_config.to_account_info(),
            deposit:                ctx.accounts.encrypt_deposit.to_account_info(),
            cpi_authority:          ctx.accounts.encrypt_cpi_authority.to_account_info(),
            caller_program:         ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
            payer:                  ctx.accounts.payer.to_account_info(),
            event_authority:        ctx.accounts.event_authority.to_account_info(),
            system_program:         ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };

        let digest = encrypt_ctx.request_decryption(
            &ctx.accounts.decryption_request.to_account_info(),
            &ctx.accounts.output_ct.to_account_info(),
        )?;

        let proposal = &mut ctx.accounts.proposal;
        proposal.decryption_request = ctx.accounts.decryption_request.key();
        proposal.pending_digest     = digest;
        proposal.status             = ProposalStatus::Decrypting;

        emit!(DecryptionRequested {
            agent: proposal.agent,
            proposal_id: proposal.proposal_id,
            digest,
        });
        Ok(())
    }

    /// After the Encrypt network publishes the plaintext into `decryption_request`,
    /// reads the verified bool. If true, CPIs to Ika `approve_message` to cosign
    /// the action's `result_commitment`. If false, marks proposal Rejected.
    pub fn reveal_and_authorize(
        ctx: Context<RevealAndAuthorize>,
        ika_cpi_authority_bump: u8,
        message_approval_bump: u8,
        signature_scheme: u16,
        message_metadata_digest: [u8; 32],
        user_pubkey: [u8; 32],
    ) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        require!(
            proposal.status == ProposalStatus::Decrypting,
            WardenError::ProposalNotDecrypting,
        );

        // Read the decrypted bool from the Encrypt request account, verifying
        // the digest matches what we stored at request time.
        let req_data    = ctx.accounts.decryption_request.try_borrow_data()?;
        let compliant_b = encrypt_anchor::accounts::read_decrypted_verified::<Bool>(
            &req_data,
            &proposal.pending_digest,
        ).map_err(|_| error!(WardenError::DecryptionVerificationFailed))?;
        let is_compliant: bool = *compliant_b;
        drop(req_data);

        let proposal_mut = &mut ctx.accounts.proposal;

        if !is_compliant {
            proposal_mut.status = ProposalStatus::Rejected;
            emit!(ProposalRejected {
                agent: proposal_mut.agent,
                proposal_id: proposal_mut.proposal_id,
            });
            return Ok(());
        }

        // Compliant — call Ika to cosign the result_commitment.
        let dwallet_ctx = DWalletContext {
            dwallet_program:    ctx.accounts.ika_program.to_account_info(),
            cpi_authority:      ctx.accounts.ika_cpi_authority.to_account_info(),
            caller_program:     ctx.accounts.caller_program.to_account_info(),
            cpi_authority_bump: ika_cpi_authority_bump,
        };
        dwallet_ctx.approve_message(
            &ctx.accounts.dwallet_coordinator.to_account_info(),
            &ctx.accounts.message_approval.to_account_info(),
            &ctx.accounts.dwallet.to_account_info(),
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            proposal_mut.result_commitment,
            message_metadata_digest,
            user_pubkey,
            signature_scheme,
            message_approval_bump,
        )?;

        proposal_mut.status = ProposalStatus::Authorised;
        let agent = &mut ctx.accounts.agent;
        agent.proposals_authorised += 1;

        emit!(ProposalAuthorised {
            agent: proposal_mut.agent,
            proposal_id: proposal_mut.proposal_id,
            result_commitment: proposal_mut.result_commitment,
        });
        Ok(())
    }
}

// ─── Account contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(agent_id: [u8; 32])]
pub struct CreateAgent<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", agent_id.as_ref()],
        bump,
    )]
    pub agent: Account<'info, Agent>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BindDwallet<'info> {
    #[account(mut)]
    pub agent: Account<'info, Agent>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32])]
pub struct SubmitProposal<'info> {
    #[account(mut)]
    pub agent: Account<'info, Agent>,
    #[account(
        init,
        payer = payer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", proposal_id.as_ref()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,
    pub proposer: Signer<'info>,

    /// CHECK: encrypted trade size handle (ciphertext account)
    #[account(mut)]
    pub trade_size_ct: UncheckedAccount<'info>,
    /// CHECK: encrypted daily loss handle
    #[account(mut)]
    pub loss_bps_ct: UncheckedAccount<'info>,
    /// CHECK: encrypted open positions handle
    #[account(mut)]
    pub positions_ct: UncheckedAccount<'info>,
    /// CHECK: encrypted max trade handle (from policy)
    #[account(mut)]
    pub max_trade_ct: UncheckedAccount<'info>,
    /// CHECK: encrypted loss limit handle (from policy)
    #[account(mut)]
    pub loss_limit_ct: UncheckedAccount<'info>,
    /// CHECK: encrypted max position count handle (from policy)
    #[account(mut)]
    pub max_pos_ct: UncheckedAccount<'info>,
    /// CHECK: output ciphertext account (newly created)
    #[account(mut)]
    pub output_ct: UncheckedAccount<'info>,

    // ── Encrypt program plumbing ───────────────────────────────────────────
    /// CHECK: Encrypt program (id verified by Encrypt SDK)
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config PDA
    #[account(mut)]
    pub encrypt_config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit PDA
    #[account(mut)]
    pub encrypt_deposit: UncheckedAccount<'info>,
    /// CHECK: this program's `__encrypt_cpi_authority` PDA
    pub encrypt_cpi_authority: UncheckedAccount<'info>,
    /// CHECK: this program's own program account (caller_program)
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt network encryption key PDA
    pub network_encryption_key: UncheckedAccount<'info>,
    /// CHECK: Encrypt event authority
    pub event_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestComplianceDecryption<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: the EBool ciphertext output of the compliance graph
    pub output_ct: UncheckedAccount<'info>,
    /// CHECK: PDA created by Encrypt to hold the decryption request/result
    #[account(mut)]
    pub decryption_request: UncheckedAccount<'info>,

    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config
    pub encrypt_config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit
    #[account(mut)]
    pub encrypt_deposit: UncheckedAccount<'info>,
    /// CHECK: Encrypt CPI authority for our caller_program
    pub encrypt_cpi_authority: UncheckedAccount<'info>,
    /// CHECK: this program's program account
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Network encryption key PDA
    pub network_encryption_key: UncheckedAccount<'info>,
    /// CHECK: Encrypt event authority
    pub event_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealAndAuthorize<'info> {
    #[account(mut)]
    pub agent: Account<'info, Agent>,
    #[account(mut, has_one = agent)]
    pub proposal: Account<'info, Proposal>,
    /// CHECK: the now-populated decryption request account
    pub decryption_request: UncheckedAccount<'info>,

    // ── Ika plumbing (only used on the compliant branch) ───────────────────
    /// CHECK: Ika dWallet program
    pub ika_program: UncheckedAccount<'info>,
    /// CHECK: this program's `__ika_cpi_authority` PDA
    pub ika_cpi_authority: UncheckedAccount<'info>,
    /// CHECK: this program's program account
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: DWalletCoordinator PDA
    pub dwallet_coordinator: UncheckedAccount<'info>,
    /// CHECK: dWallet account; constraint that .key() == agent.ika_dwallet
    #[account(constraint = dwallet.key() == agent.ika_dwallet @ WardenError::WrongDwallet)]
    pub dwallet: UncheckedAccount<'info>,
    /// CHECK: PDA the Ika program will create to record the approval
    #[account(mut)]
    pub message_approval: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum WardenError {
    #[msg("dWallet already bound to this agent")]
    DwalletAlreadyBound,
    #[msg("Wrong dWallet account for this agent")]
    WrongDwallet,
    #[msg("Proposal is not in PendingDecryption state")]
    ProposalNotPending,
    #[msg("Proposal is not in Decrypting state")]
    ProposalNotDecrypting,
    #[msg("Decryption verification failed (digest mismatch)")]
    DecryptionVerificationFailed,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct AgentCreated   { pub agent_id: [u8; 32], pub authority: Pubkey }
#[event]
pub struct DwalletBound   { pub agent_id: [u8; 32], pub dwallet: Pubkey }
#[event]
pub struct ProposalSubmitted { pub agent: Pubkey, pub proposal_id: [u8; 32], pub result_commitment: [u8; 32] }
#[event]
pub struct DecryptionRequested { pub agent: Pubkey, pub proposal_id: [u8; 32], pub digest: [u8; 32] }
#[event]
pub struct ProposalAuthorised { pub agent: Pubkey, pub proposal_id: [u8; 32], pub result_commitment: [u8; 32] }
#[event]
pub struct ProposalRejected   { pub agent: Pubkey, pub proposal_id: [u8; 32] }
