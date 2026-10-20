function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return parts.every((n) => n <= 255) ? parts : null;
}

function expandIpv6(ip: string): number[] | null {
  if (ip.includes(".")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/** True for loopback, private, link-local, and metadata addresses. A name returns false. */
export function isBlockedIp(address: string): boolean {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) ip = mapped[1];
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const v6 = expandIpv6(ip);
  if (!v6) return false;
  if (v6.every((n) => n === 0) || (v6.slice(0, 7).every((n) => n === 0) && v6[7] === 1)) return true;
  const first = v6[0];
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

export function isRecognizedIp(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return true;
  return ipv4Parts(ip) !== null || expandIpv6(ip) !== null;
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  return isBlockedIp(h);
}

export interface NormalizedUrl {
  ok: boolean;
  url: string;
  display: string;
  local: boolean;
  error?: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// A bare port becomes http://localhost; localhost stays http; any other host becomes https; an existing scheme is left alone.
export function normalizeUrl(raw: string): NormalizedUrl {
  const fail = (error: string): NormalizedUrl => ({
    ok: false,
    url: "",
    display: raw.trim(),
    local: false,
    error,
  });

  let input = raw.trim();
  if (!input) return fail("Enter a URL");
  if (/\s/.test(input)) return fail("URLs can’t contain spaces");

  if (/^:?\d{2,5}(\/.*)?$/.test(input)) {
    input = `localhost${input.startsWith(":") ? "" : ":"}${input}`;
  }

  let candidate = input;
  if (!SCHEME.test(input)) {
    const host = input.split(/[/?#]/)[0].replace(/:\d+$/, "");
    const scheme = isLocalHost(host) ? "http" : "https";
    candidate = `${scheme}://${input}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fail("That doesn’t look like a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("Only http and https URLs are supported");
  }

  const host = parsed.hostname;
  const local = isLocalHost(host);
  const looksReal =
    local || host.includes(".") || /^\[.*\]$/.test(host) || host === "localhost";
  if (!looksReal) return fail("That host doesn’t look right");

  const display =
    parsed.host +
    (parsed.pathname === "/" ? "" : parsed.pathname) +
    parsed.search;

  return { ok: true, url: parsed.toString(), display, local };
}

export function mirrorPath(from: string, onto: string): string | null {
  try {
    const f = new URL(from);
    const o = new URL(onto);
    return `${o.origin}${f.pathname}${f.search}`;
  } catch {
    return null;
  }
}

export function pathKey(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "") + u.search;
  } catch {
    return url;
  }
}
