"use client";

/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/exhaustive-deps -- callbacks are created once and read the latest panes through refs */

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeftRight,
  ArrowUpDown,
  AppWindow,
  Command,
  Contrast,
  Eye,
  EyeOff,
  Layers,
  Link2,
  Link2Off,
  PanelRight,
  RefreshCw,
  RotateCw,
  ScanLine,
  Shuffle,
  SlidersHorizontal,
  SquareSplitHorizontal,
  Columns2,
  Minus,
  Plus,
  ChevronsLeftRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildScrollMap, type ScrollMap } from "@/lib/diff/engine";
import type { Block, DiffResult, Pair } from "@/lib/diff/types";
import { useDiff } from "@/lib/diff/useDiff";
import { mirrorPath, pathKey } from "@/lib/url";
import { cn } from "@/lib/utils";
import { ChangesPanel, STATUS_META, isVisibleChange, kindLabel, type PanelFilter } from "./ChangesPanel";
import { CUSTOM_DEVICE, DEVICES, SYNC_MODES, VIEW_MODES, windowDevice, type DeviceId, type SyncMode, type ViewMode } from "./devices";
import { envOf, EnvTag, ExitButton, HandoffContext, useHandoff, type DevtoolsOptions } from "./devtools";
import { Logo } from "./Logo";
import { Palette, type PaletteItem } from "./Palette";
import { Stage } from "./Stage";
import { CountUp, EASE, IconButton, Kbd, Menu, MenuItem, Segmented, Tip } from "./ui";
import { UrlField } from "./UrlField";
import { usePane, type Pane, type PaneId, type ScrollState } from "./usePane";

const PANEL_W = 372;

function previewOf(b?: Block) {
  if (!b) return "";
  return b.text || b.alt || (b.raw ? b.raw.split("/").pop()?.split("?")[0] : "") || "";
}

