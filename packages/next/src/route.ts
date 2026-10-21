import { createSession, releaseSession } from "@/lib/proxy/sessions";
import { PREFIX } from "./prefix";
import { asset } from "./server/assets";
import { uiFile } from "./server/paths";
import { isLoopbackHost } from "./server/hosts";
import { forgetParent, rememberParent } from "./server/parents";
import { handleProxy } from "./server/proxy";
import { history, repoInfo } from "./server/git/repo";
import { currentRevision, ensureRevision, isStartFailure, revisionOrigin, stopRevision } from "./server/git/revision";
import { shellHtml, type ShellConfig } from "./server/shell";

export interface DiffConfig {
  /** Your production site, e.g. `https://example.com`. */
  live?: string;
}

interface Resolved {
  environments: ShellConfig["environments"];
}

function resolve(config: DiffConfig): Resolved {
  const environments: Resolved["environments"] = [];
  if (config.live) {
    let url: URL;
    try {
      url = new URL(config.live);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error(`diff: \`live\` must be a full http(s) address such as https://example.com (got ${JSON.stringify(config.live)}).`);
    }
    environments.push({ id: "live", label: "Live", hint: `Your production site · ${url.host}`, origin: url.origin });
  }
  return { environments };
}

const NO_STORE = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });

/** Only a loopback page of yours may talk to the session endpoint: not another site, and not a rebinding trick. */
function sameSiteCaller(request: Request): boolean {
  if (!isLoopbackHost(request.headers.get("host") || new URL(request.url).host)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  // A header a plain cross-site form or <img> can't set: browsers preflight it.
  return request.headers.get("x-diff-devtools") === "1";
}

async function session(request: Request, cfg: Resolved): Promise<Response> {
  if (!sameSiteCaller(request)) return json({ error: "Not allowed" }, 403);

  if (request.method === "DELETE") {
    try {
      const { label } = (await request.json()) as { label?: string };
      if (typeof label === "string" && label.length <= 80) {
        releaseSession(label);
        forgetParent(label);
      }
    } catch {}
    return new Response(null, { status: 204, headers: NO_STORE });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { url?: string; pane?: string; token?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  let url: URL;
  try {
    url = new URL(String(payload.url).slice(0, 2048));
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  // The proxy only ever fetches what you configured, plus the past version this dev server is itself serving. Nothing typed into the page can point it anywhere else.
  if (!cfg.environments.some((e) => e.origin === url.origin) && url.origin !== revisionOrigin()) {
    return json({ error: `${url.origin} isn’t one of the sites in your diff config.` }, 400);
  }
  const token = String(payload.token ?? "").slice(0, 64);
  if (!token) return json({ error: "Missing token" }, 400);

  const created = createSession(url.origin, payload.pane === "b" ? "b" : "a", token);
  rememberParent(created.label, request.headers.get("origin") ?? new URL(request.url).origin);
  return json({ label: created.label, path: url.pathname + url.search + url.hash });
}

async function git(request: Request, rest: string[]): Promise<Response> {
  if (!sameSiteCaller(request)) return json({ error: "Not allowed" }, 403);
  const info = await repoInfo();
  if (!info) return json({ error: "This project isn’t in a Git repository." }, 404);

  if (rest.length === 0 && request.method === "GET") return json(await history(info));
  if (rest.length === 1 && rest[0] === "revision") {
    if (request.method === "GET") return json(currentRevision());
    if (request.method === "DELETE") {
      // Stopping takes a moment (the server has to exit); the caller is usually a closing page that won't wait.
      void stopRevision();
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    if (request.method === "POST") {
      let sha: unknown;
      try {
        ({ sha } = (await request.json()) as { sha?: unknown });
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      try {
        return json(await ensureRevision(info, String(sha)));
      } catch (err) {
        if (isStartFailure(err)) return json({ error: err.message }, 400);
        throw err;
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }
  return notFound();
}

/** Only a path on this site: `/x`, never `//other.host` or a full address. */
const safePath = (p: string | null) => (p && /^\/(?!\/|\\)/.test(p) ? p.slice(0, 2048) : "/");

export function diffRoute(config: DiffConfig) {
  const cfg = resolve(config);

  const handle = async (request: Request, ctx: { params: Promise<{ path?: string[] }> | { path?: string[] } }): Promise<Response> => {
    // The app's own Next.js runs this. In a production build it answers nothing.
    if (process.env.NODE_ENV === "production") return notFound();
    // The injected inspector is read from this package, not from your project.
    process.env.DIFF_PROBE_FILE ||= uiFile("probe.js");
    const params = await Promise.resolve(ctx.params ?? {});
    const [head, ...rest] = params.path ?? [];

    // The live site, seen through a preview host (see `withDiff`).
    if (head === "p") return handleProxy(request);

    // Everything else is for your own pages only.
    if (!isLoopbackHost(request.headers.get("host") || new URL(request.url).host)) return notFound();

    if (head === "assets") return asset(rest[0]);
    if (head === "session") return session(request, cfg);
    if (head === "git") return git(request, rest);
    if (head === "ui" && request.method === "GET") {
      const search = new URL(request.url).searchParams;
      const shell: ShellConfig = {
        prefix: PREFIX,
        environments: cfg.environments,
        path: safePath(search.get("path")),
        handoff: search.get("handoff") === "1",
        git: (await repoInfo()) !== null,
      };
      return new Response(shellHtml(shell), { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
    }
    return notFound();
  };

  return { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle, HEAD: handle, OPTIONS: handle };
}
