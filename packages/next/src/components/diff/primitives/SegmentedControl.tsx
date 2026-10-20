"use client";

import { MotionConfig, motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedItem<T extends string> = { value: T; label?: ReactNode; icon?: ReactNode; title?: string };

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel = "Segmented control",
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T, index: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const layoutId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, items.findIndex((it) => it.value === value));

  const move = (index: number) => {
    const next = (index + items.length) % items.length;
    onChange(items[next].value, next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        return move(activeIndex + 1);
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        return move(activeIndex - 1);
      case "Home":
        e.preventDefault();
        return move(0);
      case "End":
        e.preventDefault();
        return move(items.length - 1);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn("relative inline-flex items-center gap-0.5 rounded-[10px] bg-white/[0.045] p-0.5", className)}
      >
        {items.map((it, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={it.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={it.title}
              title={it.title}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(it.value, i)}
              className={cn(
                "relative inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-white/30",
                active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[8px] bg-white/[0.12]"
                  transition={{ type: "spring", stiffness: 520, damping: 38 }}
                />
              )}
              {it.icon && <span className="relative inline-flex">{it.icon}</span>}
              {it.label && <span className="relative">{it.label}</span>}
            </button>
          );
        })}
      </div>
    </MotionConfig>
  );
}
