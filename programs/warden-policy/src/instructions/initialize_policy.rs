use anchor_lang::prelude::*;
use crate::state::{AgentAccount, GuardrailSet, PolicyAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializePolicyArgs {
    pub agent_id:      [u8; 32],
    pub guardrail_set: GuardrailSet,
}

#[derive(Accounts)]
#[instruction(args: InitializePolicyArgs)]
pub struct InitializePolicy<'info> {
    #[account(
        init,
        payer  = authority,
        space  = PolicyAccount::LEN,
        seeds  = [PolicyAccount::SEED_PREFIX, args.agent_id.as_ref()],
        bump,
    )]
    pub policy: Account<'info, PolicyAccount>,

    #[account(
        init,
        payer = authority,
        space = AgentAccount::LEN,
        seeds = [AgentAccount::SEED_PREFIX, args.agent_id.as_ref()],
        bump,
    )]
    pub agent: Account<'info, AgentAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePolicy>, args: InitializePolicyArgs) -> Result<()> {
    let clock = Clock::get()?;

    let policy = &mut ctx.accounts.policy;
    policy.authority      = ctx.accounts.authority.key();
    policy.agent_id       = args.agent_id;
    policy.ika_dwallet_id = [0u8; 32];
    policy.guardrail_set  = args.guardrail_set;
    policy.nonce          = 0;
    policy.paused         = false;
    policy.created_at     = clock.unix_timestamp;
    policy.last_execution = 0;
    policy.bump           = ctx.bumps.policy;

    let agent = &mut ctx.accounts.agent;
    agent.policy           = policy.key();
    agent.proposal_count   = 0;
    agent.total_volume     = 0;
    agent.state_account    = Pubkey::default();
    agent.settlement_vault = Pubkey::default();
    agent.bump             = ctx.bumps.agent;

    emit!(PolicyInitialized {
        agent_id:   args.agent_id,
        authority:  ctx.accounts.authority.key(),
        created_at: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct PolicyInitialized {
    pub agent_id:   [u8; 32],
    pub authority:  Pubkey,
    pub created_at: i64,
}
