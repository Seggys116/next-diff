import type { NextConfig } from "next";

export interface DiffOptions {
  /** Your production site, e.g. `https://example.com`. An origin, not a path. */
  live?: string;
}

/** Wrap your Next.js config. Outside `next dev` the config is returned unchanged and none of this package is compiled into the app. */
export function withDiff(nextConfig?: NextConfig, options?: DiffOptions): NextConfig;

export const PREFIX: "/diff-devtools";
