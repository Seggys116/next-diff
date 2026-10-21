"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageHead, PageSnapshot } from "@/lib/diff/types";
import { StartError, usePaneBackend, type PaneId, type PaneTarget } from "./backend";

export type { PaneId };

export interface ScrollState {
  y: number;
  h: number;
  vh: number;
  vw: number;
}

export interface PaneError {
  title: string;
  message: string;
  hint?: string;
  id?: number;
  v?: number;
}

export interface PaneState {
  status: "idle" | "registering" | "loading" | "ready" | "error";
  /** URL the user asked for. */
  requested: string;
  /** URL the page reports it is currently on (real origin). */
  current: string;
  title: string;
  /** Favicon of the previewed page, as a URL on the real site. Empty until known. */
  icon: string;
  /** Document head: title, description, canonical, Open Graph, Twitter. Null until the page reports it. */
  head: PageHead | null;
  httpStatus?: number;
  error?: PaneError;
  snapshot: PageSnapshot | null;
  loadId: number;
  warm: number | null;
}

interface ProbeData {
  url: string;
  title: string;
  icon?: string;
  status?: number;
  y: number;
  h: number;
  vh: number;
  vw: number;
  user?: boolean;
  state?: string;
  p?: number;
  message: string;
  hint?: string;
  id?: number;
  v?: number;
  head?: unknown;
}

export interface PaneCallbacks {
  onUserScroll?: (pane: PaneId, s: ScrollState) => void;
  onScroll?: (pane: PaneId, s: ScrollState) => void;
  onNavigate?: (pane: PaneId, url: string) => void;
  onPick?: (pane: PaneId, id: number, version: number) => void;
}

// Address, title, and icon from the page are attacker-controlled: http(s) only, length-capped, never inserted as markup.
const httpUrl = (v: unknown, fallback = "", max = 2048): string =>
  typeof v === "string" && v.length < max && /^https?:\/\//i.test(v) ? v : fallback;
const cleanText = (v: unknown): string => (typeof v === "string" ? v.slice(0, 300) : "");
const clipText = (v: unknown, n: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, n) : "";

function cleanHead(raw: unknown): PageHead | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const og = (o.og && typeof o.og === "object" ? o.og : {}) as Record<string, unknown>;
  const tw = (o.twitter && typeof o.twitter === "object" ? o.twitter : {}) as Record<string, unknown>;
  return {
    title: clipText(o.title, 300),
    description: clipText(o.description, 500),
    canonical: httpUrl(o.canonical, "", 4096),
    robots: clipText(o.robots, 200),
    keywords: clipText(o.keywords, 400),
    author: clipText(o.author, 200),
    lang: clipText(o.lang, 32),
    og: {
      title: clipText(og.title, 300),
      description: clipText(og.description, 500),
      image: httpUrl(og.image, "", 4096),
      imageAlt: clipText(og.imageAlt, 300),
      url: httpUrl(og.url, "", 4096),
      type: clipText(og.type, 64),
      siteName: clipText(og.siteName, 120),
    },
    twitter: {
      card: clipText(tw.card, 64),
      title: clipText(tw.title, 300),
      description: clipText(tw.description, 500),
      image: httpUrl(tw.image, "", 4096),
    },
  };
}

const initial = (): PaneState => ({
  status: "idle",
  requested: "",
  current: "",
  title: "",
  icon: "",
  head: null,
  snapshot: null,
  loadId: 0,
  warm: null,
});

