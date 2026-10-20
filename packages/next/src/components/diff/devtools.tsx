"use client";

import { X } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import type { PaneId } from "./backend";
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

export interface DevtoolsOptions {
  environments: Environment[];
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
