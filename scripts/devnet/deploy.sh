#!/usr/bin/env bash
# Deploy warden-core to Solana devnet.
#
# Prerequisites:
#   - solana-cli installed (cargo install solana-cli)
#   - cargo-build-sbf installed
#   - ~/.config/solana/id.json keypair funded with > 5 SOL on devnet
#
# Outputs the deployed program ID and writes it to scripts/devnet/.warden-program-id.

set -euo pipefail
cd "$(dirname "$0")/../.."

PROG_DIR=programs/warden-core
SO=$PROG_DIR/target/deploy/warden_core.so
KEYPAIR=$PROG_DIR/target/deploy/warden_core-keypair.json

echo "→ Setting solana CLI to devnet..."
solana config set --url https://api.devnet.solana.com >/dev/null

echo "→ Checking payer balance (need ≥ 5 SOL on devnet)..."
solana balance

if [ ! -f "$SO" ]; then
  echo "→ Building warden_core BPF..."
  cargo-build-sbf --manifest-path "$PROG_DIR/Cargo.toml"
fi

echo "→ Deploying $SO with program keypair $KEYPAIR..."
DEPLOY_OUTPUT=$(solana program deploy --program-id "$KEYPAIR" "$SO")
echo "$DEPLOY_OUTPUT"

PROGRAM_ID=$(echo "$DEPLOY_OUTPUT" | grep -E "^Program Id:" | awk '{print $3}')
if [ -z "${PROGRAM_ID:-}" ]; then
  echo "✗ failed to parse program id from deploy output"
  exit 1
fi

echo "$PROGRAM_ID" > scripts/devnet/.warden-program-id
echo
echo "✓ Deployed warden-core to devnet"
echo "  Program ID: $PROGRAM_ID"
echo
echo "Next: export WARDEN_PROGRAM_ID=$PROGRAM_ID && bun scripts/devnet/e2e-demo.ts"
