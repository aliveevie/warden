//! Local stub for the sponsor-provided `ika-dwallet-anchor` crate.
//! Mirrors the public surface used by warden-policy so the Rust types
//! line up with the real CPI shape. Real implementation lives in the Ika SDK.

use anchor_lang::prelude::*;

anchor_lang::declare_id!("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignatureScheme {
    Ed25519,
    Secp256k1,
    Secp256r1,
}

pub mod program {
    use anchor_lang::prelude::*;

    #[derive(Clone)]
    pub struct IkaDwallet;

    impl anchor_lang::Id for IkaDwallet {
        fn id() -> Pubkey {
            super::ID
        }
    }
}

pub mod cpi {
    use super::*;

    pub mod accounts {
        use anchor_lang::prelude::*;

        #[derive(Accounts)]
        pub struct ApproveMessage<'info> {
            /// CHECK: stub
            #[account(mut)]
            pub message_approval: AccountInfo<'info>,
            /// CHECK: stub
            pub dwallet: AccountInfo<'info>,
            /// CHECK: stub
            pub authority: AccountInfo<'info>,
            /// CHECK: stub
            #[account(mut)]
            pub payer: AccountInfo<'info>,
            /// CHECK: stub
            pub system_program: AccountInfo<'info>,
        }

        #[derive(Accounts)]
        pub struct TransferAuthority<'info> {
            /// CHECK: stub
            #[account(mut)]
            pub dwallet: AccountInfo<'info>,
            /// CHECK: stub
            pub current_authority: AccountInfo<'info>,
            /// CHECK: stub
            pub new_authority: AccountInfo<'info>,
            /// CHECK: stub
            pub system_program: AccountInfo<'info>,
        }
    }

    pub fn approve_message<'info>(
        _ctx: CpiContext<'_, '_, '_, 'info, accounts::ApproveMessage<'info>>,
        _message: Vec<u8>,
        _scheme: SignatureScheme,
    ) -> Result<()> {
        Ok(())
    }

    pub fn transfer_authority<'info>(
        _ctx: CpiContext<'_, '_, '_, 'info, accounts::TransferAuthority<'info>>,
    ) -> Result<()> {
        Ok(())
    }
}
