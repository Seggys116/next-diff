"use client";

export type StatusDotStatus = "pending" | "running" | "done" | "failed";

const CSS = `
@keyframes diff-dot-spin { to { transform: rotate(360deg); } }
@keyframes diff-dot-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.diff-dot-arc { transform-origin: center; transform-box: fill-box; animation: diff-dot-spin 0.9s linear infinite; }
.diff-dot-glyph { stroke-dasharray: 1; stroke-dashoffset: 0; animation: diff-dot-draw 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .diff-dot-arc { animation: none; }
  .diff-dot-glyph { animation: none; }
}
`;

export function StatusDot({
  status,
  size = 16,
  strokeWidth = 1.5,
  color = "currentColor",
  doneColor = "#34d399",
  errorColor = "#fb7185",
  className,
}: {
  status: StatusDotStatus;
  size?: number;
  strokeWidth?: number;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  className?: string;
}) {
  const c = size / 2;
  const r = Math.max(0, (size - strokeWidth) / 2);
  const circumference = 2 * Math.PI * r;
  const accent = status === "done" ? doneColor : status === "failed" ? errorColor : color;
  const p = (n: number) => n * size;

  return (
    <svg
      role="img"
      aria-label={status}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      className={className}
      style={{ display: "inline-block", flexShrink: 0 }}
    >
      <style>{CSS}</style>
      <circle
        cx={c}
        cy={c}
        r={r}
        stroke={accent}
        strokeWidth={strokeWidth}
        opacity={status === "pending" || status === "running" ? 0.3 : 0.45}
        style={{ transition: "stroke 0.25s ease, opacity 0.25s ease" }}
      />
      {status === "running" && (
        <circle
          className="diff-dot-arc"
          cx={c}
          cy={c}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.28} ${circumference}`}
        />
      )}
      {status === "done" && (
        <path
          className="diff-dot-glyph"
          pathLength={1}
          d={`M${p(0.3)} ${p(0.52)} L${p(0.44)} ${p(0.66)} L${p(0.71)} ${p(0.36)}`}
          stroke={doneColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === "failed" && (
        <path
          className="diff-dot-glyph"
          pathLength={1}
          d={`M${p(0.36)} ${p(0.36)} L${p(0.64)} ${p(0.64)} M${p(0.64)} ${p(0.36)} L${p(0.36)} ${p(0.64)}`}
          stroke={errorColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
