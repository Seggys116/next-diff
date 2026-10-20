"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./primitives/CountUp";
import { SegmentedControl } from "./primitives/SegmentedControl";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const EASE_SOFT = [0.4, 0, 0.2, 1] as const;

export function Tip({ label, children, side = "bottom", className }: { label: ReactNode; children: ReactNode; side?: "bottom" | "top"; className?: string }) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-900/95 px-2 py-1 text-[11px] font-medium text-zinc-200 opacity-0 shadow-lg backdrop-blur transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:delay-500",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-[10px] font-medium text-zinc-400",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function IconButton({
  active,
  className,
  children,
  label,
  tip = true,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string; tip?: boolean }) {
  const btn = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      {...props}
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 outline-none transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-40",
        active && "bg-white/[0.08] text-zinc-50",
        className,
      )}
    >
      {children}
    </button>
  );
  return tip ? <Tip label={label}>{btn}</Tip> : btn;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label?: string; icon?: ReactNode; hint?: string; labelClass?: string }[];
  className?: string;
  /** Kept for call sites; the control has a single compact size. */
  size?: "sm" | "md";
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={(v) => onChange(v)}
      className={cn("border border-white/[0.07]", className)}
      items={options.map((o) => ({
        value: o.id,
        label: o.label ? <span title={o.hint} className={o.labelClass}>{o.label}</span> : undefined,
        title: o.hint,
        icon: o.icon ? <span title={o.hint} className="inline-flex">{o.icon}</span> : undefined,
      }))}
    />
  );
}

export function Menu({
  trigger,
  children,
  align = "left",
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: EASE }}
            className={cn(
              "absolute top-full z-50 mt-2 min-w-[220px] origin-top rounded-xl border border-white/10 bg-zinc-900/95 p-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl",
              align === "right" ? "right-0" : "left-0",
              className,
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06]",
        active && "bg-white/[0.05]",
      )}
    >
      <span className="mt-0.5 text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-zinc-100">{title}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{hint}</span>}
      </span>
      {active && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-100" />}
    </button>
  );
}

export function CountUp({ value, className, suffix = "", size = 12, weight = 600 }: { value: number; className?: string; suffix?: string; size?: number; weight?: number }) {
  return (
    <AnimatedNumber value={value} suffix={suffix} size={size} weight={weight} className={cn("inline-flex", className)} />
  );
}
