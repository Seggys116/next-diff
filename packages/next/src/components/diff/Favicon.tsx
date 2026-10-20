"use client";

import { Globe } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Favicon of the previewed page, loaded from that site, never from a third-party icon service. */
export function Favicon({ src, size = 16, className }: { src: string; size?: number; className?: string }) {
  // Track which src failed rather than a boolean, so a new URL gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const ok = !!src && failed !== src;
  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-[5px]", className)}
      style={{ width: size, height: size }}
    >
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party origin, intentionally unoptimised
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className="size-full object-contain"
        />
      ) : (
        <Globe className="text-zinc-500" style={{ width: size * 0.8, height: size * 0.8 }} strokeWidth={1.6} />
      )}
    </span>
  );
}
