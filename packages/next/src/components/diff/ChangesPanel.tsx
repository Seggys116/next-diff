"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpDown, Check, ChevronDown, ChevronUp, Minus, Paintbrush, PenLine, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorToHex } from "@/lib/diff/engine";
import type { Block, ChangeStatus, DiffResult, Pair, StyleChange } from "@/lib/diff/types";
import { cn } from "@/lib/utils";
import { CountUp, EASE, IconButton } from "./ui";

export type PanelFilter = "all" | Exclude<ChangeStatus, "same">;

export const STATUS_META: Record<Exclude<ChangeStatus, "same">, { label: string; text: string; bg: string; ring: string; dot: string; icon: typeof Plus }> = {
  added: { label: "Added", text: "text-emerald-300", bg: "bg-emerald-400/10", ring: "ring-emerald-400/30", dot: "bg-emerald-400", icon: Plus },
  removed: { label: "Removed", text: "text-rose-300", bg: "bg-rose-400/10", ring: "ring-rose-400/30", dot: "bg-rose-400", icon: Minus },
  changed: { label: "Changed", text: "text-amber-300", bg: "bg-amber-400/10", ring: "ring-amber-400/30", dot: "bg-amber-400", icon: PenLine },
  restyled: { label: "Restyled", text: "text-violet-300", bg: "bg-violet-400/10", ring: "ring-violet-400/30", dot: "bg-violet-400", icon: Paintbrush },
  moved: { label: "Moved", text: "text-sky-300", bg: "bg-sky-400/10", ring: "ring-sky-400/30", dot: "bg-sky-400", icon: ArrowUpDown },
};

const ORDER: Exclude<ChangeStatus, "same">[] = ["changed", "added", "removed", "restyled", "moved"];

const KIND_LABEL: Record<string, string> = {
  heading: "Heading",
  text: "Text",
  "list-item": "List item",
  link: "Link",
  button: "Button",
  image: "Image",
  graphic: "Graphic",
  media: "Media",
  input: "Field",
};
const REGION_LABEL: Record<string, string> = {
  header: "Header",
  nav: "Navigation",
  main: "Main",
  section: "Section",
  footer: "Footer",
  aside: "Sidebar",
  article: "Article",
  form: "Form",
  search: "Search",
};

export function kindLabel(b: Block): string {
  if (b.kind === "region") return REGION_LABEL[b.rt ?? ""] ?? "Section";
  if (b.kind === "heading" && b.lvl) return `H${b.lvl}`;
  return KIND_LABEL[b.kind] ?? b.kind;
}

export function isVisibleChange(p: Pair): boolean {
  if (p.status === "same" || p.parent) return false;
  const kind = (p.a ?? p.b)?.kind;
  if (kind === "region") return p.status === "added" || p.status === "removed";
  return true;
}

function preview(b: Block | undefined): string {
  if (!b) return "";
  if (b.kind === "region") return b.text || `${REGION_LABEL[b.rt ?? ""] ?? "Section"} with no heading`;
  if (b.kind === "image" || b.kind === "graphic" || b.kind === "media") {
    return b.alt || (b.raw ? b.raw.split("/").pop()?.split("?")[0] : "") || b.src || "";
  }
  return b.text || b.alt || "";
}

export interface ChangesPanelProps {
  diff: DiffResult | null;
  waiting: boolean;
  selectedId: string | null;
  onSelect: (p: Pair) => void;
  onClear: () => void;
  filter: PanelFilter;
  onFilter: (f: PanelFilter) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
  highlightsOn: boolean;
  onToggleHighlights: () => void;
}

