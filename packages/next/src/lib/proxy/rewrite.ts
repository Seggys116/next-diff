import fs from "node:fs";
import { findStartTag, MAX_TAG, scriptBlocks, startTags } from "./scan";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One compiled alternation per form (plain, escaped, protocol-relative), not one pass per origin.
function originRewriter(aliases: Iterable<string>, hostOrigin: string): (text: string) => string {
  const origins = [...aliases];
  if (!origins.length) return (text) => text;
  const alt = (xs: string[]) => xs.map(escapeRe).join("|");
  const tail = "(?![\\w-]|\\.\\w)";
  const hostNoScheme = hostOrigin.replace(/^https?:/, "");
  const escapedHost = hostOrigin.replace("//", "\\/\\/");

  const plain = new RegExp(`(?:${alt(origins)})${tail}`, "g");
  // https:\/\/example.com (JSON / JS strings)
  const escaped = new RegExp(`(?:${alt(origins.map((o) => o.replace("//", "\\/\\/")))})${tail}`, "g");
  // //example.com (protocol relative)
  const relative = new RegExp(
    `(?<=["'(=\\s,])//(?:${alt(origins.map((o) => o.replace(/^https?:\/\//, "")))})${tail}`,
    "g",
  );
  return (text) =>
    text
      .replace(plain, () => hostOrigin)
      .replace(escaped, () => escapedHost)
      .replace(relative, () => hostNoScheme);
}

export function rewriteOrigins(text: string, aliases: Iterable<string>, hostOrigin: string): string {
  return originRewriter(aliases, hostOrigin)(text);
}

// Do not rewrite __next_f script bodies: a longer origin changes T<byteLength> rows and React then reads the wrong slice.
export function rewriteHtmlOrigins(html: string, aliases: Iterable<string>, hostOrigin: string): string {
  const rewrite = originRewriter(aliases, hostOrigin);
  // Pieces are joined once at the end: repeated `out +=` on a multi-megabyte string is needlessly slow.
  const parts: string[] = [];
  let last = 0;
  for (const span of scriptBlocks(html)) {
    const block = html.slice(span.start, span.end);
    parts.push(rewrite(html.slice(last, span.start)), /__next_f/.test(block) ? block : rewrite(block));
    last = span.end;
  }
  parts.push(rewrite(html.slice(last)));
  return parts.join("");
}

let probeCache: string | null = null;
export function loadProbe(): string {
  if (probeCache && process.env.NODE_ENV === "production") return probeCache;
  // The package keeps the probe next to its own files; route.ts points DIFF_PROBE_FILE at it.
  const file = process.env.DIFF_PROBE_FILE;
  if (!file) throw new Error("diff: DIFF_PROBE_FILE is not set");
  probeCache = fs.readFileSync(file, "utf8");
  return probeCache;
}

export interface ProbeConfig {
  pane: string;
  token: string;
  target: string;
  status: number;
  /** Origin of the page that frames the preview (your own dev server), or "*" for any. */
  parent: string;
  /** The page is two frames deep (your page -> diff workspace -> preview). The probe then accepts that. */
  nested?: boolean;
}

const inlineConfig = (cfg: ProbeConfig) =>
  JSON.stringify(cfg).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");

export function injectProbe(html: string, cfg: ProbeConfig): string {
  const tag =
    `<script data-rbd>window.__RBD=${inlineConfig(cfg)};</script>` +
    `<script data-rbd>${loadProbe().replace(/<\/script/gi, "<\\/script")}</script>`;

  const head = findStartTag(html, "<head(?=[\\s>])");
  if (head) return html.slice(0, head.end) + tag + html.slice(head.end);
  const htmlTag = findStartTag(html, "<html(?=[\\s>])");
  if (htmlTag) return html.slice(0, htmlTag.end) + `<head>${tag}</head>` + html.slice(htmlTag.end);
  const doctype = findStartTag(html, "<!doctype");
  if (doctype) return html.slice(0, doctype.end) + tag + html.slice(doctype.end);
  return tag + html;
}

const BLOCKING_META = /http-equiv\s*=\s*["']?(?:content-security-policy(?:-report-only)?|refresh|x-frame-options)["']?/i;

export function sanitizeHtml(html: string): string {
  let out = "";
  let last = 0;
  for (const tag of startTags(html, "meta")) {
    if (tag.end - tag.start > MAX_TAG || !BLOCKING_META.test(html.slice(tag.start, tag.end))) continue;
    out += html.slice(last, tag.start);
    last = tag.end;
  }
  out += html.slice(last);
  return out.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/gi, "");
}

export function decodeText(buf: Buffer, contentType: string, sniff: boolean): string {
  let charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset && sniff) {
    const head = buf.subarray(0, 2048).toString("latin1");
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? undefined;
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function errorPage(opts: {
  title: string;
  message: string;
  hint?: string;
  target?: string;
  cfg?: { pane: string; token: string; parent: string };
  code?: string;
}): string {
  const payload = JSON.stringify({
    pane: opts.cfg?.pane,
    token: opts.cfg?.token,
    parent: opts.cfg?.parent || "*",
    title: opts.title,
    message: opts.message,
    hint: opts.hint,
    code: opts.code,
    target: opts.target,
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#0a0a0b;color:#e7e7ea;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:420px;padding:32px}
.dot{width:10px;height:10px;border-radius:99px;background:#f43f5e;box-shadow:0 0 0 6px rgba(244,63,94,.15);margin-bottom:20px}
h1{font-size:18px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0 0 10px;color:#a1a1aa}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d4d4d8;background:#18181b;border:1px solid #27272a;border-radius:6px;padding:2px 6px;word-break:break-all}
</style></head><body><main>
<div class="dot"></div>
<h1>${esc(opts.title)}</h1>
<p>${esc(opts.message)}</p>
${opts.hint ? `<p>${esc(opts.hint)}</p>` : ""}
${opts.target ? `<p><code>${esc(opts.target)}</code></p>` : ""}
</main>
<script>(function(){var d=${payload};if(!d.pane)return;try{parent.postMessage({rbd:1,pane:d.pane,token:d.token,type:"error",data:d},d.parent||"*")}catch(e){}})();</script>
</body></html>`;
}
