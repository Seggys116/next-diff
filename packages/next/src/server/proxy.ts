import { readLimited } from "@/lib/proxy/body";
import { BAD_GATEWAY, FORWARD_REQUEST, filterResponseHeaders, TEXTUAL, targetFor, wire } from "@/lib/proxy/passthrough";
import { decodeText, errorPage, injectProbe, rewriteHtmlOrigins, rewriteOrigins, sanitizeHtml } from "@/lib/proxy/rewrite";
import { adoptOrigin, getSession, type ProxySession } from "@/lib/proxy/sessions";
import { readBody, toWebStream, upstreamRequest, type UpstreamResponse } from "@/lib/proxy/upstream";
import { isLocalHost } from "@/lib/url";
import { previewLabel } from "./hosts";
import { cacheable, cacheGet, cacheKey, cachePut, fromCache } from "./cache";
import { parentFor } from "./parents";

// Forward the one configured origin for this preview host, strip framing blocks, rewrite that origin, and inject the inspector. Dev only; nothing is stored.

const MAX_REQUEST_BODY = 100_000_000;

type Info = { title: string; message: string; hint?: string; code?: string };

function describe(err: unknown): Info {
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = e.code ?? e.cause?.code;
  if (code === "ECONNREFUSED") {
    return { title: "Connection refused", message: "Nothing is listening at that address.", hint: "Check the address in your diff config, and that the site is up.", code };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { title: "Couldn’t find that host", message: "The domain name didn’t resolve.", hint: "Check the address in your diff config, and your network connection.", code };
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || /timed out/i.test(String(e.message))) {
    return { title: "The site didn’t respond", message: "The connection timed out or was reset.", code };
  }
  if (/certificate|SSL|TLS|EPROTO/i.test(String(e.message ?? code ?? ""))) {
    return { title: "Secure connection failed", message: "The site’s TLS handshake failed.", hint: "If it’s a local site, try the http:// address instead.", code };
  }
  if (/too large/i.test(String(e.message))) {
    return { title: "That page is too large to preview", message: "The response was bigger than the preview allows.", code };
  }
  return { title: "Couldn’t load that page", message: e.message || "Unknown error", code };
}

function baseHeaders(parent: string, h: Headers = new Headers()): Headers {
  h.set("cache-control", "no-store");
  // Only the viewer (your own site) may frame a preview.
  h.set("content-security-policy", `frame-ancestors 'self' ${parent}`);
  h.set("x-robots-tag", "noindex, nofollow");
  return h;
}

function plain(parent: string, message: string, status: number) {
  const h = baseHeaders(parent);
  h.set("content-type", "text/plain; charset=utf-8");
  return new Response(message, { status, headers: h });
}

function htmlResponse(parent: string, html: string, status: number) {
  const h = baseHeaders(parent);
  h.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status, headers: h });
}

// withDiff rewrites onto this route, so the path the browser asked for is the original request URL, not Next's route path.
function requestedPath(request: Request): string {
  const u = new URL(request.url);
  return u.pathname + u.search;
}

function requestHeaders(request: Request, session: ProxySession, hasBody: boolean) {
  const out: Record<string, string> = {};
  for (const name of FORWARD_REQUEST) {
    const v = request.headers.get(name);
    if (v) out[name] = v;
  }
  out["accept-encoding"] = "identity";
  out["referer"] = session.origin + "/";
  if (hasBody || request.headers.get("origin")) out["origin"] = session.origin;
  return out;
}

export async function handleProxy(request: Request): Promise<Response> {
  const hostHeader = request.headers.get("host") || new URL(request.url).host;
  const label = previewLabel(hostHeader);
  const session = label ? getSession(label) : undefined;
  const parent = (label && parentFor(label)) || "http://localhost:*";
  if (!session || !hostHeader || !label) return plain(parent, "This preview session has ended. Reload the diff.", 404);

  const dest = request.headers.get("sec-fetch-dest") ?? "";
  // Refuse a service-worker script: a page can sidestep the inspector's registration block, and the worker would outlive the preview.
  if (request.headers.has("service-worker") || dest === "serviceworker" || dest === "sharedworker") {
    return plain(parent, "Service workers are disabled in diff previews.", 403);
  }

  const isDoc = ["iframe", "document", "frame"].includes(dest) || (!dest && (request.headers.get("accept") ?? "").includes("text/html"));
  const hostOrigin = `${new URL(parent.replaceAll("*", "0")).protocol}//${hostHeader}`;
  const method = request.method.toUpperCase();

  const target = targetFor(requestedPath(request), session.origin);
  if (!target) return plain(parent, "Bad URL", 400);

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const read = await readLimited(request, MAX_REQUEST_BODY);
    if (!read) return plain(parent, "The request was too large to send.", 413);
    body = read;
  }

  session.inflight++;
  try {
    return await serve(request, session, { target, body, method, isDoc, hostOrigin, parent });
  } finally {
    session.inflight = Math.max(0, session.inflight - 1);
  }
}

