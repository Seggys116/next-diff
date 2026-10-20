import type { IncomingHttpHeaders } from "node:http";
import { Readable } from "node:stream";
import type { UpstreamResponse } from "@/lib/proxy/upstream";

// In-memory cache of live scripts, styles, images, fonts, and JSON in the dev server. Documents are never cached.

const TTL_MS = 10 * 60_000;
const MAX_ENTRY = 6_000_000;
const MAX_TOTAL = 64_000_000;

interface Entry {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  at: number;
}

const g = globalThis as unknown as { __diffAssetCache?: Map<string, Entry> };
const store = (g.__diffAssetCache ??= new Map<string, Entry>());
let total = 0;

export const cacheKey = (origin: string, pathAndQuery: string) => origin + pathAndQuery;

export function cacheGet(key: string): Entry | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    total -= hit.body.length;
    store.delete(key);
    return undefined;
  }
  // Most recently used goes to the back, so the front is what to drop first.
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** True when this response may be remembered, and is known to be small enough to hold. */
export function cacheable(up: UpstreamResponse, requested: URL): boolean {
  if (up.status !== 200 || up.url !== requested.toString()) return false;
  const type = String(up.headers["content-type"] ?? "").toLowerCase();
  if (!type || /html|event-stream|^video\/|^audio\/|mpegurl|dash\+xml/.test(type)) return false;
  const control = String(up.headers["cache-control"] ?? "").toLowerCase();
  if (/no-store|private/.test(control)) return false;
  if (/cookie|authorization/i.test(String(up.headers["vary"] ?? ""))) return false;
  const length = Number(up.headers["content-length"]);
  return Number.isFinite(length) && length > 0 && length <= MAX_ENTRY;
}

export function cachePut(key: string, up: UpstreamResponse, body: Buffer) {
  // The body is stored as it arrived; whatever encoding header came with it no longer describes it.
  const headers: IncomingHttpHeaders = { ...up.headers };
  delete headers["content-encoding"];
  delete headers["content-length"];
  delete headers["transfer-encoding"];

  const old = store.get(key);
  if (old) total -= old.body.length;
  store.set(key, { status: up.status, headers, body, at: Date.now() });
  total += body.length;
  for (const [k, v] of store) {
    if (total <= MAX_TOTAL) break;
    total -= v.body.length;
    store.delete(k);
  }
}

export function fromCache(hit: Entry, url: string): UpstreamResponse {
  return { status: hit.status, headers: hit.headers, url, stream: Readable.from([hit.body]) };
}
