export interface GitCommit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  /** Unix seconds. */
  date: number;
}

export interface GitRepo {
  /** Null on a detached HEAD. */
  branch: string | null;
  head: string;
  /** Your working tree has changes that are not committed. They are part of "Local", never of a past commit. */
  dirty: boolean;
}

export interface GitHistory {
  repo: GitRepo;
  /** Newest first. */
  commits: GitCommit[];
}

/** What starting a past commit goes through, in order. `RevisionStatus.step` is the one in progress; the length means all done. */
export const REVISION_STEPS = ["Unpack the commit", "Link your packages", "Start Next.js", "Compile the first page"] as const;

/** What switching a running server to another commit goes through; `RevisionStatus.step` indexes this when `update` is set. */
export const UPDATE_STEPS = ["Update the changed files", "Compile the changes"] as const;

export type RevisionState = "starting" | "ready" | "error";

export interface RevisionStatus {
  sha: string;
  state: RevisionState;
  /** What the server is doing while it starts, for the progress line. */
  phase: string;
  /** Index into `REVISION_STEPS` of what is happening now. */
  step: number;
  /** The server was already running and is being moved to this commit, so `step` indexes `UPDATE_STEPS`. */
  update?: boolean;
  /** The ephemeral address the past version is served from, once it is ready. */
  origin?: string;
  error?: { title: string; message: string };
  /** The last lines the temporary dev server printed. */
  log: string[];
}

export const SHA = /^[0-9a-f]{40}$/;
