# PR-2: QVAC Sovereign AI Integration

## Scope
- [ ] `@warden/brain`: full implementation (inference, RAG, voice, context-builder)
- [ ] Execution loop wired to QVAC decision engine
- [ ] Voice command hardware confirmation flow
- [ ] RAG index seeded with protocol documentation
- [ ] App: voice command UI and brain status indicator

## Checklist
- [ ] Local LLM inference produces valid `ActionIntent` structs
- [ ] RAG retrieval returns relevant context for test queries
- [ ] Voice commands correctly map to SDK calls
- [ ] No model files committed (paths configured via `.env`)
- [ ] All TypeScript builds pass
- [ ] `npm run typecheck` passes
- [ ] No secrets committed
