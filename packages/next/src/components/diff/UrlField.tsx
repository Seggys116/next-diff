"use client";

import { AnimatePresence, motion, useAnimate } from "motion/react";
import { CornerDownLeft } from "lucide-react";
import { useRef, useState } from "react";
import { isLocalHost, normalizeUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Favicon } from "./Favicon";
import { EASE } from "./ui";
import type { PaneId, PaneState } from "./usePane";

function shorten(u: string) {
  try {
    const x = new URL(u);
    return x.host + (x.pathname === "/" ? "" : x.pathname) + x.search + x.hash;
  } catch {
    return u;
  }
}

export function UrlField({
  id,
  state,
  onSubmit,
  readOnly = false,
  leading,
}: {
  id: PaneId;
  state: PaneState;
  onSubmit: (raw: string) => void;
  /** Shows the address but doesn't let it be edited (devtools: the environments decide the origin). */
  readOnly?: boolean;
  leading?: React.ReactNode;
}) {
  const shown = state.current || state.requested;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [scope, shake] = useAnimate();
  const loading = state.status === "registering" || state.status === "loading";

  const submit = () => {
    const n = normalizeUrl(draft ?? "");
    if (!n.ok) {
      setError(n.error ?? "Invalid URL");
      shake(scope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4 });
      return;
    }
    setDraft(null);
    input.current?.blur();
    onSubmit(n.url);
  };

  let local = false;
  try {
    local = isLocalHost(new URL(shown).hostname);
  } catch {}

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay: id === "a" ? 0.25 : 0.35 }}
      className="relative min-w-0 flex-1"
    >
      <div ref={scope}>
        <div
          className={cn(
            "group relative flex h-9 items-center gap-2 rounded-xl border bg-white/[0.04] pl-2 pr-1.5 transition-[border-color,background-color,box-shadow] duration-200",
            error ? "border-rose-400/50" : "border-white/[0.08] focus-within:border-white/25 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.04)]",
          )}
        >
          {leading}
          <Favicon src={state.icon} size={18} />
          <input
            ref={input}
            readOnly={readOnly}
            value={draft ?? shorten(shown)}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onFocus={(e) => {
              if (readOnly) return;
              setDraft(shown);
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => {
              setDraft(null);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !readOnly) submit();
              if (e.key === "Escape") {
                setDraft(null);
                input.current?.blur();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`URL for page ${id.toUpperCase()}`}
            placeholder="Enter a URL"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {local && !readOnly && draft === null && <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">local</span>}
          <AnimatePresence>
            {draft !== null && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-1 text-[10px] font-medium text-zinc-300"
              >
                <CornerDownLeft className="size-3" /> Go
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {loading && (
              <motion.span
                key="bar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-3 -bottom-px h-px overflow-hidden"
              >
                <span className="rbd-indeterminate absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-2 top-full z-50 mt-1.5 rounded-md bg-rose-500/90 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