export function ChangesPanel({ diff, waiting, selectedId, onSelect, onClear, filter, onFilter, onStep, onClose, highlightsOn, onToggleHighlights }: ChangesPanelProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const regionNames = useMemo(() => {
    const m = new Map<string, string>();
    if (!diff) return m;
    for (const p of diff.pairs) {
      if (p.a?.kind === "region" && p.a.text) m.set(`a:${p.a.id}`, p.a.text);
      if (p.b?.kind === "region" && p.b.text) m.set(`b:${p.b.id}`, p.b.text);
    }
    return m;
  }, [diff]);

  const visible = useMemo(() => (diff ? diff.pairs.filter(isVisibleChange) : []), [diff]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: visible.length };
    for (const p of visible) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [visible]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      return (preview(p.a) + " " + preview(p.b)).toLowerCase().includes(q);
    });
  }, [visible, filter, query]);

  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pair="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const stats = diff?.stats;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0 border-b border-white/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-300">Changes</h2>
          <div className="flex items-center gap-0.5">
            <IconButton label="Previous change (K)" onClick={() => onStep(-1)} className="size-7">
              <ChevronUp className="size-4" />
            </IconButton>
            <IconButton label="Next change (J)" onClick={() => onStep(1)} className="size-7">
              <ChevronDown className="size-4" />
            </IconButton>
            <IconButton label="Hide panel" onClick={onClose} className="size-7">
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        {stats ? (
          <div className="flex items-center gap-4">
            <Ring value={stats.similarity} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <CountUp value={stats.similarity} suffix="%" size={28} className="text-zinc-50" />
                <span className="text-[12px] text-zinc-500">match</span>
              </div>
              <p className="mt-1 text-[11.5px] text-zinc-500">
                {diff?.topLevel ?? 0} {diff?.topLevel === 1 ? "change" : "changes"} across {stats.total} elements
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="size-14 animate-pulse rounded-full bg-white/[0.05]" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-20 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
            </div>
          </div>
        )}

        {stats && stats.total > 0 && (
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            {([["same", "bg-zinc-600/60", stats.same], ...ORDER.map((k) => [k, STATUS_META[k].dot, stats[k]] as const)] as const).map(([k, cls, n]) => (
              <motion.div
                key={k}
                className={cls}
                initial={{ width: 0 }}
                animate={{ width: `${(n / stats.total) * 100}%` }}
                transition={{ duration: 0.8, ease: EASE }}
              />
            ))}
          </div>
        )}
      </div>

      {diff && (diff.unrelated || diff.crowded) && (
        <div className="mx-4 mt-3 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <p className="text-[12.5px] font-medium text-zinc-200">
            {diff.unrelated ? "These pages are mostly different" : `${diff.topLevel} changes is a lot to outline`}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
            {diff.unrelated
              ? "Almost nothing lines up, so marking every element would just be noise. Highlights are off; the list below still shows what differs."
              : "Marking each one would cover the page, so highlights start off. Filter the list to a kind of change, then turn them on."}
          </p>
          <button
            type="button"
            onClick={onToggleHighlights}
            className="mt-2.5 inline-flex h-7 items-center rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-[11.5px] font-medium text-zinc-200 outline-none transition hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/30"
          >
            {highlightsOn ? "Turn highlights off" : "Show highlights anyway"}
          </button>
        </div>
      )}

      <div className="shrink-0 space-y-2.5 border-b border-white/[0.06] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "all"} onClick={() => onFilter("all")} count={counts.all ?? 0}>
            All
          </Chip>
          {ORDER.map((k) =>
            counts[k] ? (
              <Chip key={k} active={filter === k} onClick={() => onFilter(k)} count={counts[k]} dot={STATUS_META[k].dot}>
                {STATUS_META[k].label}
              </Chip>
            ) : null,
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter changes"
            className="h-8 w-full rounded-lg border border-white/[0.07] bg-white/[0.03] pl-8 pr-8 text-[12.5px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/20 focus:bg-white/[0.05]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-zinc-500 hover:text-zinc-200"
            >
              <X className="size-3" />
            </button>
          )}
        </label>
      </div>

      <div ref={listRef} onClick={(e) => e.target === e.currentTarget && onClear()} className="rbd-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {!diff ? (
          <Skeletons waiting={waiting} />
        ) : visible.length === 0 ? (
          <Identical />
        ) : items.length === 0 ? (
          <p className="px-3 py-10 text-center text-[12.5px] text-zinc-500">Nothing matches that filter.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((p, i) => (
              <ChangeItem
                key={p.id}
                pair={p}
                index={i}
                selected={p.id === selectedId}
                onClick={() => onSelect(p)}
                region={regionNames.get(p.b ? `b:${p.b.reg}` : `a:${p.a?.reg}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const hue = value > 90 ? "stroke-emerald-400" : value > 60 ? "stroke-amber-300" : "stroke-rose-400";
  return (
    <svg viewBox="0 0 60 60" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="30" cy="30" r={r} className="fill-none stroke-white/[0.07]" strokeWidth="5" />
      <motion.circle
        cx="30"
        cy="30"
        r={r}
        className={cn("fill-none transition-colors duration-500", hue)}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 100) }}
        transition={{ duration: 1, ease: EASE }}
      />
    </svg>
  );
}

function Chip({ active, onClick, children, count, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; count: number; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/30",
        active ? "border-white/20 bg-white/[0.1] text-zinc-50" : "border-white/[0.07] bg-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
      {children}
      <span className="tabular-nums text-zinc-500">{count}</span>
    </button>
  );
}

function ChangeItem({ pair, index, selected, onClick, region }: { pair: Pair; index: number; selected: boolean; onClick: () => void; region?: string }) {
  const status = pair.status as Exclude<ChangeStatus, "same">;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const block = (pair.b ?? pair.a)!;
  return (
    <motion.li
      data-pair={pair.id}
      initial={index < 16 ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE, delay: Math.min(index, 14) * 0.03 }}
      className="[content-visibility:auto] [contain-intrinsic-size:auto_76px]"
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex w-full gap-2.5 rounded-xl border border-transparent px-2.5 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-white/[0.04] focus-visible:border-white/20",
          selected && "border-white/10 bg-white/[0.06]",
        )}
      >
        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md", meta.bg, meta.text)}>
          <Icon className="size-3" strokeWidth={2.5} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
            <span className={meta.text}>{meta.label}</span>
            <span aria-hidden>·</span>
            <span>{kindLabel(block)}</span>
            {pair.count ? (
              <>
                <span aria-hidden>·</span>
                <span>{pair.count + 1} elements</span>
              </>
            ) : region ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{region}</span>
              </>
            ) : null}
          </span>
          <Body pair={pair} />
        </span>
      </button>
    </motion.li>
  );
}

function Body({ pair }: { pair: Pair }) {
  if (pair.status === "changed" && pair.segs) {
    return (
      <span className="mt-1 line-clamp-3 block text-[12.5px] leading-snug text-zinc-300">
        {pair.segs.map((s, i) =>
          s.t === "eq" ? (
            <span key={i}>{s.s} </span>
          ) : s.t === "del" ? (
            <span key={i} className="rounded-[3px] bg-rose-400/15 px-0.5 text-rose-200 line-through decoration-rose-300/50">
              {s.s}{" "}
            </span>
          ) : (
            <span key={i} className="rounded-[3px] bg-emerald-400/15 px-0.5 text-emerald-200">
              {s.s}{" "}
            </span>
          ),
        )}
      </span>
    );
  }
  if (pair.status === "changed") {
    return (
      <span className="mt-1 block space-y-0.5 text-[12px] leading-snug">
        <span className="line-clamp-1 block text-rose-200/80 line-through decoration-rose-300/40">{preview(pair.a) || "(empty)"}</span>
        <span className="line-clamp-1 block text-emerald-200">{preview(pair.b) || "(empty)"}</span>
      </span>
    );
  }
  if (pair.status === "restyled" && pair.styles) {
    return (
      <span className="mt-1 block">
        <span className="line-clamp-1 block text-[12.5px] text-zinc-300">{preview(pair.b) || preview(pair.a) || "Element"}</span>
        <span className="mt-1.5 flex min-w-0 flex-wrap gap-1">
          {pair.styles.slice(0, 4).map((s) => (
            <StyleChip key={s.prop} change={s} />
          ))}
          {pair.styles.length > 4 && <span className="px-1 text-[11px] text-zinc-500">+{pair.styles.length - 4}</span>}
        </span>
      </span>
    );
  }
  const text = preview(pair.b ?? pair.a);
  return (
    <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug text-zinc-300">
      {text || <span className="text-zinc-500">Unlabelled element</span>}
    </span>
  );
}

function StyleChip({ change }: { change: StyleChange }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-zinc-400">
      <span className="text-zinc-500">{change.label}</span>
      {change.swatch && <span className="size-2.5 rounded-sm ring-1 ring-white/20" style={{ background: change.a }} />}
      <span className="font-mono text-zinc-300">{change.swatch ? colorToHex(change.a) : change.a}</span>
      <span className="text-zinc-600">→</span>
      {change.swatch && <span className="size-2.5 rounded-sm ring-1 ring-white/20" style={{ background: change.b }} />}
      <span className="font-mono text-zinc-200">{change.swatch ? colorToHex(change.b) : change.b}</span>
    </span>
  );
}

function Skeletons({ waiting }: { waiting: boolean }) {
  return (
    <div className="space-y-2 p-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-2.5 rounded-xl p-2.5" style={{ opacity: 1 - i * 0.16 }}>
          <div className="size-5 animate-pulse rounded-md bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
      <p className="pt-3 text-center text-[11.5px] text-zinc-500">{waiting ? "Waiting for both pages to finish loading…" : "Comparing…"}</p>
    </div>
  );
}

function Identical() {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="flex flex-col items-center px-6 py-14 text-center"
      >
        <div className="mb-4 grid size-11 place-items-center rounded-full bg-emerald-400/10 text-emerald-300 ring-8 ring-emerald-400/[0.05]">
          <Check className="size-5" strokeWidth={2.5} />
        </div>
        <h3 className="text-[14px] font-semibold text-zinc-100">No differences found</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">Content, media and styling match across both pages.</p>
      </motion.div>
    </AnimatePresence>
  );
}