async function serve(
  request: Request,
  session: ProxySession,
  ctx: { target: URL; body?: Buffer; method: string; isDoc: boolean; hostOrigin: string; parent: string },
): Promise<Response> {
  const { target, body, method, isDoc, hostOrigin, parent } = ctx;
  const cfg = { pane: session.pane, token: session.token, parent };

  let up: UpstreamResponse;
  try {
    // Assets from the live site are remembered (see ./cache.ts); documents never are.
    const key = method === "GET" && !isDoc && !request.headers.has("range") ? cacheKey(session.origin, target.pathname + target.search) : null;
    const hit = key ? cacheGet(key) : undefined;
    if (hit) {
      up = fromCache(hit, target.toString());
    } else {
      up = await upstreamRequest(target.toString(), {
        method,
        headers: requestHeaders(request, session, !!body),
        body,
        followRedirects: true,
        allowPrivate: isLocalHost(new URL(session.origin).hostname),
      });
      if (key && cacheable(up, target)) {
        const bytes = await readBody(up, 6_000_000);
        cachePut(key, up, bytes);
        up = fromCache(cacheGet(key)!, target.toString());
      }
    }
  } catch (err) {
    const info = describe(err);
    if (!isDoc) return plain(parent, info.message, BAD_GATEWAY);
    return htmlResponse(parent, errorPage({ ...info, target: target.toString(), cfg }), BAD_GATEWAY);
  }
  request.signal.addEventListener("abort", () => up.stream.destroy(), { once: true });

  // Redirects were followed here, so send one redirect back and keep the iframe location on the real path.
  if (isDoc && up.status < 300) {
    const final = new URL(up.url);
    if (final.origin !== target.origin || final.pathname + final.search !== target.pathname + target.search) {
      up.stream.resume();
      if (final.origin !== session.origin) {
        const startedLocal = isLocalHost(new URL(session.origin).hostname);
        if (!startedLocal && isLocalHost(final.hostname)) {
          return htmlResponse(parent, errorPage({ title: "That redirect was blocked", message: "The live site redirected to a private address.", target: final.toString(), cfg }), BAD_GATEWAY);
        }
        adoptOrigin(session, final.origin);
      }
      const h = baseHeaders(parent);
      h.set("location", `${hostOrigin}${final.pathname}${final.search}`);
      return new Response(null, { status: 302, headers: h });
    }
  }

  const contentType = String(up.headers["content-type"] ?? "");
  const headers = (keepEncoding: boolean) => baseHeaders(parent, filterResponseHeaders(up, keepEncoding));

  if (method === "HEAD" || up.status === 204 || up.status === 304) {
    up.stream.resume();
    return new Response(null, { status: wire(up.status), headers: headers(true) });
  }

  // An error with no page behind it would make the browser show its own blank "couldn't load".
  if (isDoc && up.status >= 400 && !/html|text\/plain/i.test(contentType)) {
    up.stream.resume();
    return htmlResponse(
      parent,
      errorPage({
        title: `The site answered with ${up.status}`,
        message:
          up.status === 401 || up.status === 403
            ? "It refused the request, which usually means a login or bot protection."
            : up.status === 404
              ? "That page doesn’t exist on the site."
              : "The server returned an error and no page.",
        target: target.toString(),
        cfg,
      }),
      wire(up.status),
    );
  }

  try {
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      let html = decodeText(await readBody(up), contentType, true);
      html = rewriteHtmlOrigins(sanitizeHtml(html), session.aliases, hostOrigin);
      html = injectProbe(html, {
        pane: session.pane,
        token: session.token,
        target: session.origin,
        status: up.status, // the site's real status: the viewer shows it, whatever travels over the wire
        parent,
        nested: true,
      });
      const h = headers(false);
      h.set("content-type", "text/html; charset=utf-8");
      return new Response(html, { status: wire(up.status), headers: h });
    }

    if (TEXTUAL.test(contentType)) {
      const text = rewriteOrigins(decodeText(await readBody(up), contentType, false), session.aliases, hostOrigin);
      const h = headers(false);
      if (!/charset/i.test(contentType)) h.set("content-type", `${contentType.split(";")[0]}; charset=utf-8`);
      return new Response(text, { status: wire(up.status), headers: h });
    }

    if (isDoc && /^image\//i.test(contentType)) {
      up.stream.resume();
      return htmlResponse(parent, errorPage({ title: "That’s an image, not a page", message: "Point at an HTML page to compare.", target: target.toString(), cfg }), 415);
    }

    return new Response(toWebStream(up), { status: wire(up.status), headers: headers(true) });
  } catch (err) {
    up.stream.destroy();
    return plain(parent, describe(err).message, BAD_GATEWAY);
  }
}
