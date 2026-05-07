//! Local stub for `encrypt-anchor`. Mirrors the public surface used by
//! warden-fhe-state: program marker, `EncryptCpi` trait, CPI accounts and
//! free functions for `execute_graph` and `read_ciphertext`. Real crate is
//! shipped by the Encrypt sponsor SDK.

use anchor_lang::prelude::*;
pub use encrypt_types as types;
pub use encrypt_types::{ComputationGraph, EBool, EUint64};

anchor_lang::declare_id!("4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8");

/// Marker trait for CPI users — re-exported by the real crate.
pub trait EncryptCpi {}

pub mod program {
    use anchor_lang::prelude::*;

    #[derive(Clone)]
    pub struct Encrypt;

    impl anchor_lang::Id for Encrypt {
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
        pub struct ExecuteGraph<'info> {
            /// CHECK: stub
            #[account(mut)]
            pub output_ciphertext: AccountInfo<'info>,
            /// CHECK: stub
            #[account(mut)]
            pub payer: AccountInfo<'info>,
            /// CHECK: stub
            pub system_program: AccountInfo<'info>,
        }

        #[derive(Accounts)]
        pub struct ReadCiphertext<'info> {
            /// CHECK: stub
            pub ciphertext: AccountInfo<'info>,
        }
    }

    pub fn execute_graph<'info>(
        _ctx: CpiContext<'_, '_, '_, 'info, accounts::ExecuteGraph<'info>>,
        _graph: ComputationGraph,
    ) -> Result<()> {
        Ok(())
    }

    pub fn read_ciphertext<'info>(
        _ctx: CpiContext<'_, '_, '_, 'info, accounts::ReadCiphertext<'info>>,
    ) -> Result<EBool> {
        Ok(EBool::default())
    }
}
