use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("GvseZLytX3AH4Ly5Zvr3kpsEPLhTnVSquQrEZUroeL9R");

#[program]
pub mod warden_settlement {
    use super::*;

    /// Creates the SettlementVault and registers the shielded address.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        args: InitializeVaultArgs,
    ) -> Result<()> {
        instructions::initialize_vault::handler(ctx, args)
    }

    /// Wraps a plaintext token receipt into an Umbra confidential balance.
    pub fn shield_inflow(
        ctx: Context<ShieldInflow>,
        amount: u64,
    ) -> Result<()> {
        instructions::shield_inflow::handler(ctx, amount)
    }

    /// Performs a confidential transfer from the agent vault to a counterparty.
    pub fn execute_settlement(
        ctx: Context<ExecuteSettlement>,
        args: ExecuteSettlementArgs,
    ) -> Result<()> {
        instructions::execute_settlement::handler(ctx, args)
    }

    /// Unshields balance to the principal's address using the viewing key.
    pub fn unshield_to_principal(
        ctx: Context<UnshieldToPrincipal>,
        amount: u64,
    ) -> Result<()> {
        instructions::unshield_to_principal::handler(ctx, amount)
    }

    /// Issues a scoped viewing key to an auditor or compliance officer.
    pub fn grant_viewing_key(
        ctx: Context<GrantViewingKey>,
        args: GrantViewingKeyArgs,
    ) -> Result<()> {
        instructions::grant_viewing_key::handler(ctx, args)
    }

    /// Revokes a previously issued viewing key grant.
    pub fn revoke_viewing_key(ctx: Context<RevokeViewingKey>) -> Result<()> {
        instructions::grant_viewing_key::revoke_handler(ctx)
    }
}
