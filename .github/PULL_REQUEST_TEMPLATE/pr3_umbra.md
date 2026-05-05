# PR-3: Umbra Settlement Integration

## Scope
- [ ] `warden-settlement`: live Umbra SDK CPI (replace stubs in shield/transfer/unshield)
- [ ] `@warden/settlement`: full vault, transfer, and viewing-key implementations
- [ ] Compliance report generation (local VK decryption)
- [ ] App: audit page with viewing key management and report export
- [ ] `tests/settlement.test.ts`: all todos resolved
- [ ] `tests/e2e/full-execution-cycle.test.ts`: settlement path passing

## Checklist
- [ ] `anchor build` passes with no warnings
- [ ] Confidential transfer emits no amounts or addresses in on-chain logs
- [ ] Viewing key grant/revoke cycle works end-to-end
- [ ] Compliance report decrypts correctly against test settlement history
- [ ] All TypeScript builds pass
- [ ] `npm run typecheck` passes
- [ ] No secrets committed
