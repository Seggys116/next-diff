const stripPort = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

export function previewLabel(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const m = /^(rbd-[a-z0-9]{8,64})\.localhost$/.exec(stripPort(hostHeader));
  return m ? m[1] : null;
}

/** True when the Host header is a loopback name (your site, or a preview of another). */
export function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = stripPort(hostHeader);
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}
