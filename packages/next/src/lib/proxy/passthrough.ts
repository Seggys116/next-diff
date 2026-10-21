import type { UpstreamResponse } from "./upstream";

export const DROP_RESPONSE = new Set([
  "connection", "keep-alive", "transfer-encoding", "set-cookie", // rewritten onto the preview host, not copied raw
  "content-security-policy", "content-security-policy-report-only",
  "x-frame-options", "strict-transport-security",
  "cross-origin-opener-policy", "cross-origin-embedder-policy", "cross-origin-resource-policy",
  "permissions-policy", "report-to", "nel", "refresh", "alt-svc", "public-key-pins",
  "etag", "last-modified", "cache-control", "expires", "age", "vary", "location",
  "x-powered-by", "server-timing", "content-md5", "x-robots-tag",
  // These headers can outlive one response on a localhost preview host; clear-site-data can wipe cookies.
  "clear-site-data", "reporting-endpoints", "service-worker-allowed", "accept-ch", "critical-ch",
  "document-policy", "origin-agent-cluster", "content-security-policy-report-only", "nel",
]);

// Drop routing headers such as x-middleware-rewrite; this server would obey them.
export const DROP_PREFIXES = ["x-middleware-", "x-nextjs-", "x-invoke-", "x-matched-", "x-forwarded-", "x-vercel-", "x-now-"];

export const FORWARD_REQUEST = ["user-agent", "accept", "accept-language", "range", "content-type", "if-range"];

const MAX_SET_COOKIE = 4096;

/** A live Set-Cookie made storable on the preview host: no Domain, no Secure unless __Host-/__Secure-, SameSite Lax or Strict. */
export function rewriteSetCookie(line: string): string | null {
  if (line.length > MAX_SET_COOKIE || /[\r\n]/.test(line)) return null;
  const parts = line.split(";").map((part) => part.trim()).filter(Boolean);
  const pair = parts[0];
  if (!pair) return null;
  const eq = pair.indexOf("=");
  if (eq < 1) return null;
  const name = pair.slice(0, eq).trim();
  if (!/^[\w!#$%&'*+\-.^`|~]+$/.test(name)) return null;

  const kept = [pair];
  let sameSite = "";
  for (const attr of parts.slice(1)) {
    const lower = attr.toLowerCase();
    if (lower === "secure" || lower === "partitioned" || lower.startsWith("domain=")) continue;
    if (lower.startsWith("samesite=")) {
      sameSite = lower.slice("samesite=".length).trim();
      continue;
    }
    kept.push(attr);
  }
  if (name.startsWith("__Host-") || name.startsWith("__Secure-")) kept.push("Secure");
  if (sameSite === "strict") kept.push("SameSite=Strict");
  else kept.push("SameSite=Lax");
  return kept.join("; ");
}

export const TEXTUAL =
  /^(text\/(css|javascript|plain|xml|csv)|application\/(javascript|x-javascript|ecmascript|json|xml|manifest\+json|[\w.-]+\+json|[\w.-]+\+xml)|image\/svg\+xml)/i;

// Never send 502 or 504 onward: a CDN may replace them with an unframeable error page. 503 passes through; the inspector still reports the real status.
export const BAD_GATEWAY = 503;
export const wire = (status: number) => (status === 502 || status === 504 ? BAD_GATEWAY : status);

export function filterResponseHeaders(up: UpstreamResponse, keepEncoding: boolean, into: Headers = new Headers()): Headers {
  for (const [k, v] of Object.entries(up.headers)) {
    const key = k.toLowerCase();
    if (DROP_RESPONSE.has(key) || v == null || DROP_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (key === "link" || key === "content-location") continue;
    if (!keepEncoding && (key === "content-length" || key === "content-encoding")) continue;
    into.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return into;
}

// Apply the browser path by concatenation, never URL resolution, so //other.host cannot leave the pinned origin.
export function targetFor(rawPath: string | null, origin: string): URL | null {
  const path = rawPath && rawPath.startsWith("/") ? rawPath : "/";
  try {
    const url = new URL(origin + path);
    return url.origin === new URL(origin).origin ? url : null;
  } catch {
    return null;
  }
}
