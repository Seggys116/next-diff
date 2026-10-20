import http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { diffRoute } from "./route";
import { previewLabel } from "./server/hosts";
import { PREFIX } from "./prefix";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function readIncoming(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function listen(live?: string): Promise<number> {
  const handlers = diffRoute({ live });
  const server = http.createServer(async (req, res) => {
    try {
      const forwarded = first(req.headers["x-forwarded-host"]);
      const host = forwarded || first(req.headers.host) || "localhost";
      const proto = first(req.headers["x-forwarded-proto"]) || "http";
      const url = `${proto}://${host}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null || key === "host" || key === "transfer-encoding") continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const method = (req.method || "GET").toUpperCase();
      const hasBody = method !== "GET" && method !== "HEAD";
      const body = hasBody ? await readIncoming(req) : undefined;
      const request = new Request(url, { method, headers, body: body?.length ? new Uint8Array(body) : undefined });
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const path = previewLabel(host) ? ["p"] : parts[0] === PREFIX.slice(1) ? parts.slice(1) : [];
      const handler = handlers[method as keyof typeof handlers] ?? handlers.GET;
      const response = await handler(request, { params: Promise.resolve({ path }) });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key === "transfer-encoding" || key === "content-encoding") return;
        res.setHeader(key, value);
      });
      if (!response.body) {
        res.end();
        return;
      }
      Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("diff dev server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("diff dev server did not bind"));
    });
  });
}
