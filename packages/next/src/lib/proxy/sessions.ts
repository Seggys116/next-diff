// In-memory only: origin, label, and token. Never paths, cookies, headers, or page content. Dropped when idle, released, or the process exits.

export const LABEL_PREFIX = "rbd-";
const IDLE_MS = 20 * 60 * 1000;
/** However busy, no preview outlives this. */
const ABSOLUTE_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;
/** Origins a session may rewrite. A site legitimately hops between a handful (apex, www, locale). */
const MAX_ORIGINS = 6;

export interface ProxySession {
  label: string;
  pane: string;
  token: string;
  origin: string;
  aliases: Set<string>;
  used: number;
  inflight: number;
  created: number;
}

type Store = Map<string, ProxySession>;
const g = globalThis as unknown as { __diffSessions?: Store };
const store: Store = (g.__diffSessions ??= new Map());

function expired(s: ProxySession, now: number): boolean {
  return s.used < now - IDLE_MS || now - s.created > ABSOLUTE_MS;
}

function sweep() {
  const now = Date.now();
  for (const [label, s] of store) {
    if (expired(s, now)) store.delete(label);
  }
  // Over the cap: drop the least recently used.
  if (store.size > MAX_SESSIONS) {
    const oldest = [...store.values()].sort((a, b) => a.used - b.used);
    for (const s of oldest.slice(0, store.size - MAX_SESSIONS)) store.delete(s.label);
  }
}

// A quiet server must still forget idle sessions on time, not only when the next request arrives.
const gs = globalThis as unknown as { __diffSessionTimer?: ReturnType<typeof setInterval> };
gs.__diffSessionTimer ??= setInterval(sweep, 15_000);
gs.__diffSessionTimer.unref?.();

function aliasesFor(origin: string): string[] {
  try {
    const u = new URL(origin);
    return [`http://${u.host}`, `https://${u.host}`];
  } catch {
    return [origin];
  }
}

function randomLabel() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return LABEL_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The preview host for this pane and site, reused so its cookies and storage survive navigations. */
export function openSession(origin: string, pane: string, token: string): ProxySession {
  sweep();
  const now = Date.now();
  for (const s of store.values()) {
    if (s.pane === pane && s.origin === origin && !expired(s, now)) {
      s.token = token;
      s.used = now;
      return s;
    }
  }
  return createSession(origin, pane, token);
}

export function createSession(origin: string, pane: string, token: string): ProxySession {
  sweep();
  const label = randomLabel();
  const now = Date.now();
  const session: ProxySession = {
    label,
    pane,
    token,
    origin,
    aliases: new Set(aliasesFor(origin)),
    used: now,
    inflight: 0,
    created: now,
  };
  store.set(label, session);
  return session;
}

export function getSession(label: string): ProxySession | undefined {
  sweep();
  const s = store.get(label);
  if (s) s.used = Date.now();
  return s;
}

export function releaseSession(label: string) {
  store.delete(label);
}

export function adoptOrigin(session: ProxySession, origin: string) {
  session.origin = origin;
  // Cap remembered origins: each one is scanned for in every response, and redirects can mint new subdomains forever.
  for (const a of aliasesFor(origin)) {
    session.aliases.delete(a);
    session.aliases.add(a);
  }
  while (session.aliases.size > MAX_ORIGINS * 2) {
    const oldest = session.aliases.values().next().value as string;
    session.aliases.delete(oldest);
  }
}
