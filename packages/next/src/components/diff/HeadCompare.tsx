"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { PageHead } from "@/lib/diff/types";
import { cn } from "@/lib/utils";

export interface HeadSide {
  url: string;
  /** The preview frame's address, when the page is loaded through one. */
  frame: string | null;
  head: PageHead | null;
}

/** The same amber the page ribbons use for a changed block. */
const MARK = "rounded-[3px] bg-amber-400/15 px-0.5 text-amber-100";
const BOX = "rounded-xl border border-white/10";
const RIBBON = "border-y border-amber-400/60 bg-amber-400/[0.16]";

const same = (a: string, b: string) => a.trim() === b.trim();

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {
    return url;
  }
}

interface Picture {
  declared: string;
  src: string;
  /** The tag names the live site although this page is served somewhere else (localhost, a past commit). */
  hooked: boolean;
  tagHost: string;
}

/** A local page or past commit still names the live site in og:image; the same path on the instance being viewed is what it would ship. */
function pictureOf(declared: string, pageUrl: string, frame: string | null, liveOrigin: string): Picture {
  const none: Picture = { declared, src: "", hooked: false, tagHost: "" };
  if (!declared) return none;
  let tag: URL;
  try {
    tag = new URL(declared);
  } catch {
    return { ...none, src: declared };
  }
  const page = originOf(pageUrl);
  const hooked = !!page && tag.origin !== page && (!liveOrigin || tag.origin === liveOrigin);
  let src = hooked ? page + tag.pathname + tag.search + tag.hash : declared;
  if (frame && page) {
    try {
      const via = new URL(frame);
      const target = new URL(src);
      if (target.origin === page && via.origin !== page) src = via.origin + target.pathname + target.search + target.hash;
    } catch {
      /* keep src */
    }
  }
  return { declared, src, hooked, tagHost: tag.host };
}

function Band({ changed }: { changed: boolean }) {
  return (
    <div className="flex items-center" aria-hidden>
      <div className={cn("h-3/5 w-full", changed ? RIBBON : "border-y border-white/10 bg-white/[0.035]")} />
    </div>
  );
}

/** Always the whole picture, never cropped: what a share preview would show is the point. */
function Picture({ picture, className, style }: { picture: Picture; className?: string; style?: React.CSSProperties }) {
  // This instance's copy first, then whatever the tag names, then give up quietly.
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const src = step === 0 ? picture.src : step === 1 ? picture.declared : "";
  return (
    <div style={style} className={cn("relative", className)}>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          className="absolute inset-0 size-full object-contain object-top"
          onError={() => setStep((s) => (s === 0 && picture.declared && picture.declared !== picture.src ? 1 : 2))}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-center text-[11px] text-zinc-600">{picture.declared ? "Image unavailable" : "No og:image"}</span>
      )}
    </div>
  );
}

const RATIO = 1.91;
const WORDS_H = 76;

/** Picture beside the words, or on top of them: whichever leaves the picture the larger area in this box. */
function stacked(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  const iw = w - 16;
  const ih = h - 16;
  const besideW = Math.min(ih * RATIO, iw * 0.46);
  const beside = besideW * (besideW / RATIO);
  const onTopH = Math.max(0, ih - WORDS_H);
  const onTopW = Math.min(iw, onTopH * RATIO);
  const onTop = onTopW * Math.min(onTopH, onTopW / RATIO);
  return onTop > beside * 1.15;
}

