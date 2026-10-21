"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitCommit, GitHistory, RevisionStatus } from "@/lib/git/types";
import type { GitApi } from "./devtools";

/** Scrubbing fires a change per commit passed; only the one you stop on is worth starting a server for. */
const SETTLE_MS = 320;
const WORKING_POLL_MS = 500;
const READY_POLL_MS = 30_000;
/** How long another viewer's commit may be on the server before we take it back, and the least gap between takes. */
const MISMATCH_GRACE_MS = 2000;

export interface GitScrub {
  history: GitHistory | null;
  historyError: string | null;
  retryHistory: () => void;
  /** 0 is the newest commit. */
  index: number;
  commit: GitCommit | null;
  select: (index: number) => void;
  /** Positive goes back in time. */
  step: (dir: 1 | -1) => void;
  /** The server for the commit you are on, once it has been asked for. Null while you are still scrubbing. */
  status: RevisionStatus | null;
  retry: () => void;
  /** Only set when the server for exactly this commit is up. */
  ready: { sha: string; origin: string } | null;
}

export function useGit(api: GitApi | undefined, active: boolean): GitScrub {
  const [history, setHistory] = useState<GitHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTry, setHistoryTry] = useState(0);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<RevisionStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) setHistory(null);
  }, [active]);

  useEffect(() => {
    if (!api || !active || history) return;
    let off = false;
    api
      .history()
      .then((h) => {
        if (off) return;
        setHistory(h);
        setHistoryError(null);
      })
      .catch((err) => !off && setHistoryError(err instanceof Error ? err.message : "Couldn’t read the Git history"));
    return () => {
      off = true;
    };
  }, [api, active, history, historyTry]);

  const commit = history?.commits[index] ?? null;
  const sha = commit?.sha ?? null;

  useEffect(() => {
    if (!active || !sha) return;
    // The first commit shown starts straight away; later ones wait for the scrubbing to stop.
    const t = setTimeout(() => setTarget(sha), target === null ? 0 : SETTLE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `target` only decides the delay
  }, [active, sha]);

  useEffect(() => {
    if (!api || !active || !target) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mismatchSince = 0;
    let lastPost = 0;
    const tick = async (first: boolean) => {
      let next = WORKING_POLL_MS;
      try {
        const s = first ? await api.start(target) : await api.poll();
        if (off) return;
        if (first) lastPost = Date.now();
        if (!s || s.sha !== target) {
          // The server let it go (idle, or replaced): ask again, but not in a tight loop against another viewer on a different commit.
          const now = Date.now();
          if (!mismatchSince) mismatchSince = now;
          if (now - mismatchSince >= MISMATCH_GRACE_MS && now - lastPost >= MISMATCH_GRACE_MS) {
            mismatchSince = 0;
            void tick(true);
            return;
          }
          timer = setTimeout(() => void tick(false), WORKING_POLL_MS);
          return;
        }
        mismatchSince = 0;
        setStatus(s);
        if (s.state === "error") return;
        if (s.state === "ready") next = READY_POLL_MS;
      } catch (err) {
        if (off) return;
        setStatus({ sha: target, state: "error", phase: "", step: 0, error: { title: "Couldn’t start that version", message: err instanceof Error ? err.message : "Unknown error" }, log: [] });
        return;
      }
      timer = setTimeout(() => void tick(false), next);
    };
    void tick(true);
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [api, active, target, attempt]);

  // Leaving Git mode (or closing the viewer) shuts the temporary server down.
  useEffect(() => {
    if (!api || !active) return;
    return () => {
      api.stop();
      setTarget(null);
      setStatus(null);
    };
  }, [api, active]);

  // Closing the viewer removes the frame without running cleanups, so the page going away stops the server too.
  useEffect(() => {
    if (!api || !active) return;
    const onHide = () => api.stop();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [api, active]);

  const select = useCallback(
    (i: number) => {
      const max = (history?.commits.length ?? 1) - 1;
      setIndex(Math.max(0, Math.min(max, i)));
    },
    [history],
  );
  const step = useCallback((dir: 1 | -1) => select(index + dir), [select, index]);
  const retry = useCallback(() => {
    setStatus(null);
    setAttempt((n) => n + 1);
  }, []);
  const retryHistory = useCallback(() => {
    setHistoryError(null);
    setHistoryTry((n) => n + 1);
  }, []);

  const current = status && status.sha === sha ? status : null;
  const ready = useMemo(() => (current?.state === "ready" && current.origin ? { sha: current.sha, origin: current.origin } : null), [current]);

  return { history, historyError, retryHistory, index, commit, select, step, status: current, retry, ready };
}
