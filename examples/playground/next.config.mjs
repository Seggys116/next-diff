import { withDiff } from "@seggy116/next-diff";

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
};

export default withDiff(nextConfig, {
  live: process.env.DIFF_LIVE_URL ?? "http://localhost:3100",
});