function OgBox({ side, other, liveOrigin }: { side: HeadSide; other: HeadSide; liveOrigin: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDim({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tall = stacked(dim.w, dim.h);
  const besideW = Math.max(0, Math.min((dim.h - 16) * RATIO, (dim.w - 16) * 0.46));

  const h = side.head;
  const o = other.head;
  let body: React.ReactNode;
  if (!h) {
    body = (
      <div className="flex h-full gap-3">
        <div className="h-full w-[42%] animate-pulse bg-white/[0.05]" />
        <div className="min-w-0 flex-1 space-y-2 py-1">
          <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.04]" />
        </div>
      </div>
    );
  } else {
    const title = h.og.title || h.title;
    const description = h.og.description || h.description;
    const image = h.og.image || h.twitter.image;
    const picture = pictureOf(image, side.url, side.frame, liveOrigin);
    const titleChanged = !!o && !same(title, o.og.title || o.title);
    const descriptionChanged = !!o && !same(description, o.og.description || o.description);
    const words = (
      <div className={cn("min-w-0", tall ? "shrink-0" : "flex flex-1 flex-col justify-center")}>
        <p className="truncate text-[13px] font-medium leading-tight text-zinc-100" title={title}>
          <span className={titleChanged ? MARK : undefined}>{title || "No title"}</span>
        </p>
        <p className={cn("mt-1 text-[12px] leading-snug text-zinc-400", tall ? "line-clamp-3" : "line-clamp-2")} title={description}>
          <span className={descriptionChanged ? MARK : undefined}>{description || "No description"}</span>
        </p>
        {picture.hooked && (
          <p className="mt-1 truncate font-mono text-[10.5px] text-amber-300/90" title={picture.declared}>
            og:image names {picture.tagHost}
            <span className="text-zinc-500"> · showing this copy</span>
          </p>
        )}
      </div>
    );
    const shot = picture.src || picture.declared;
    body = tall ? (
      <div className="flex h-full flex-col gap-2.5">
        <Picture key={shot} picture={picture} className="min-h-0 flex-1" />
        {words}
      </div>
    ) : (
      <div className="flex h-full gap-3">
        <Picture key={shot} picture={picture} className="aspect-[1.91/1] shrink-0 self-center" style={{ width: besideW }} />
        {words}
      </div>
    );
  }
  return (
    <div ref={box} className={cn(BOX, "min-h-0 min-w-0 bg-zinc-950 p-2")}>
      {body}
    </div>
  );
}

export function OgRow({ a, b, gutter, liveOrigin = "" }: { a: HeadSide; b: HeadSide; gutter: number; liveOrigin?: string }) {
  const ha = a.head;
  const hb = b.head;
  const changed =
    !!ha &&
    !!hb &&
    (!same(ha.og.title || ha.title, hb.og.title || hb.title) ||
      !same(ha.og.description || ha.description, hb.og.description || hb.description) ||
      !same(pathOf(ha.og.image || ha.twitter.image), pathOf(hb.og.image || hb.twitter.image)));
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: `minmax(0,1fr) ${gutter}px minmax(0,1fr)` }}>
      <OgBox side={a} other={b} liveOrigin={liveOrigin} />
      <Band changed={changed} />
      <OgBox side={b} other={a} liveOrigin={liveOrigin} />
    </div>
  );
}

const FIELDS: { label: string; mono?: boolean; get: (h: PageHead) => string }[] = [
  { label: "title", get: (h) => h.title },
  { label: "description", get: (h) => h.description },
  { label: "canonical", mono: true, get: (h) => h.canonical },
  { label: "robots", get: (h) => h.robots },
  { label: "keywords", get: (h) => h.keywords },
  { label: "author", get: (h) => h.author },
  { label: "lang", get: (h) => h.lang },
  { label: "og:title", get: (h) => h.og.title },
  { label: "og:description", get: (h) => h.og.description },
  { label: "og:image", mono: true, get: (h) => h.og.image },
  { label: "og:image:alt", get: (h) => h.og.imageAlt },
  { label: "og:url", mono: true, get: (h) => h.og.url },
  { label: "og:type", get: (h) => h.og.type },
  { label: "og:site_name", get: (h) => h.og.siteName },
  { label: "twitter:card", get: (h) => h.twitter.card },
  { label: "twitter:title", get: (h) => h.twitter.title },
  { label: "twitter:description", get: (h) => h.twitter.description },
  { label: "twitter:image", mono: true, get: (h) => h.twitter.image },
];

/** The tag column is 118px when its side has room, and a share of the side when it does not, so values are never squeezed out. */
const tagWidth = (side: number) => Math.round(Math.max(64, Math.min(118, side * 0.3)));
const LINE = "border-white/[0.07]";

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("sticky top-0 z-10 h-8 border-b bg-[#141417] px-3 text-left align-middle text-[11px] font-medium text-zinc-500", "border-white/10", className)}
    >
      {children}
    </th>
  );
}

function TagCell({ label, changed }: { label: string; changed: boolean }) {
  return (
    <th
      scope="row"
      title={label}
      className={cn(
        "truncate border-b border-r bg-white/[0.02] px-3 py-2 text-left align-top font-mono text-[11px] font-normal transition-colors",
        LINE,
        changed ? "bg-amber-400/[0.07] text-amber-300 shadow-[inset_2px_0_0_rgba(251,191,36,0.85)] group-hover:bg-amber-400/[0.11]" : "text-zinc-500 group-hover:bg-white/[0.045]",
      )}
    >
      {label}
    </th>
  );
}