export function Workspace({ urlA, urlB, devtools }: { urlA: string; urlB: string; devtools?: DevtoolsOptions }) {
  const handoff = useHandoff();
  const { entered, ghost } = handoff;
  const [deviceId, setDeviceId] = useState<DeviceId>(devtools?.window ? "window" : "desktop");
  const [landscape, setLandscape] = useState(false);
  const [customW, setCustomW] = useState(1024);
  const [view, setView] = useState<ViewMode>("side");
  const [sync, setSync] = useState<SyncMode>("smart");
  const [highlights, setHighlights] = useState(true);
  const [mirror, setMirror] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [filter, setFilter] = useState<PanelFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [spin, setSpin] = useState(0);

  const syncRef = useRef(sync);
  syncRef.current = sync;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const tween = useRef(0);
  const suppress = useRef({ a: false, b: false });
  const lastUrl = useRef({ a: "", b: "" });
  const mapCache = useRef<{ key: string; map: ScrollMap } | null>(null);
  const diffRef = useRef<DiffResult | null>(null);
  // Callbacks below are created once; they read the *latest* pane state through this ref.
  const panes = useRef<{ a: Pane; b: Pane } | null>(null);

  const getMap = useCallback((): ScrollMap | null => {
    const d = diffRef.current;
    const P = panes.current;
    if (!d || !P) return null;
    const A = P.a.getScroll();
    const B = P.b.getScroll();
    const sa = P.a.state.snapshot;
    const sb = P.b.state.snapshot;
    const ah = A.h || sa?.docH || 0;
    const bh = B.h || sb?.docH || 0;
    const avh = A.vh || sa?.vh || 800;
    const bvh = B.vh || sb?.vh || 800;
    const key = `${d.aVersion}|${d.bVersion}|${ah}|${avh}|${bh}|${bvh}`;
    if (mapCache.current?.key === key) return mapCache.current.map;
    const map = buildScrollMap(d.anchors, { docH: ah, vh: avh }, { docH: bh, vh: bvh });
    mapCache.current = { key, map };
    return map;
  }, []);

  const mapFrom = useCallback(
    (from: PaneId, y: number): number => {
      const A = a.getScroll();
      const B = b.getScroll();
      const src = from === "a" ? A : B;
      const dst = from === "a" ? B : A;
      const mode = syncRef.current;
      if (mode === "pixel") return y;
      const prop = () => {
        const sm = Math.max(1, src.h - src.vh);
        const dm = Math.max(0, dst.h - dst.vh);
        return (y / sm) * dm;
      };
      if (mode === "proportional") return prop();
      const map = getMap();
      if (!map) return prop();
      return from === "a" ? map.aToB(y) : map.bToA(y);
    },
    [getMap],
  );

  const syncFrom = useCallback(
    (from: PaneId, s: ScrollState) => {
      if (syncRef.current === "off") return;
      const other = from === "a" ? b : a;
      other.post("scrollTo", { y: mapFrom(from, s.y) });
    },
    [mapFrom],
  );

  const handleNavigate = useCallback((pane: PaneId, url: string) => {
    if (!url || lastUrl.current[pane] === url) return;
    const first = lastUrl.current[pane] === "";
    lastUrl.current[pane] = url;
    if (first) return;
    if (suppress.current[pane]) {
      suppress.current[pane] = false;
      return;
    }
    if (!mirrorRef.current) return;
    const P = panes.current!;
    const other = pane === "a" ? P.b : P.a;
    const base = other.state.current || other.state.requested;
    if (!base || pathKey(url) === pathKey(base)) return;
    const dest = mirrorPath(url, base);
    if (!dest) return;
    suppress.current[pane === "a" ? "b" : "a"] = true;
    other.load(dest, { silent: true });
  }, []);

  const a: Pane = usePane("a", {
    onUserScroll: (p, s) => {
      cancelAnimationFrame(tween.current);
      syncFrom(p, s);
    },
    onNavigate: handleNavigate,
  });
  const b: Pane = usePane("b", {
    onUserScroll: (p, s) => {
      cancelAnimationFrame(tween.current);
      syncFrom(p, s);
    },
    onNavigate: handleNavigate,
  });

  panes.current = { a, b };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    a.load(urlA);
    b.load(urlB);
  }, []);

  // Once the viewer's own copy of the page is showing in the slot your page shrank into, the slot can stop being empty.
  const ghostStatus = ghost ? (ghost === "a" ? a : b).state.status : null;
  useEffect(() => {
    if (!entered || ghostStatus !== "ready" || !handoff.onGhostDone) return;
    const t = setTimeout(handoff.onGhostDone, 1400);
    return () => clearTimeout(t);
  }, [entered, ghostStatus, handoff.onGhostDone]);

  // Restore both panes to the scroll position from the button press before the viewer's copy replaces the shrinking page.
  const [scrollRestored, setScrollRestored] = useState(!handoff.scrollY);
  const restoring = useRef(false);
  const slotStatus = handoff.slot ? (handoff.slot === "a" ? a : b).state.status : null;
  const otherStatus = handoff.slot ? (handoff.slot === "a" ? b : a).state.status : null;
  useEffect(() => {
    const y = handoff.scrollY;
    if (!y || restoring.current || !entered || !handoff.slot || slotStatus !== "ready" || otherStatus !== "ready") return;
    restoring.current = true;
    a.post("scrollTo", { y });
    b.post("scrollTo", { y });
    const t = setTimeout(() => setScrollRestored(true), 120);
    return () => clearTimeout(t);
  }, [entered, handoff.scrollY, handoff.slot, slotStatus, otherStatus]);
  // A scroll position that can't be restored (a pane failed to load) must not hold the viewer back forever.
  useEffect(() => {
    if (scrollRestored || !handoff.landed) return;
    const t = setTimeout(() => setScrollRestored(true), 2500);
    return () => clearTimeout(t);
  }, [scrollRestored, handoff.landed]);
  const staged = useMemo(() => ({ ...handoff, landed: handoff.landed && scrollRestored }), [handoff, scrollRestored]);

  const { diff } = useDiff(a.state.snapshot, b.state.snapshot);
  diffRef.current = diff;

  const selected = useMemo(() => (diff && selectedId ? (diff.pairs.find((p) => p.id === selectedId) ?? null) : null), [diff, selectedId]);

  // Two unrelated pages would light up end to end; start with highlights off instead.
  const wasUnrelated = useRef(false);
  useEffect(() => {
    if (!diff) return;
    const noisy = diff.unrelated || diff.crowded;
    if (noisy && !wasUnrelated.current) setHighlights(false);
    wasUnrelated.current = noisy;
  }, [diff]);

  // Line the pages up the moment a new comparison lands.
  useEffect(() => {
    if (!diff) return;
    mapCache.current = null;
    syncFrom("a", a.getScroll());
  }, [diff, sync]);

  const changes = useMemo(() => (diff ? diff.pairs.filter((p) => isVisibleChange(p) && (filter === "all" || p.status === filter)) : []), [diff, filter]);

  useEffect(() => {
    if (!diff) return;
    if (!highlights) {
      a.post("clearHighlights");
      b.post("clearHighlights");
      return;
    }
    const build = (side: "a" | "b") => {
      const items: { id: number; ids?: number[]; kind: string; active?: boolean; dashed?: boolean }[] = [];
      for (const p of diff.pairs) {
        if (!isVisibleChange(p)) continue;
        if (filter !== "all" && p.status !== filter) continue;
        const blk = side === "a" ? p.a : p.b;
        if (!blk) continue;
        const ids = p.run ? p.run[side] : undefined;
        items.push({ id: blk.id, ids, kind: p.status, active: p.id === selectedId, dashed: blk.kind === "region" });
        if (items.length >= 250) break;
      }
      return items;
    };
    a.post("highlights", { v: diff.aVersion, items: build("a") });
    b.post("highlights", { v: diff.bVersion, items: build("b") });
  }, [diff, highlights, filter, selectedId]);

  const tweenScroll = useCallback((toA: number, toB: number) => {
    cancelAnimationFrame(tween.current);
    const fromA = a.getScroll().y;
    const fromB = b.getScroll().y;
    const t0 = performance.now();
    const dur = 620;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      a.post("scrollTo", { y: fromA + (toA - fromA) * e });
      b.post("scrollTo", { y: fromB + (toB - fromB) * e });
      if (t < 1) tween.current = requestAnimationFrame(step);
    };
    tween.current = requestAnimationFrame(step);
  }, []);

  const focusPair = useCallback(
    (p: Pair) => {
      setSelectedId(p.id);
      const A = a.getScroll();
      const B = b.getScroll();
      const place = (blk: Block, vh: number) => Math.max(0, blk.y - (blk.h > vh * 0.5 ? 0.1 : 0.3) * vh);
      let ya = p.a ? place(p.a, A.vh || 800) : null;
      let yb = p.b ? place(p.b, B.vh || 800) : null;
      const map = getMap();
      if (ya === null && yb !== null) ya = map ? map.bToA(yb) : yb;
      if (yb === null && ya !== null) yb = map ? map.aToB(ya) : ya;
      if (ya !== null && yb !== null) tweenScroll(ya, yb);
    },
    [getMap, tweenScroll],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!changes.length) return;
      const i = changes.findIndex((p) => p.id === selectedId);
      const next = i < 0 ? (dir === 1 ? 0 : changes.length - 1) : (i + dir + changes.length) % changes.length;
      focusPair(changes[next]);
    },
    [changes, selectedId, focusPair],
  );

  const load = useCallback((id: PaneId, url: string) => {
    suppress.current[id] = true;
    setSelectedId(null);
    (id === "a" ? a : b).load(url);
  }, []);

  const reload = useCallback(
    (id: PaneId) => {
      const P = panes.current!;
      const p = id === "a" ? P.a : P.b;
      const url = p.state.current || p.state.requested;
      if (url) load(id, url);
    },
    [load],
  );

  /** Devtools: leave diff mode on the page the local site is on, so you land where you were looking. */
  const exit = useCallback(() => {
    if (!devtools) return;
    const P = panes.current!;
    const local = [P.a, P.b].find((p) => envOf(devtools.environments, p.state.current || p.state.requested)?.id === "local");
    let path = "";
    try {
      const u = new URL(local?.state.current || local?.state.requested || "");
      path = u.pathname + u.search + u.hash;
    } catch {}
    devtools.onClose(path);
  }, [devtools]);

  const swap = useCallback(() => {
    const P = panes.current!;
    const ua = P.a.state.current || P.a.state.requested;
    const ub = P.b.state.current || P.b.state.requested;
    if (!ua || !ub) return;
    setSpin((n) => n + 1);
    lastUrl.current = { a: "", b: "" };
    load("a", ub);
    load("b", ua);
  }, [load]);

  const scan = useCallback(() => {
    a.post("warmup");
    b.post("warmup");
  }, []);

  // Stable identity unless the device really changes, so the panes can skip re-rendering.
  const device = useMemo(
    () =>
      deviceId === "window" && devtools?.window
        ? windowDevice(devtools.window.w, devtools.window.h)
        : deviceId === "custom"
          ? { ...CUSTOM_DEVICE, w: customW }
          : (DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0]),
    [deviceId, customW, devtools?.window],
  );
  const rotatable = device.h !== "fill";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The same shortcut that opened the viewer closes it, wherever the focus is.
      if (devtools && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        exit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") step(1);
      else if (e.key === "k") step(-1);
      else if (e.key === "h") setHighlights((h) => !h);
      else if (e.key === "p") setPanelOpen((o) => !o);
      else if (e.key === "Escape") setSelectedId(null);
      else if (e.key >= "1" && e.key <= "4") setView(VIEW_MODES[+e.key - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, devtools, exit]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    const icon = "size-4";
    list.push(
      { id: "next", group: "Actions", title: "Next change", shortcut: "J", icon: <Plus className={icon} />, run: () => step(1) },
      { id: "prev", group: "Actions", title: "Previous change", shortcut: "K", icon: <Minus className={icon} />, run: () => step(-1) },
      { id: "hl", group: "Actions", title: highlights ? "Hide highlights" : "Show highlights", shortcut: "H", icon: <Eye className={icon} />, run: () => setHighlights((h) => !h) },
      { id: "panel", group: "Actions", title: panelOpen ? "Hide changes panel" : "Show changes panel", shortcut: "P", icon: <PanelRight className={icon} />, run: () => setPanelOpen((o) => !o) },
      { id: "swap", group: "Actions", title: "Swap A and B", icon: <Shuffle className={icon} />, run: swap },
      { id: "scan", group: "Actions", title: "Scan pages for lazy-loaded content", detail: "Scrolls both pages top to bottom, then back", icon: <ScanLine className={icon} />, run: scan },
      { id: "reload", group: "Actions", title: "Reload both pages", icon: <RefreshCw className={icon} />, run: () => (reload("a"), reload("b")) },
    );
    VIEW_MODES.forEach((m, i) =>
      list.push({ id: `view-${m.id}`, group: "View", title: m.label, detail: m.hint, shortcut: String(i + 1), icon: <Layers className={icon} />, run: () => setView(m.id) }),
    );
    DEVICES.forEach((d) =>
      list.push({ id: `dev-${d.id}`, group: "Device", title: `${d.label} preview`, detail: d.sub, icon: <d.icon className={icon} />, run: () => setDeviceId(d.id) }),
    );
    if (diff) {
      for (const p of diff.pairs.filter(isVisibleChange).slice(0, 300)) {
        const blk = (p.b ?? p.a)!;
        const Icon = STATUS_META[p.status as keyof typeof STATUS_META].icon;
        list.push({
          id: `chg-${p.id}`,
          group: "Changes",
          title: previewOf(blk) || kindLabel(blk),
          detail: `${STATUS_META[p.status as keyof typeof STATUS_META].label} · ${kindLabel(blk)}`,
          icon: <Icon className={icon} />,
          run: () => {
            setPanelOpen(true);
            focusPair(p);
          },
        });
      }
    }
    return list;
  }, [diff, highlights, panelOpen, step, swap, scan, reload, focusPair]);

  const bothReady = a.state.status === "ready" && b.state.status === "ready";
  const stats = diff?.stats;
  const changeCount = diff?.topLevel ?? 0;

  return (
    <HandoffContext.Provider value={staged}>
      <motion.div
        className={cn("relative flex h-dvh flex-col overflow-hidden text-zinc-100", !ghost && "bg-[#08080a]")}
        initial={{ opacity: 0 }}
        animate={{ opacity: entered ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 50% -10%, rgba(120,119,198,0.16), transparent 70%), radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 22px 22px",
          }}
        />

        <motion.header
          initial={{ y: -24, opacity: 0 }}
          animate={entered ? { y: 0, opacity: 1 } : { y: -24, opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
          className="relative z-30 grid h-[52px] shrink-0 grid-cols-[1fr_minmax(0,860px)_1fr] items-center gap-3 border-b border-white/[0.06] bg-zinc-950/90 px-3"
        >
          <Logo className="hidden sm:flex" />
          <div className="col-start-2 flex min-w-0 items-center gap-2">
            <UrlField
              id="a"
              state={a.state}
              onSubmit={(u) => load("a", u)}
              readOnly={!!devtools}
              leading={devtools && <EnvTag env={envOf(devtools.environments, a.state.current || a.state.requested)} />}
            />
            <Tip label="Swap A and B">
              <motion.button
                type="button"
                onClick={swap}
                aria-label="Swap A and B"
                animate={{ rotate: spin * 180 }}
                transition={{ duration: 0.6, ease: EASE }}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 outline-none transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <ArrowLeftRight className="size-4" />
              </motion.button>
            </Tip>
            <UrlField
              id="b"
              state={b.state}
              onSubmit={(u) => load("b", u)}
              readOnly={!!devtools}
              leading={devtools && <EnvTag env={envOf(devtools.environments, b.state.current || b.state.requested)} />}
            />
          </div>
          <div className="col-start-3 flex items-center justify-end gap-2">
          {devtools && <ExitButton onClick={exit} />}
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="hidden h-8 shrink-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] pl-2.5 pr-1.5 text-[12px] text-zinc-400 outline-none transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/30 md:inline-flex"
          >
            Jump to…
            <Kbd className="gap-0.5">
              <Command className="size-2.5" />K
            </Kbd>
          </button>
          </div>
        </motion.header>

        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={entered ? { y: 0, opacity: 1 } : { y: -16, opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.18 }}
          className="relative z-20 flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.05] bg-zinc-950/70 px-3"
        >
          <Segmented
            value={deviceId}
            onChange={(id) => {
              setDeviceId(id);
              if (id !== "tablet" && id !== "phone") setLandscape(false);
            }}
            options={[
              ...(devtools?.window
                ? [{ id: "window" as DeviceId, hint: `This window · ${devtools.window.w} × ${devtools.window.h}`, icon: <AppWindow className="size-3.5" />, label: undefined as string | undefined }]
                : []),
              ...DEVICES.map((d) => ({
                id: d.id,
                hint: `${d.label} · ${d.sub}`,
                icon: <d.icon className="size-3.5" />,
                label: undefined as string | undefined,
              })),
              { id: "custom" as DeviceId, hint: "Custom width", icon: <SlidersHorizontal className="size-3.5" />, label: undefined },
            ]}
          />
          <AnimatePresence initial={false} mode="popLayout">
            {rotatable && (
              <motion.span key="rot" initial={{ opacity: 0, scale: 0.7, width: 0 }} animate={{ opacity: 1, scale: 1, width: 32 }} exit={{ opacity: 0, scale: 0.7, width: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                <IconButton label="Rotate" onClick={() => setLandscape((l) => !l)} active={landscape}>
                  <RotateCw className="size-4" />
                </IconButton>
              </motion.span>
            )}
            {deviceId === "custom" && (
              <motion.label
                key="cw"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 118 }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex h-7 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-[11.5px] text-zinc-400 focus-within:border-white/25"
              >
                <input
                  type="number"
                  min={280}
                  max={3000}
                  value={customW}
                  onChange={(e) => setCustomW(Math.max(280, Math.min(3000, +e.target.value || 280)))}
                  className="w-14 bg-transparent text-right font-mono text-zinc-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  aria-label="Custom viewport width in pixels"
                />
                px wide
              </motion.label>
            )}
          </AnimatePresence>

          <span className="mx-1 h-5 w-px bg-white/[0.08]" />

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { id: "side", icon: <Columns2 className="size-3.5" />, label: "Side by side", hint: "Side by side · synced, aligned scrolling (1)", labelClass: "hidden xl:inline" },
              { id: "slider", icon: <SquareSplitHorizontal className="size-3.5" />, label: "Slider", hint: "Slider · drag to reveal B over A (2)", labelClass: "hidden xl:inline" },
              { id: "fade", icon: <Layers className="size-3.5" />, label: "Fade", hint: "Fade · cross-fade between A and B (3)", labelClass: "hidden xl:inline" },
              { id: "difference", icon: <Contrast className="size-3.5" />, label: "Difference", hint: "Difference · changed pixels light up (4)", labelClass: "hidden xl:inline" },
            ]}
          />

          <div className="ml-auto flex items-center gap-1">
            <Menu
              align="right"
              trigger={({ toggle, open }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-zinc-400 outline-none transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <ChevronsLeftRight className="size-3.5" />
                  <span className="hidden xl:inline">{SYNC_MODES.find((m) => m.id === sync)?.label}</span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Scroll sync</p>
                  {SYNC_MODES.map((m) => (
                    <MenuItem
                      key={m.id}
                      active={m.id === sync}
                      title={m.label}
                      hint={m.hint}
                      icon={<ArrowUpDown className="size-4" />}
                      onClick={() => {
                        setSync(m.id);
                        close();
                      }}
                    />
                  ))}
                </>
              )}
            </Menu>
            <IconButton label={highlights ? "Hide highlights (H)" : "Show highlights (H)"} active={highlights} onClick={() => setHighlights((h) => !h)}>
              {highlights ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </IconButton>
            <IconButton label={mirror ? "Mirror navigation: on" : "Mirror navigation: off"} active={mirror} onClick={() => setMirror((m) => !m)}>
              {mirror ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
            </IconButton>
            <IconButton label="Scan for lazy-loaded content" onClick={scan} disabled={!bothReady}>
              <ScanLine className="size-4" />
            </IconButton>
            <span className="mx-1 h-5 w-px bg-white/[0.08]" />
            <button
              type="button"
              onClick={() => setPanelOpen((o) => !o)}
              aria-pressed={panelOpen}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-lg pl-2.5 pr-2 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/30",
                panelOpen ? "bg-white/[0.08] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
              )}
            >
              <PanelRight className="size-4" />
              {stats ? (
                <span className="inline-flex items-center gap-1.5">
                  <CountUp value={changeCount} />
                  <span className="hidden text-zinc-500 xl:inline">{changeCount === 1 ? "change" : "changes"}</span>
                </span>
              ) : (
                <span className="hidden text-zinc-500 xl:inline">Changes</span>
              )}
            </button>
          </div>
        </motion.div>

        <div className="relative z-10 flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            <Stage
              a={a}
              b={b}
              mode={view}
              device={device}
              landscape={landscape}
              customW={customW}
              diff={diff}
              selected={selected}
              showRibbons={highlights}
              onReload={reload}
            />
          </main>
          <AnimatePresence initial={false}>
            {panelOpen && (
              <motion.aside
                key="panel"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: PANEL_W, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.55, ease: EASE }}
                className="relative shrink-0 overflow-hidden border-l border-white/[0.06] bg-zinc-950/85"
              >
                <div style={{ width: PANEL_W }} className="h-full">
                  <ChangesPanel
                    diff={diff}
                    waiting={!bothReady}
                    selectedId={selectedId}
                    onSelect={focusPair}
                    filter={filter}
                    onFilter={setFilter}
                    onStep={step}
                    onClose={() => setPanelOpen(false)}
                    highlightsOn={highlights}
                    onToggleHighlights={() => setHighlights((h) => !h)}
                  />
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        <Palette open={palette} onClose={() => setPalette(false)} items={paletteItems} groupOrder={["Actions", "View", "Device", "Changes"]} />
      </motion.div>
    </HandoffContext.Provider>
  );
}
