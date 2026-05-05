# PR-1: Ika + Encrypt Integration

## Scope
- [ ] `warden-policy`: full instruction implementations (replace TODOs)
- [ ] `warden-fhe-state`: live REFHE verifier CPI (replace stub in `verify_proposal`)
- [ ] `@warden/custody`: dWallet creation and co-signature request
- [ ] `@warden/fhe`: REFHE WASM prover, state encrypt/decrypt
- [ ] App: deploy wizard and monitor UI
- [ ] `tests/policy.test.ts`: all todos resolved
- [ ] `tests/fhe-state.test.ts`: all todos resolved
- [ ] `tests/e2e/full-execution-cycle.test.ts`: policy + fhe path passing

## Checklist
- [ ] `anchor build` passes with no warnings
- [ ] `anchor test --skip-local-validator` passes against devnet
- [ ] All TypeScript package builds pass (`npm run build`)
- [ ] `npm run typecheck` passes
- [ ] No secrets or keypairs committed
- [ ] `.env.example` updated with any new variables