function ValueCell({ value, mono, changed, ready }: { value: string; mono?: boolean; changed: boolean; ready: boolean }) {
  return (
    <td
      className={cn(
        "border-b px-3 py-2 align-top text-[12px] leading-snug transition-colors",
        LINE,
        changed ? "bg-amber-400/[0.07] group-hover:bg-amber-400/[0.11]" : "group-hover:bg-white/[0.03]",
      )}
    >
      {!ready ? (
        <span className="mt-0.5 block h-3 w-1/2 animate-pulse rounded bg-white/[0.05]" />
      ) : value ? (
        <span title={value} className={cn("line-clamp-3 break-words text-zinc-300", mono && "break-all font-mono text-[11px]")}>
          <span className={changed ? MARK : undefined}>{mono ? hostPath(value) : value}</span>
        </span>
      ) : (
        <span className={changed ? "text-amber-300/70" : "text-zinc-600"}>Not set</span>
      )}
    </td>
  );
}

/** Every head tag as a table: left page beside right page, row for row. A tag that differs is joined by a ribbon. */
export function MetaRows({ a, b, gutter }: { a: HeadSide; b: HeadSide; gutter: number }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const ready = !!(a.head && b.head);
  const rows = FIELDS.map((f) => {
    const left = a.head ? f.get(a.head) : "";
    const right = b.head ? f.get(b.head) : "";
    return { ...f, left, right, changed: ready && !same(left, right) };
  }).filter((r) => r.left || r.right || !ready);
  const diffs = rows.filter((r) => r.changed).length;
  const shown = onlyDiff && diffs > 0 ? rows.filter((r) => r.changed) : rows;
  const cols = { gridTemplateColumns: `minmax(0,1fr) ${gutter}px minmax(0,1fr)` };
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tagW = tagWidth(Math.max(0, (width - gutter) / 2));

  return (
    <div ref={root} className="relative h-full">
      {/* The two panels behind the table, and their outlines in front of it, so the rows never cover an edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 grid" style={cols}>
        <div className="rounded-xl bg-zinc-950" />
        <div />
        <div className="rounded-xl bg-zinc-950" />
      </div>
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden rounded-xl [mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
          <colgroup>
            <col style={{ width: tagW }} />
            <col />
            <col style={{ width: gutter }} />
            <col style={{ width: tagW }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <Th className="rounded-tl-xl border-r">Tag</Th>
              <Th className="rounded-tr-xl">Value</Th>
              <th aria-hidden className="sticky top-0 z-10 bg-[#08080a]" />
              <Th className="rounded-tl-xl border-r">Tag</Th>
              <Th className="rounded-tr-xl pr-2">
                <span className="flex items-center justify-between gap-2">
                  Value
                  {ready &&
                    (diffs > 0 ? (
                      <button
                        type="button"
                        aria-pressed={onlyDiff}
                        title="Show only the tags that differ"
                        onClick={() => setOnlyDiff((v) => !v)}
                        className={cn(
                          "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/30",
                          onlyDiff ? "border-amber-400/50 bg-amber-400/15 text-amber-100" : "border-white/10 text-zinc-300 hover:bg-white/[0.06]",
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-amber-300" />
                        {diffs === 1 ? "1 difference" : `${diffs} differences`}
                      </button>
                    ) : (
                      <span className="inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-2 text-[11px] font-medium text-zinc-300">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        No differences
                      </span>
                    ))}
                </span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.label} className="group">
                <TagCell label={r.label} changed={r.changed} />
                <ValueCell value={r.left} mono={r.mono} changed={r.changed} ready={!!a.head} />
                <td aria-hidden className="p-0">
                  {r.changed && <div className={cn("h-full w-full", RIBBON)} />}
                </td>
                <TagCell label={r.label} changed={r.changed} />
                <ValueCell value={r.right} mono={r.mono} changed={r.changed} ready={!!b.head} />
              </tr>
            ))}
            {ready && shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-zinc-500">
                  This page declares no metadata.
                </td>
              </tr>
            )}
            <tr aria-hidden>
              <td colSpan={5} className="h-4 p-0" />
            </tr>
          </tbody>
        </table>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 grid" style={cols}>
        <div className={BOX} />
        <div />
        <div className={BOX} />
      </div>
    </div>
  );
}
