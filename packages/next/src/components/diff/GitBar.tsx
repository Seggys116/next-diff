"use client";

import { ChevronLeft, ChevronRight, History, LoaderCircle, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import type { GitCommit } from "@/lib/git/types";
import { cn } from "@/lib/utils";
import { IconButton, Menu } from "./ui";
import type { GitScrub } from "./useGit";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function ago(unix: number): string {
  const seconds = unix - Date.now() / 1000;
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "just now";
}

const when = (unix: number) => new Date(unix * 1000).toLocaleString();

/** Oldest on the left, newest on the right. Index 0 is the newest, so it sits at 100%. */
const place = (index: number, count: number) => (count > 1 ? ((count - 1 - index) / (count - 1)) * 100 : 100);

function Scrubber({ commits, index, onSelect, onPreview }: { commits: GitCommit[]; index: number; onSelect: (i: number) => void; onPreview: (i: number | null) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const count = commits.length;

  const at = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return index;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return count - 1 - Math.round(t * (count - 1));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Commit history"
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={count - 1 - index}
      aria-valuetext={commits[index] ? `${commits[index].short}: ${commits[index].subject}` : undefined}
      className="relative h-8 min-w-[140px] flex-1 cursor-pointer touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSelect(at(e.clientX));
      }}
      onPointerMove={(e) => {
        const i = at(e.clientX);
        onPreview(i);
        if (dragging.current) onSelect(i);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onPointerLeave={() => onPreview(null)}
      onKeyDown={(e) => {
        const to = e.key === "ArrowLeft" || e.key === "ArrowDown" ? index + 1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? count - 1 : e.key === "End" ? 0 : null;
        if (to === null) return;
        e.preventDefault();
        onSelect(Math.max(0, Math.min(count - 1, to)));
      }}
    >
      <div ref={track} className="absolute inset-x-2 inset-y-0">
        {commits.map((c, i) => (
          <span
            key={c.sha}
            className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", i === index ? "h-4 w-0.5 bg-zinc-100" : "h-2 w-px bg-white/20")}
            style={{ left: `${place(i, count)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function Dot({ tone }: { tone: "ok" | "busy" | "bad" }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-emerald-400" : tone === "bad" ? "bg-rose-400" : "animate-pulse bg-amber-300")} />;
}

function Status({ git }: { git: GitScrub }) {
  const s = git.status;
  const text = "flex h-8 max-w-[200px] shrink-0 items-center gap-2 px-1 text-[11.5px] text-zinc-500";
  if (!s) return <span className={text}><Dot tone="busy" /><span className="truncate">Starting</span></span>;
  if (s.state === "starting") return <span className={text}><Dot tone="busy" /><span className="truncate">{s.phase}</span></span>;
  if (s.state === "ready") return <span className={text} title="A temporary dev server is serving this commit. It stops when you switch commits or leave Git mode."><Dot tone="ok" />Ready</span>;
  return (
    <Menu
      align="right"
      className="w-[440px] max-w-[85vw]"
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open} className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[11.5px] text-rose-300 outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30">
          <Dot tone="bad" />
          Didn’t start
        </button>
      )}
    >
      {() => (
        <div className="space-y-2 p-2.5">
          <p className="text-[12.5px] font-semibold text-zinc-100">{s.error?.title ?? "Couldn’t start that version"}</p>
          {s.error?.message && <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-zinc-400">{s.error.message}</p>}
          {s.log.length > 0 && <pre className="max-h-44 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-zinc-400">{s.log.join("\n")}</pre>}
          <button type="button" onClick={git.retry} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white/[0.07] px-2.5 text-[11.5px] font-medium text-zinc-100 outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/30">
            <RotateCcw className="size-3.5" />
            Try again
          </button>
        </div>
      )}
    </Menu>
  );
}

function Picker({ commits, index, onPick }: { commits: GitCommit[]; index: number; onPick: (i: number) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = commits.map((c, i) => ({ c, i })).filter(({ c }) => !q || c.subject.toLowerCase().includes(q) || c.short.startsWith(q) || c.author.toLowerCase().includes(q));
  return (
    <div className="p-1">
      <label className="mb-1 flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-zinc-500 focus-within:border-white/25">
        <Search className="size-3.5 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a commit"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </label>
      <div className="max-h-[min(55vh,380px)] overflow-y-auto">
        {rows.length === 0 && <p className="px-2.5 py-3 text-[12px] text-zinc-500">No commit matches.</p>}
        {rows.map(({ c, i }) => (
          <button
            key={c.sha}
            type="button"
            onClick={() => onPick(i)}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06]", i === index && "bg-white/[0.07]")}
          >
            <code className="shrink-0 font-mono text-[11px] text-zinc-500">{c.short}</code>
            <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{c.subject || "(no message)"}</span>
            <span className="shrink-0 text-[11px] text-zinc-500">{ago(c.date)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Scrub through the project's history: the left pane shows the commit you stop on, the right pane stays your working tree. */
export function GitBar({ git }: { git: GitScrub }) {
  const [hover, setHover] = useState<number | null>(null);
  const { history, commit, index } = git;

  if (git.historyError) {
    return (
      <div className="flex h-11 items-center gap-3 px-3 text-[12px] text-zinc-400">
        <TriangleAlert className="size-4 shrink-0 text-rose-300" />
        <span className="min-w-0 truncate">{git.historyError}</span>
        <button type="button" onClick={git.retryHistory} className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 font-medium text-zinc-100 outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/30">
          Try again
        </button>
      </div>
    );
  }
  if (!history || !commit) {
    return (
      <div className="flex h-11 items-center gap-1.5 px-3 text-[12px] text-zinc-500">
        <LoaderCircle className="size-4 animate-spin" />
        Reading the Git history…
      </div>
    );
  }

  const shown = history.commits[hover ?? index] ?? commit;
  const shownIndex = hover ?? index;
  const last = history.commits.length - 1;

  return (
    <div className="flex h-11 items-center gap-1.5 px-3">
      <IconButton label="Older commit ([)" onClick={() => git.step(1)} disabled={index >= last}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <IconButton label="Newer commit (])" onClick={() => git.step(-1)} disabled={index <= 0}>
        <ChevronRight className="size-4" />
      </IconButton>

      <Scrubber commits={history.commits} index={index} onSelect={git.select} onPreview={setHover} />

      <p className="hidden min-w-0 basis-[40%] items-baseline gap-2 truncate text-[12px] md:flex">
        <code className="shrink-0 font-mono text-[11px] text-zinc-500">{shown.short}</code>
        <span className="min-w-0 truncate text-zinc-200" title={shown.subject}>
          {shown.subject || "(no message)"}
        </span>
        <span className="shrink-0 text-zinc-500" title={when(shown.date)}>
          {shown.author} · {ago(shown.date)}
          {shownIndex === 0 && history.repo.dirty && " · plus uncommitted changes on Local"}
        </span>
      </p>

      <Status git={git} />

      <Menu
        align="right"
        className="w-[460px] max-w-[85vw]"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label="All commits"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 outline-none transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <History className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <Picker
            commits={history.commits}
            index={index}
            onPick={(i) => {
              git.select(i);
              close();
            }}
          />
        )}
      </Menu>
    </div>
  );
}
