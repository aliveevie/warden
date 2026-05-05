/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SOLANA_CLUSTER:                process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    NEXT_PUBLIC_WARDEN_POLICY_PROGRAM_ID:      process.env.NEXT_PUBLIC_WARDEN_POLICY_PROGRAM_ID,
    NEXT_PUBLIC_WARDEN_FHE_STATE_PROGRAM_ID:   process.env.NEXT_PUBLIC_WARDEN_FHE_STATE_PROGRAM_ID,
    NEXT_PUBLIC_WARDEN_SETTLEMENT_PROGRAM_ID:  process.env.NEXT_PUBLIC_WARDEN_SETTLEMENT_PROGRAM_ID,
  },
};

module.exports = nextConfig;