export function usePane(pane: PaneId, callbacks: PaneCallbacks) {
  const [state, setState] = useState<PaneState>(initial);
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState<string | undefined>(undefined);
  const backend = usePaneBackend();
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const token = useRef("");
  const target = useRef<PaneTarget | null>(null);
  const cb = useRef(callbacks);
  const scroll = useRef<ScrollState>({ y: 0, h: 0, vh: 0, vw: 0 });
  const listeners = useRef(new Set<() => void>());
  const loadSeq = useRef(0);
  cb.current = callbacks;

  const release = useCallback(() => {
    const t = target.current;
    target.current = null;
    t?.release?.();
  }, []);

  const load = useCallback(
    async (url: string, opts?: { silent?: boolean }) => {
      const seq = ++loadSeq.current;
      // Keep the previous preview host until the next one exists. Same site reuses it, so its cookies survive the navigation.
      const previous = target.current;
      target.current = null;
      token.current = crypto.randomUUID();
      setState((s) => ({
        ...s,
        status: "registering",
        requested: url,
        // Put the new address in the bar immediately; waiting for the load report made a failed navigation look unchanged.
        current: opts?.silent ? s.current : "",
        title: opts?.silent ? s.title : "",
        error: undefined,
        httpStatus: undefined,
        icon: opts?.silent ? s.icon : "",
        head: opts?.silent ? s.head : null,
        snapshot: opts?.silent ? s.snapshot : null,
        warm: null,
      }));
      try {
        const started = await backend.start(url, pane, token.current);
        if (seq !== loadSeq.current) {
          if (!previous || previous.origin !== started.origin) started.release?.();
          return;
        }
        if (previous && previous.origin !== started.origin) previous.release?.();
        target.current = started;
        setName(started.name);
        setSrc(started.src);
        setState((s) => ({ ...s, status: "loading" }));
      } catch (err) {
        if (seq !== loadSeq.current) return;
        if (previous && !target.current) target.current = previous;
        setState((s) => ({
          ...s,
          status: "error",
          error: {
            title: err instanceof StartError && err.title ? err.title : "Couldn’t start the preview",
            message: err instanceof Error ? err.message : "Unknown error",
            hint: err instanceof StartError ? err.hint : undefined,
          },
        }));
      }
    },
    [pane, backend],
  );

  const post = useCallback((type: string, extra?: Record<string, unknown>) => {
    const win = iframe.current?.contentWindow;
    if (!win || !target.current) return;
    win.postMessage({ rbd: 1, token: token.current, type, ...extra }, target.current.origin);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { rbd?: number; pane?: string; token?: string; type?: string; data?: unknown } | null;
      if (!d || d.rbd !== 1 || d.pane !== pane || d.token !== token.current) return;
      if (e.source !== iframe.current?.contentWindow) return;
      if (!target.current || e.origin !== target.current.origin) return;
      const data = (d.data ?? {}) as ProbeData;
      if ("url" in data) data.url = httpUrl(data.url);
      if ("title" in data) data.title = cleanText(data.title);
      if ("icon" in data) data.icon = httpUrl(data.icon);
      switch (d.type) {
        case "hello":
          setState((s) => ({
            ...s,
            status: s.status === "ready" ? "ready" : "loading",
            current: data.url,
            title: data.title,
            icon: data.icon || s.icon,
            head: cleanHead(data.head) ?? s.head,
            httpStatus: data.status,
          }));
          cb.current.onNavigate?.(pane, data.url);
          break;
        case "nav":
          setState((s) => ({
            ...s,
            current: data.url,
            title: data.title || s.title,
            icon: data.icon || s.icon,
            head: cleanHead(data.head) ?? s.head,
          }));
          cb.current.onNavigate?.(pane, data.url);
          break;
        case "snapshot": {
          const snap = { ...(data as object) } as PageSnapshot & { head?: unknown };
          const head = cleanHead(snap.head);
          delete snap.head;
          setState((s) => ({
            ...s,
            status: "ready",
            snapshot: snap,
            head: head ?? s.head,
            current: data.url,
            title: data.title || s.title,
            icon: data.icon || s.icon,
            loadId: s.status === "ready" ? s.loadId : s.loadId + 1,
          }));
          break;
        }
        case "scroll": {
          scroll.current = { y: data.y, h: data.h, vh: data.vh, vw: data.vw };
          listeners.current.forEach((l) => l());
          cb.current.onScroll?.(pane, scroll.current);
          if (data.user) cb.current.onUserScroll?.(pane, scroll.current);
          break;
        }
        case "pick":
          cb.current.onPick?.(pane, Number(data.id) || 0, Number(data.v) || 0);
          break;
        case "warmup":
          setState((s) => ({ ...s, warm: data.state === "done" ? null : (data.p ?? 0) }));
          break;
        case "error":
          setState((s) => ({
            ...s,
            status: "error",
            error: { title: data.title, message: data.message, hint: data.hint },
          }));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pane]);

  useEffect(() => {
    const onHide = () => release();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      release();
    };
  }, [release]);

  const subscribeScroll = useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const bindIframe = useCallback((el: HTMLIFrameElement | null) => {
    // During the crossfade both frames exist; the one leaving must not clear the ref to the one that arrived.
    if (el) iframe.current = el;
    else if (!iframe.current?.isConnected) iframe.current = null;
  }, []);
  const getScroll = useCallback(() => scroll.current, []);

  return useMemo(
    () => ({ state, src, name, load, post, subscribeScroll, getScroll, bindIframe }),
    [state, src, name, load, post, subscribeScroll, getScroll, bindIframe],
  );
}

export type Pane = ReturnType<typeof usePane>;
