/// <reference lib="webworker" />
import { diffSnapshots } from "./engine";
import type { PageSnapshot } from "./types";

interface Job {
  id: number;
  a: PageSnapshot;
  b: PageSnapshot;
}

const ctx = self as unknown as Worker;

// A diff blocks this thread; if a newer snapshot is already queued, skip to that one.
let latest: Job | null = null;
let scheduled = false;

function run() {
  scheduled = false;
  const job = latest;
  latest = null;
  if (!job) return;
  try {
    ctx.postMessage({ id: job.id, result: diffSnapshots(job.a, job.b) });
  } catch (err) {
    ctx.postMessage({ id: job.id, error: String(err) });
  }
}

self.onmessage = (e: MessageEvent<Job>) => {
  latest = e.data;
  if (scheduled) return;
  scheduled = true;
  // Yield once so any messages already queued behind this one replace it first.
  setTimeout(run, 0);
};
