import { execFile } from "node:child_process";
import { SHA, type GitCommit, type GitHistory, type GitRepo } from "@/lib/git/types";

const MAX_COMMITS = 300;

export interface RepoInfo extends GitRepo {
  /** Top of the repository. */
  root: string;
  /** Where the app lives under `root` ("" at the top, "apps/web" in a monorepo), always with forward slashes. */
  app: string;
}

export const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: gitEnv(), timeout: 20_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** The repository the dev server was started in, or null when it isn't in one (or has no commits yet). */
export async function repoInfo(cwd = process.cwd()): Promise<RepoInfo | null> {
  try {
    const [top, prefix] = (await git(["rev-parse", "--show-toplevel", "--show-prefix"], cwd)).split("\n");
    const head = (await git(["rev-parse", "--verify", "HEAD"], cwd)).trim();
    if (!top || !SHA.test(head)) return null;
    const branch = (await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).catch(() => "")).trim() || null;
    const dirty = (await git(["status", "--porcelain"], cwd).catch(() => "")).trim().length > 0;
    return { root: top, app: (prefix ?? "").replace(/\/+$/, ""), branch, head, dirty };
  } catch {
    return null;
  }
}

export async function history(info: RepoInfo): Promise<GitHistory> {
  // The first-parent line is the sequence of states the branch actually went through, so scrubbing it never jumps sideways.
  const out = await git(["log", `-n${MAX_COMMITS}`, "--first-parent", "--format=%H%x1f%an%x1f%at%x1f%s%x1e", "HEAD", "--"], info.root);
  const commits: GitCommit[] = [];
  for (const record of out.split("\x1e")) {
    const [sha, author, at, subject] = record.trim().split("\x1f");
    if (!sha || !SHA.test(sha)) continue;
    commits.push({ sha, short: sha.slice(0, 7), subject: subject ?? "", author: author ?? "", date: Number(at) || 0 });
  }
  const { root: _root, app: _app, ...repo } = info;
  return { repo, commits };
}

export async function hasCommit(info: RepoInfo, sha: string): Promise<boolean> {
  if (!SHA.test(sha)) return false;
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], info.root);
    return true;
  } catch {
    return false;
  }
}
