"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, X } from "lucide-react";
import { createContext, useContext } from "react";
import type { GitHistory, RevisionStatus } from "@/lib/git/types";
import { cn } from "@/lib/utils";
import type { PaneId } from "./backend";
import { GitLogo } from "./GitLogo";
import { Tip } from "./ui";

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** While your page shrinks into the local slot, report that rect, hold the entrance, and leave the slot empty until our copy is showing. */
export interface Handoff {
  /** False until the page has started shrinking: the viewer holds its entrance until then. */
  entered: boolean;
  /** How far down the page you were. The viewer scrolls its own copies to the same place once they have loaded. */
  scrollY?: number;
  /** Your page has finished shrinking into the slot. Until then the viewer's own copy of it stays hidden. */
  landed: boolean;
  /** The pane whose slot your page is shrinking into, until it has been replaced by the viewer's own copy. */
  ghost: PaneId | null;
  /** The pane that is your local site. Its screen position is reported for as long as the viewer is open. */
  slot?: PaneId | null;
  onLayout?: (rect: PaneRect, radius: number) => void;
  /** The viewer's own copy of the page has loaded and is showing: the slot no longer needs to stay empty. */
  onGhostDone?: () => void;
}

export const HandoffContext = createContext<Handoff>({ entered: true, landed: true, ghost: null });
export const useHandoff = () => useContext(HandoffContext);

export interface Environment {
  id: string;
  label: string;
  origin: string;
  hint?: string;
}

/** How the viewer reaches the project's Git history and the temporary server that shows one commit of it. */
export interface GitApi {
  history(): Promise<GitHistory>;
  /** Begin serving a commit, or keep serving it. Returns at once; `poll` follows the progress. */
  start(sha: string): Promise<RevisionStatus>;
  poll(): Promise<RevisionStatus | null>;
  /** Shut the temporary server down and delete its files. */
  stop(): void;
}

export interface DevtoolsOptions {
  environments: Environment[];
  /** Present when the project is in a Git repository: the left pane can show a past commit instead of live. */
  git?: GitApi;
  /** The size of the browser window the viewer was opened from. Offered, and used first, as a device. */
  window?: { w: number; h: number };
  onClose: (path: string) => void;
}

export function envOf(environments: Environment[], url: string): Environment | undefined {
  try {
    const origin = new URL(url).origin;
    return environments.find((e) => e.origin === origin);
  } catch {
    return undefined;
  }
}

const DOT: Record<string, string> = {
  live: "bg-emerald-400",
  local: "bg-amber-300",
};

export function EnvTag({ env }: { env: Environment | undefined }) {
  return (
    <span className="inline-flex h-6 w-[58px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-white/[0.07] text-[11px] font-semibold text-zinc-100">
      <span className={cn("size-1.5 rounded-full", DOT[env?.id ?? ""] ?? "bg-zinc-400")} />
      {env?.label ?? "Page"}
    </span>
  );
}

export type Source = "live" | "git";

/** The left pane's tag, as a switch: live site, or the project's Git history. */
export function SourceTag({ source, onToggle, live }: { source: Source; onToggle: () => void; live: Environment | undefined }) {
  return (
    <Tip label={source === "live" ? "Compare against Git history instead" : `Back to ${live?.hint?.split(" · ")[0]?.trim().toLowerCase() || "the live site"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={source === "live" ? "Switch the left side to Git history" : "Switch the left side back to the live site"}
        className="group relative inline-flex h-6 w-[74px] shrink-0 items-center justify-between rounded-md bg-white/[0.07] pl-2 pr-1.5 text-[11px] font-semibold text-zinc-100 outline-none transition-colors hover:bg-white/[0.13] focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <span className="relative h-full min-w-0 flex-1">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={source}
              initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex items-center gap-1.5"
            >
              {source === "live" ? (
                <>
                  <span className={cn("size-1.5 rounded-full", DOT.live)} />
                  {live?.label ?? "Live"}
                </>
              ) : (
                <>
                  <GitLogo />
                  Git
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        <ArrowLeftRight className="size-3 shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-200" />
      </button>
    </Tip>
  );
}

export function ExitButton({ onClick }: { onClick: () => void }) {
  return (
    <Tip label="Back to the site" side="bottom">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] pl-2.5 pr-2 text-[12px] font-medium text-zinc-200 outline-none transition hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-white/30"
      >
        Exit diff
        <X className="size-3.5 text-zinc-400" />
      </button>
    </Tip>
  );
}
