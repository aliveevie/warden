use anchor_lang::prelude::*;

#[error_code]
pub enum WardenPolicyError {
    #[msg("Caller is not the policy authority")]
    Unauthorized,

    #[msg("Agent is currently paused")]
    AgentPaused,

    #[msg("Agent is not paused")]
    AgentNotPaused,

    #[msg("dWallet already bound to this agent")]
    DwalletAlreadyBound,

    #[msg("dWallet has not been bound yet")]
    DwalletNotBound,

    #[msg("Guardrail timelock has not elapsed")]
    TimelockNotElapsed,

    #[msg("No pending guardrail update exists")]
    NoPendingUpdate,

    #[msg("Proposal ID does not match the authorized nonce")]
    ProposalIdMismatch,

    #[msg("Cooldown period has not elapsed since last execution")]
    CooldownNotElapsed,

    #[msg("Ika co-authorization signature is invalid")]
    InvalidIkaCosig,

    #[msg("Agent is being wound down and does not accept new proposals")]
    AgentClosing,
}
