import { PREFIX } from "./prefix";
import { startDither } from "./ditherCanvas";

const FRAME_NAME = /^diff:(a|b):([\w-]{8,64})$/;
const HOST_ID = "diff-devtools-host";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DARK = "#08080a";

const GLYPH =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3"/><path d="M8 3.9v4.4M5.8 6.1h4.4"/><path d="M5.8 10.9h4.4"/></svg>';

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function attachInspector(pane: string, token: string) {
  const w = window as unknown as { __RBD?: unknown };
  if (w.__RBD) return;
  const nav = performance.getEntriesByType("navigation")[0] as (PerformanceNavigationTiming & { responseStatus?: number }) | undefined;
  w.__RBD = { pane, token, target: location.origin, status: nav?.responseStatus || 200, parent: location.origin, nested: true };

  // Neither your own button nor Next's dev indicator belongs in a screenshot of the page.
  const hide = document.createElement("style");
  hide.setAttribute("data-diff-devtools", "");
  hide.textContent = `#${HOST_ID},nextjs-portal{display:none!important}`;
  document.head.appendChild(hide);

  const s = document.createElement("script");
  s.src = `${PREFIX}/assets/probe.js`;
  s.async = true;
  document.head.appendChild(s);
}

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Freeze the live page (fixed, shifted by the scroll offset) and move it with a transform and clip; release() puts it back.
function holdPage() {
  const html = document.documentElement;
  const body = document.body;
  const sy = window.scrollY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const saved = { html: html.getAttribute("style"), body: body.getAttribute("style") };

  // The page's own paper colour. A page that paints it on <html> would otherwise lose it when the canvas goes dark.
  const clear = (c: string) => !c || c === "transparent" || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c);
  const bodyBg = getComputedStyle(body).backgroundColor;
  const htmlBg = getComputedStyle(html).backgroundColor;
  const paper = !clear(bodyBg) ? bodyBg : !clear(htmlBg) ? htmlBg : "#fff";

  html.style.overflow = "hidden";
  html.style.transition = "background-color .5s ease";
  html.style.backgroundColor = DARK;
  Object.assign(body.style, {
    position: "fixed",
    top: `${-sy}px`,
    left: "0",
    right: "0",
    minHeight: `${sy + vh}px`,
    backgroundColor: paper,
    transformOrigin: "0 0",
    pointerEvents: "none",
    willChange: "transform, clip-path",
  });

  // Where the page is in body coordinates: the window from `sy` down, as wide as the viewport.
  const clip = (bottom: number, radius: number) => `inset(${sy}px 0px calc(100% - ${bottom}px) 0px round ${radius}px)`;
  const full = { transform: "translate(0px, 0px) scale(1)", clipPath: clip(sy + vh, 0) };
  const into = (slot: Slot, radius: number) => {
    const s = slot.w / vw;
    return { transform: `translate(${slot.x}px, ${slot.y + sy - s * sy}px) scale(${s})`, clipPath: clip(sy + slot.h / s, radius / s) };
  };

  let current = full;
  const set = (frame: typeof full) => {
    current = frame;
    body.style.transform = frame.transform;
    body.style.clipPath = frame.clipPath;
  };
  const glide = (to: typeof full, ms: number): Promise<void> => {
    if (!ms) {
      set(to);
      return Promise.resolve();
    }
    const anim = body.animate([current, to], { duration: ms, easing: EASE, fill: "forwards" });
    return anim.finished.then(
      () => {
        set(to);
        anim.cancel();
      },
      () => {},
    );
  };
  set(full);

  return {
    shrink: (slot: Slot, radius: number, ms: number) => glide(into(slot, radius), ms),
    place: (slot: Slot, radius: number) => set(into(slot, radius)),
    grow: (ms: number) => glide(full, ms),
    release() {
      if (saved.html === null) html.removeAttribute("style");
      else html.setAttribute("style", saved.html);
      if (saved.body === null) body.removeAttribute("style");
      else body.setAttribute("style", saved.body);
      window.scrollTo(0, sy);
    },
  };
}

