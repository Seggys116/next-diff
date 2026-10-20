import fs from "node:fs/promises";
import { uiFile } from "./paths";

/** The only files served from the package's `dist/ui`. Anything else is a 404. */
const FILES: Record<string, string> = {
  "app.js": "text/javascript; charset=utf-8",
  "app.css": "text/css; charset=utf-8",
  "diff.worker.js": "text/javascript; charset=utf-8",
  "probe.js": "text/javascript; charset=utf-8",
};

export async function asset(name: string | undefined): Promise<Response> {
  const type = name && Object.hasOwn(FILES, name) ? FILES[name] : null;
  if (!name || !type) return new Response("Not found", { status: 404 });
  try {
    const body = await fs.readFile(uiFile(name));
    return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
