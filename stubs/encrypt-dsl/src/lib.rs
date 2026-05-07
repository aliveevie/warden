//! Local stub for the sponsor-provided `encrypt-dsl` proc-macro crate.
//!
//! The real `#[encrypt_fn]` macro takes a function whose arguments are
//! encrypted FHE primitives and emits both an offline graph builder and an
//! evaluator the Encrypt executor consumes. For compile-only verification
//! we replace the function with a module of the same name that exposes
//! `pub fn graph(...)` returning a `ComputationGraph`.

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, FnArg, ItemFn, Pat};

#[proc_macro_attribute]
pub fn encrypt_fn(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemFn);
    let fn_name = input.sig.ident.clone();

    // Each parameter becomes a `[u8; 32]` ciphertext handle in the graph
    // constructor — mirroring how `execute_compliance_graph.rs` calls
    // `check_guardrail_compliance::graph(handle1, handle2, …)`.
    let params: Vec<_> = input
        .sig
        .inputs
        .iter()
        .filter_map(|a| match a {
            FnArg::Typed(pt) => match &*pt.pat {
                Pat::Ident(pi) => Some(pi.ident.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect();

    let placeholders = params.iter().map(|p| {
        let p = p.clone();
        quote! { #p: [u8; 32] }
    });

    let bind_each = params.iter().map(|p| {
        let p = p.clone();
        quote! { let _ = #p; }
    });

    let expanded = quote! {
        #[allow(non_snake_case, dead_code)]
        pub mod #fn_name {
            pub fn graph(#( #placeholders ),*) -> ::encrypt_types::ComputationGraph {
                #( #bind_each )*
                ::encrypt_types::ComputationGraph::default()
            }
        }
    };

    expanded.into()
}