function mountButton(onClose: (path: string) => void) {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        /* Sits just above Next.js's own dev-tools button (bottom-left). */
        position: fixed; left: 18px; bottom: 68px; z-index: 2147483000;
        display: grid; place-items: center; width: 40px; height: 40px; padding: 0; overflow: hidden;
        border: 1px solid rgba(0,0,0,.35); border-radius: 50%; cursor: pointer; background: #f43f5e;
        box-shadow: 0 8px 24px -8px rgba(0,0,0,.55);
        transition: transform .3s cubic-bezier(.22,1,.36,1), opacity .25s ease, box-shadow .2s ease;
      }
      button:hover { transform: translateY(-2px) scale(1.06); box-shadow: 0 12px 28px -8px rgba(0,0,0,.6); }
      button:active { transform: scale(.96); }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      button[data-open] { opacity: 0; transform: scale(.6); pointer-events: none; }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
          </style>
    <button type="button" aria-label="Compare this page with live (Ctrl/Cmd+Shift+D)" title="Compare with live (Ctrl/Cmd+Shift+D)"><canvas></canvas></button>`;
  const button = root.querySelector("button")!;
  const stopDither = startDither(root.querySelector("canvas")!, { cell: 2, glyph: GLYPH, glyphSize: 29 });

  let frame: HTMLIFrameElement | null = null;
  let page: ReturnType<typeof holdPage> | null = null;
  let settled = false;
  let busy = false;
  let giveUp: ReturnType<typeof setTimeout> | undefined;

  const begin = (slot: Slot, radius: number) => {
    const f = frame;
    if (!f || page) return;
    clearTimeout(giveUp);
    page = holdPage();
    f.style.opacity = "1";
    f.contentWindow?.postMessage({ diffDevtools: "enter" }, location.origin);
    void page.shrink(slot, radius, reducedMotion() ? 0 : 750).then(() => {
      settled = true;
      busy = false;
      f.style.pointerEvents = "auto";
      f.contentWindow?.postMessage({ diffDevtools: "landed" }, location.origin);
    });
  };

  const open = () => {
    if (frame || busy) return;
    busy = true;
    button.setAttribute("data-open", "");
    const f = document.createElement("iframe");
    frame = f;
    f.title = "diff";
    f.src = `${PREFIX}/ui?handoff=1&vw=${innerWidth}&vh=${innerHeight}&sy=${Math.round(scrollY)}&path=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    f.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483646;background:transparent;color-scheme:dark;opacity:0;pointer-events:none;transition:opacity .35s ease;";
    document.documentElement.appendChild(f);

    // If the viewer is slow to report, don't leave the press looking dead.
    giveUp = setTimeout(() => {
      const w = innerWidth;
      const h = innerHeight;
      begin({ x: w * 0.42, y: 110, w: w * 0.3, h: h * 0.68 }, 8);
    }, 2500);
  };

  const close = (path?: string) => {
    const f = frame;
    if (!f || !page || busy) return;
    busy = true;
    const p = page;
    if (path) onClose(path);
    const ms = reducedMotion() ? 0 : 600;
    f.style.pointerEvents = "none";
    f.style.opacity = "0";
    void p.grow(ms).then(() => {
      p.release();
      f.remove();
      frame = null;
      page = null;
      settled = false;
      busy = false;
      button.removeAttribute("data-open");
      button.focus({ preventScroll: true });
    });
  };

  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const d = e.data as { diffDevtools?: string; path?: unknown; rect?: Partial<Slot>; radius?: unknown } | null;
    if (d?.diffDevtools === "layout") {
      const r = d.rect;
      const ok = r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.h! > 0;
      if (!ok) return;
      const slot = r as Slot;
      const radius = typeof d.radius === "number" && Number.isFinite(d.radius) ? d.radius : 8;
      if (!page) begin(slot, radius);
      // The viewer's layout changed (window resized, device switched): keep the page under its pane.
      else if (settled) page.place(slot, radius);
    } else if (d?.diffDevtools === "close") {
      close(typeof d.path === "string" && d.path.startsWith("/") && !d.path.startsWith("//") ? d.path : undefined);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (frame) close();
      else open();
    }
  };

  button.addEventListener("click", open);
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKey);
  return () => {
    clearTimeout(giveUp);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("keydown", onKey);
    stopDither();
    if (page) page.release();
    frame?.remove();
    host.remove();
  };
}

export function startDiff() {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const framed = FRAME_NAME.exec(window.name);
  if (framed) {
    if (window.parent !== window) attachInspector(framed[1], framed[2]);
    return;
  }
  // Inside someone else's frame (a preview tool, an embed): no button.
  if (window.top !== window) return;
  mountButton((path) => {
    if (path !== location.pathname + location.search + location.hash) location.assign(path);
  });
}
