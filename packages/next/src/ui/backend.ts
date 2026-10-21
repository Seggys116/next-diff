import type { PaneBackend } from "@/components/diff/backend";
import type { GitApi } from "@/components/diff/devtools";
import type { GitHistory, RevisionStatus } from "@/lib/git/types";

// Same-origin pages are framed as-is, with pane id and token in the frame name; every other origin is registered with the pass-through.
export function createBackend(prefix: string): PaneBackend {
  return {
    async start(url, pane, token) {
      const target = new URL(url);

      if (target.origin === location.origin) {
        return { src: url, origin: location.origin, name: `diff:${pane}:${token}` };
      }

      const res = await fetch(`${prefix}/session`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-diff-devtools": "1" },
        body: JSON.stringify({ url, pane, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Couldn’t start the preview");
      }
      const { label, path } = (await res.json()) as { label: string; path: string };
      const origin = `${location.protocol}//${label}.localhost${location.port ? `:${location.port}` : ""}`;
      return {
        src: origin + path,
        origin,
        release() {
          fetch(`${prefix}/session`, {
            method: "DELETE",
            headers: { "content-type": "application/json", "x-diff-devtools": "1" },
            body: JSON.stringify({ label }),
            keepalive: true,
          }).catch(() => {});
        },
      };
    },
  };
}

const HEADERS = { "content-type": "application/json", "x-diff-devtools": "1" };

export function createGitApi(prefix: string): GitApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${prefix}/git${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    if (!res.ok) {
      const failure = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(failure?.error || "Couldn’t reach the Git history");
    }
    return (await res.json()) as T;
  };
  return {
    history: () => call<GitHistory>("GET", ""),
    start: (sha) => call<RevisionStatus>("POST", "/revision", { sha }),
    poll: () => call<RevisionStatus | null>("GET", "/revision"),
    stop() {
      fetch(`${prefix}/git/revision`, { method: "DELETE", headers: HEADERS, keepalive: true }).catch(() => {});
    },
  };
}
