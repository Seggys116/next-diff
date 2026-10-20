import { cn } from "@/lib/utils";

export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2.5", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <defs>
          <clipPath id="rbd-logo-a">
            <rect x="2.5" y="4.5" width="12" height="15" rx="3.5" />
          </clipPath>
        </defs>
        <rect x="2.5" y="4.5" width="12" height="15" rx="3.5" className="fill-rose-400/20 stroke-rose-300" strokeWidth="1.3" />
        <rect x="9.5" y="4.5" width="12" height="15" rx="3.5" className="fill-emerald-400/20 stroke-emerald-300" strokeWidth="1.3" />
        <rect x="9.5" y="4.5" width="12" height="15" rx="3.5" clipPath="url(#rbd-logo-a)" className="fill-white/60" />
      </svg>
      {wordmark && <span className="text-[14px] font-semibold tracking-[-0.02em] text-zinc-100">diff</span>}
    </div>
  );
}
