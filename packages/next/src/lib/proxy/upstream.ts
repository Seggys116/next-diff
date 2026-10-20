import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { isBlockedIp, isLocalHost, isRecognizedIp } from "@/lib/url";

// Reuse connections: a fresh TLS handshake per asset is most of the pass-through latency.
const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 32 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 32 }),
};

export interface UpstreamResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  url: string;
  stream: Readable;
}

// Cookies set mid-redirect live only for this request, and go back only to the host that set them.
type Jar = Map<string, { host: string; value: string }>;

function collectCookies(jar: Jar, res: IncomingMessage, from: URL) {
  const raw = res.headers["set-cookie"];
  if (!raw) return;
  const host = from.hostname.toLowerCase();
  for (const line of raw) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const key = `${host}\u0000${name}`;
    if (/expires=.*1970|max-age=0/i.test(line)) jar.delete(key);
    else if (jar.size < 64) jar.set(key, { host, value });
  }
}

function cookieHeader(jar: Jar, to: URL): string | undefined {
  const host = to.hostname.toLowerCase();
  const pairs: string[] = [];
  for (const [key, c] of jar) if (c.host === host) pairs.push(`${key.slice(host.length + 1)}=${c.value}`);
  return pairs.length ? pairs.join("; ") : undefined;
}

export interface UpstreamOptions {
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  followRedirects: boolean;
  timeoutMs?: number;
  /** The configured origin is already on a private host, so redirects may stay there. */
  allowPrivate?: boolean;
}

const MAX_HOPS = 8;

function pinnedLookup(allowPrivate: boolean): NonNullable<http.RequestOptions["lookup"]> {
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const all = typeof options === "object" && options.all === true;
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses.length) {
        cb(err ?? Object.assign(new Error("Could not resolve that host"), { code: "ENOTFOUND" }), "");
        return;
      }
      if (!allowPrivate && addresses.some((a) => !isRecognizedIp(a.address) || isBlockedIp(a.address))) {
        cb(Object.assign(new Error("Refusing a non-public address"), { code: "EBLOCKED" }), "");
        return;
      }
      if (all) (cb as (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(null, addresses);
      else cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

function once(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  timeout: number,
  allowPrivate: boolean,
): Promise<IncomingMessage> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return Promise.reject(new Error("Only http and https addresses can be previewed."));
  }
  if (target.username || target.password) {
    return Promise.reject(new Error("Refusing an address with a username or password."));
  }
  if (!allowPrivate && isBlockedIp(target.hostname)) {
    return Promise.reject(new Error("Refusing a non-public address"));
  }

  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      target,
      {
        method,
        headers,
        timeout,
        agent: isHttps ? agents.https : agents.http,
        maxHeaderSize: 64 * 1024,
        lookup: pinnedLookup(allowPrivate),
        // Local dev servers frequently use self-signed certificates.
        ...(isHttps && isLocalHost(target.hostname) ? { rejectUnauthorized: false } : {}),
      } as http.RequestOptions,
      resolve,
    );
    req.on("timeout", () => req.destroy(new Error("Upstream timed out")));
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

export async function upstreamRequest(url: string, opts: UpstreamOptions): Promise<UpstreamResponse> {
  let current = new URL(url);
  let method = opts.method;
  let body = opts.body;
  const jar: Jar = new Map();

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const headers: Record<string, string> = { ...opts.headers, host: current.host };
    const cookie = cookieHeader(jar, current);
    if (cookie) headers["cookie"] = cookie;
    else delete headers["cookie"];
    if (body && body.length) headers["content-length"] = String(body.length);
    else delete headers["content-length"];

    const res = await once(current, method, headers, body, opts.timeoutMs ?? 25_000, opts.allowPrivate === true);
    const status = res.statusCode ?? 502;
    const location = res.headers.location;
    if (opts.followRedirects) collectCookies(jar, res, current);

    if (opts.followRedirects && status >= 300 && status < 400 && location) {
      res.resume();
      current = new URL(location, current);
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { status, headers: res.headers, url: current.toString(), stream: res };
  }
  throw new Error("Too many redirects");
}

function decodedSource(res: UpstreamResponse): NodeJS.ReadableStream {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.stream.pipe(zlib.createGunzip());
  if (enc === "deflate") return res.stream.pipe(zlib.createInflate());
  if (enc === "br") return res.stream.pipe(zlib.createBrotliDecompress());
  return res.stream;
}

// Read until stop matches or limit bytes, then tear the socket down so a head fetch does not pull the document.
export async function readUntil(res: UpstreamResponse, stop: RegExp, limit = 400_000): Promise<Buffer> {
  const source = decodedSource(res);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      size += buf.length;
      if (size >= limit) break;
      const m = stop.exec(Buffer.concat(chunks).toString("latin1"));
      if (m) return Buffer.concat(chunks).subarray(0, m.index + m[0].length);
    }
  } finally {
    res.stream.destroy();
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

const BODY_LIMIT = 25_000_000;

export async function readBody(res: UpstreamResponse, limit = BODY_LIMIT): Promise<Buffer> {
  const source = decodedSource(res);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      res.stream.destroy();
      throw new Error("Response too large to preview");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function toWebStream(res: UpstreamResponse): ReadableStream<Uint8Array> {
  return Readable.toWeb(res.stream) as unknown as ReadableStream<Uint8Array>;
}
