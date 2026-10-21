"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { REVISION_STEPS, UPDATE_STEPS } from "@/lib/git/types";
import { cn } from "@/lib/utils";
import { ago } from "./GitBar";
import { EASE } from "./ui";
import type { GitScrub } from "./useGit";

const START = [...REVISION_STEPS, "Open the page"];
const UPDATE = [...UPDATE_STEPS, "Open the page"];

/** A switch on a running server is usually quick; only show the overlay when it is not. */
const QUICK_MS = 600;

/** Over the left pane while it moves to another commit: the page underneath stays visible, blurred, until the new one is in. */
export function TimeTravel({ git }: { git: GitScrub }) {
  const { commit, index, status } = git;
  const sha = commit?.sha ?? "";
  const failed = status?.state === "error";
  const update = !!status?.update;
  const STEPS = update ? UPDATE : START;
  // Waiting counts as the first step: nothing has been asked of the server yet.
  const current = status ? (status.state === "ready" ? STEPS.length - 1 : status.step) : 0;

  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const t0 = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sha]);

  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    const t = setTimeout(() => setLate(true), QUICK_MS);
    return () => clearTimeout(t);
  }, [sha]);

  if (!commit || (!late && !failed && (update || !status))) return null;
  return (
    <motion.div
      className="absolute inset-0 z-20 grid place-items-center bg-zinc-950/75 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="w-[min(340px,86%)]">
        <p className="text-[11px] text-zinc-500">{index === 0 ? "Latest commit" : `${index} ${index === 1 ? "commit" : "commits"} back`}</p>
        <p className="mt-2 flex items-baseline gap-2">
          <code className="shrink-0 font-mono text-[12px] text-zinc-500">{commit.short}</code>
          <span className="line-clamp-2 text-[15px] font-medium leading-snug text-zinc-100">{commit.subject || "(no message)"}</span>
        </p>
        <p className="mt-1 text-[11.5px] text-zinc-500">
          {commit.author} · {ago(commit.date)}
        </p>

        <div className="mt-5 flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cn("relative h-[3px] flex-1 overflow-hidden rounded-full", failed && i === current ? "bg-rose-400/70" : i < current ? "bg-zinc-200" : "bg-white/10")}>
              {i === current && !failed && <span className="rbd-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-zinc-200" />}
            </span>
          ))}
        </div>

        {failed ? (
          <div className="mt-4 space-y-3">
            <p className="text-[12.5px] font-medium text-rose-300">{status?.error?.title ?? "Couldn’t start that version"}</p>
            {status?.error?.message && <p className="line-clamp-5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-snug text-zinc-500">{status.error.message}</p>}
            <button
              type="button"
              onClick={git.retry}
              className="inline-flex h-7 items-center rounded-md bg-white/[0.08] px-2.5 text-[11.5px] font-medium text-zinc-100 outline-none transition-colors hover:bg-white/[0.13] focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Try again
            </button>
          </div>
        ) : (
          <ul className="mt-4 space-y-1.5">
            {STEPS.map((label, i) => (
              <li key={label} className={cn("flex items-center gap-2.5 text-[12px]", i < current ? "text-zinc-500" : i === current ? "text-zinc-100" : "text-zinc-600")}>
                <span className="grid size-3.5 shrink-0 place-items-center">
                  {i < current ? <Check className="size-3.5" /> : <span className={cn("size-1.5 rounded-full", i === current ? "animate-pulse bg-amber-300" : "bg-white/15")} />}
                </span>
                <span className="flex-1">{label}</span>
                {i === current && seconds >= 2 && <span className="font-mono text-[11px] tabular-nums text-zinc-500">{seconds}s</span>}
              </li>
            ))}
          </ul>
        )}
        {!failed && !update && current === 3 && seconds >= 8 && <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">A fresh dev server compiles your app from scratch. This is the slow part.</p>}
      </div>
    </motion.div>
  );
}
