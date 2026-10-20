// Stands in for the "live" site while trying the playground: the same pages, as they were before your changes.
import http from "node:http";

const nav = `<nav style="display:flex;gap:16px;padding:16px 24px;border-bottom:1px solid #eee"><a href="/">Home</a><a href="/about">About</a></nav>`;
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Playground</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
<body style="margin:0;font-family:system-ui,sans-serif;color:#111;background:#fff">${nav}${body}</body></html>`;

const routes = {
  "/": page(`
<section style="min-height:100vh;display:grid;place-items:center;background:linear-gradient(160deg,#f0fdf4,#dcfce7);text-align:center;padding:24px">
  <div style="max-width:640px">
    <h1 style="font-size:52px;margin:0">Playground (live)</h1>
    <p style="font-size:18px;color:#334155">This is the version you are working on.</p>
    <button style="padding:12px 22px;background:#16a34a;color:#fff;border:0;border-radius:10px;font-size:16px">Sign up</button>
  </div>
</section>
<section style="padding:64px 24px;max-width:720px;margin:0 auto"><h2>What's new</h2><p>Scroll position should carry over into the viewer.</p></section>`),
  "/about": page(`<main style="padding:24px;max-width:720px"><h1>About us</h1><p>We build small things.</p></main>`),
};

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16a34a"/><path d="M9 17l5 5 9-12" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

http
  .createServer((req, res) => {
    if (new URL(req.url, "http://x").pathname === "/favicon.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=600", "content-length": Buffer.byteLength(ICON) });
      return res.end(ICON);
    }
    const html = routes[new URL(req.url, "http://x").pathname];
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(html ?? page("<main style='padding:24px'>Not found</main>"));
  })
  .listen(3100, () => console.log("live stand-in on http://localhost:3100"));
