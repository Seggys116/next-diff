"use client";

import { useSyncExternalStore } from "react";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const LINE_HEIGHT = 1.2;
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

function DigitColumn({ digit, animate }: { digit: number; animate: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", overflow: "hidden", height: `${LINE_HEIGHT}em`, width: "1ch", lineHeight: LINE_HEIGHT }}
    >
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          // Percentages resolve against this stack's own height (10 rows), so one digit is 10%.
          transform: `translateY(-${digit * 10}%)`,
          transition: animate ? "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} style={{ display: "block", height: `${LINE_HEIGHT}em`, textAlign: "center" }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function AnimatedNumber({
  value,
  suffix = "",
  size = 12,
  weight = 600,
  className,
}: {
  value: number;
  suffix?: string;
  size?: number;
  weight?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const int = Number.isFinite(value) ? Math.round(value) : 0;
  const digits = String(Math.abs(int)).split("").map(Number);

  return (
    <span
      role="img"
      aria-label={`${value}${suffix}`}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: size,
        fontWeight: weight,
        lineHeight: LINE_HEIGHT,
        color: "currentColor",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {int < 0 && <span aria-hidden="true">-</span>}
      {/* Keyed from the right so the ones column keeps its identity when the digit count changes. */}
      {digits.map((digit, i) => (
        <DigitColumn key={digits.length - 1 - i} digit={digit} animate={!reduced} />
      ))}
      {suffix && <span aria-hidden="true">{suffix}</span>}
    </span>
  );
}
