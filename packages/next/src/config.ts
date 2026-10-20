import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { NextConfig } from "next";
import { PREFIX } from "./prefix";

export { PREFIX };

type Rewrite = { source: string; destination: string; has?: { type: "host"; value: string }[] };
type Rewrites = Awaited<ReturnType<NonNullable<NextConfig["rewrites"]>>>;

export interface DiffOptions {
  /** Your production site, e.g. `https://example.com`. An origin, not a path. */
  live?: string;
}

const g = globalThis as { __diffDevPort?: Promise<number> };

function devPort(live?: string): Promise<number> {
  g.__diffDevPort ??= (async () => {
    const require = createRequire(import.meta.url);
    const file = pathToFileURL(require.resolve("./dev-server.js")).href;
    const started = (await import(file)) as { listen: (live?: string) => Promise<number> };
    return started.listen(live);
  })();
  return g.__diffDevPort;
}

/** In `next dev`, serve the viewer from this package. `next build` gets the config back unchanged. */
export function withDiff(nextConfig: NextConfig = {}, options: DiffOptions = {}): NextConfig {
  if (process.env.NODE_ENV === "production") return nextConfig;

  const port = devPort(options.live);
  return {
    ...nextConfig,
    instrumentationClientInject: [...(nextConfig.instrumentationClientInject ?? []), "@seggy116/next-diff/instrument"],
    async rewrites(): Promise<Rewrites> {
      const p = await port;
      const preview: Rewrite = {
        source: "/:path*",
        has: [{ type: "host", value: "rbd-[a-z0-9]+\\.localhost" }],
        destination: `http://127.0.0.1:${p}/:path*`,
      };
      const tools: Rewrite = {
        source: `${PREFIX}/:path*`,
        destination: `http://127.0.0.1:${p}${PREFIX}/:path*`,
      };
      const theirs = await nextConfig.rewrites?.();
      // Ours go first: a request for a preview host is never one of your pages.
      if (!theirs) return { beforeFiles: [preview, tools], afterFiles: [], fallback: [] };
      if (Array.isArray(theirs)) return { beforeFiles: [preview, tools], afterFiles: theirs, fallback: [] };
      return { ...theirs, beforeFiles: [preview, tools, ...(theirs.beforeFiles ?? [])] };
    },
  };
}
