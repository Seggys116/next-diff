"use client";

import { useEffect, useRef, useState } from "react";
import { diffSnapshots } from "./engine";
import type { DiffResult, PageSnapshot } from "./types";

interface Computed {
  a: PageSnapshot;
  b: PageSnapshot;
  result: DiffResult;
}

interface Job {
  id: number;
  a: PageSnapshot;
  b: PageSnapshot;
}

// Diff in a worker when one exists; keep the last result on screen and finish only the newest snapshot.
export function useDiff(a: PageSnapshot | null, b: PageSnapshot | null) {
  const [computed, setComputed] = useState<Computed | null>(null);
  const worker = useRef<Worker | null>(null);
  const wanted = useRef<Job | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./diff.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; result?: DiffResult; error?: string }>) => {
        const job = wanted.current;
        // Result of a comparison that has since been replaced: drop it.
        if (!job || e.data.id !== job.id) return;
        wanted.current = null;
        setComputed({ a: job.a, b: job.b, result: e.data.result ?? diffSnapshots(job.a, job.b) });
      };
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
      wanted.current = null;
    };
  }, []);

  useEffect(() => {
    if (!a || !b) return;
    const job: Job = { id: ++seq.current, a, b };
    const t = setTimeout(() => {
      wanted.current = job;
      const w = worker.current;
      if (!w) {
        wanted.current = null;
        setComputed({ a, b, result: diffSnapshots(a, b) });
        return;
      }
      w.postMessage(job);
    }, 30);
    return () => clearTimeout(t);
  }, [a, b]);

  const active = !!a && !!b;
  return {
    diff: active ? (computed?.result ?? null) : null,
  };
}
