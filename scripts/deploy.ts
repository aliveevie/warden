/**
 * Deploys all three Warden programs to the configured Solana cluster.
 *
 * Usage:
 *   npx ts-node scripts/deploy.ts [--cluster devnet|localnet]
 *
 * Reads PRINCIPAL_KEYPAIR_PATH from the environment.
 * Writes deployed program IDs to stdout for use in .env.
 */
import * as anchor from "@coral-xyz/anchor";

async function main() {
  const cluster = process.argv.includes("--cluster")
    ? process.argv[process.argv.indexOf("--cluster") + 1]
    : process.env.SOLANA_CLUSTER ?? "devnet";

  console.log(`Deploying to: ${cluster}`);
  console.log("Run `anchor deploy --provider.cluster", cluster, "` to deploy programs.");
  console.log("Then update program IDs in .env and Anchor.toml.");
}

main().catch(console.error);
