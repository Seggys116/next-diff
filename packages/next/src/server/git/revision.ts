import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { REVISION_STEPS, SHA, type RevisionStatus } from "@/lib/git/types";
import { gitEnv, hasCommit, type RepoInfo } from "./repo";

// One past commit at a time, served by a throwaway `next dev` on an ephemeral port. Its files live in a folder inside your app (Turbopack won't
// resolve linked packages from outside the project). It is not under `.next`: Next treats that as build output and recompiles far more slowly there.
// They are removed when you leave Git mode, the viewer goes quiet, or the dev server exits. Your source files are only read, never written.

const DIR = ".next-diff";
const IDLE_MS = 5 * 60 * 1000;
const ABSOLUTE_MS = 4 * 60 * 60 * 1000;
const START_TIMEOUT_MS = 120_000;
const LOG_LINES = 60;
const OWNER = ".owner";
// A revision still starting up this recently is kept when another commit is asked for, so two viewers on different commits do not cancel each other forever.
const MIN_START_MS = 1500;

class Cancelled extends Error {}

/** Switching commits changed something a running dev server won't pick up by itself. */
class Restart extends Error {}

// Files Next reads once at startup: change any of these and the server has to be started again, not just fed new files.
const NEEDS_RESTART = /(^|\/)(next\.config\.[cm]?[jt]s|package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|[jt]sconfig[^/]*\.json|postcss\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|\.env[^/]*)$/;

class StartFailure extends Error {
  constructor(
    readonly title: string,
    message: string,
  ) {
    super(message);
  }
}

interface Revision {
  /** The commit being asked for. While it is being switched to, `applied` is the one the files on disk still match. */
  sha: string;
  applied: string;
  syncing: boolean;
  state: RevisionStatus["state"];
  phase: string;
  step: number;
  origin?: string;
  error?: RevisionStatus["error"];
  log: string[];
  dir?: string;
  child?: ChildProcess;
  exited?: Promise<void>;
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  abort: AbortController;
  task: Promise<void>;
  /** Set once the freshness probe has failed on this server, so later switches don't wait for it. */
  noProbe?: boolean;
  closed: boolean;
  touched: number;
  created: number;
}

interface Store {
  current: Revision | null;
  /** Everything not yet cleaned up, so exiting can clean up a revision that was being replaced too. */
  all: Set<Revision>;
  timer?: ReturnType<typeof setInterval>;
  hooked?: boolean;
}

const g = globalThis as unknown as { __diffRevisions?: Store };
const store: Store = (g.__diffRevisions ??= { current: null, all: new Set() });

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function note(rev: Revision, chunk: Buffer | string) {
  for (const raw of String(chunk).replace(ANSI, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    rev.log.push(line.slice(0, 400));
    if (rev.log.length > LOG_LINES) rev.log.shift();
  }
}

function phase(rev: Revision, step: number, text: string = REVISION_STEPS[step]) {
  if (rev.closed) return;
  rev.step = step;
  rev.phase = text;
}

const status = (rev: Revision): RevisionStatus => ({ sha: rev.sha, state: rev.state, phase: rev.phase, step: rev.step, update: rev.syncing || undefined, origin: rev.origin, error: rev.error, log: rev.log });

// --- Where the copies live ---

let baseDir = "";
const base = () => baseDir;

async function ensureBase(info: RepoInfo): Promise<string> {
  const dir = base();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  // A shared temp directory: never use one somebody else made, or a link to somewhere else.
  const st = await fsp.lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid())) {
    throw new StartFailure("Couldn’t prepare a temporary folder", `${dir} isn’t a folder only you own.`);
  }
  await excludeFromGit(info);
  return dir;
}

// Kept out of `git status` through the repository's local exclude file. A `.gitignore` inside the folder would do the same, but the dev server's
// watcher is then slow to see changes in it (seconds instead of milliseconds).
async function excludeFromGit(info: RepoInfo) {
  try {
    const file = await new Promise<string>((resolve, reject) => {
      execFile("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: info.root, env: gitEnv(), windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
    });
    const full = path.resolve(info.root, file);
    const have = await fsp.readFile(full, "utf8").catch(() => "");
    if (have.split(/\r?\n/).some((line) => line.trim() === `${DIR}/`)) return;
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.appendFile(full, `${have && !have.endsWith("\n") ? "\n" : ""}${DIR}/\n`);
  } catch {
    // Without it the folder is only listed as untracked while Git mode is open.
  }
}

const inside = (dir: string) => !!baseDir && path.resolve(dir).startsWith(baseDir + path.sep);

async function removeDir(dir: string | undefined) {
  if (!dir || !inside(dir)) return;
  // Does not follow the node_modules links: only the links go, never what they point at.
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }).catch(() => {});
}

function removeDirSync(dir: string | undefined) {
  if (!dir || !inside(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// --- Processes ---

function killTree(child: ChildProcess | undefined, signal: NodeJS.Signals) {
  const pid = child?.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-pid, signal);
  } catch {}
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      probe.close(() => (addr && typeof addr === "object" ? resolve(addr.port) : reject(new Error("No free port"))));
    });
  });
}

const accepting = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.setTimeout(1000, () => (s.destroy(), resolve(false)));
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extract(info: RepoInfo, sha: string, dest: string, signal: AbortSignal, paths?: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Literal pathspecs: a file named `*.ts` or `:(top)` is a file, not a pattern.
    const args = paths ? ["--literal-pathspecs", "archive", "--format=tar", sha, "--", ...paths] : ["archive", "--format=tar", sha];
    const archive = spawn("git", args, { cwd: info.root, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"], signal, windowsHide: true });
    const untar = spawn("tar", ["-x", "-C", dest], { stdio: ["pipe", "ignore", "pipe"], signal, windowsHide: true });
    let stderr = "";
    let failed = false;
    let open = 2;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      archive.kill();
      untar.kill();
      reject(err);
    };
    const collect = (c: Buffer) => {
      if (stderr.length < 4000) stderr += c;
    };
    archive.stderr.on("data", collect);
    untar.stderr.on("data", collect);
    archive.on("error", (e) => fail((e as NodeJS.ErrnoException).name === "AbortError" ? new Cancelled() : e));
    untar.on("error", (e) => fail((e as NodeJS.ErrnoException).name === "AbortError" ? new Cancelled() : e));
    untar.stdin.on("error", () => {});
    archive.stdout.pipe(untar.stdin);
    const done = (name: string) => (code: number | null) => {
      if (code !== 0) fail(new Error(`${name} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      else if (--open === 0 && !failed) resolve();
    };
    archive.on("close", done("git archive"));
    untar.on("close", done("tar"));
  });
}

// A committed symlink could point out of the copy; refuse to write or delete through one.
async function guard(rev: Revision, ...targets: string[]) {
  const root = await fsp.realpath(rev.dir!);
  for (const target of targets) {
    let existing = path.resolve(target);
    for (;;) {
      if (await exists(existing)) break;
      const up = path.dirname(existing);
      if (up === existing) break;
      existing = up;
    }
    const real = await fsp.realpath(existing).catch(() => "");
    const linked = existing === path.resolve(target) && (await fsp.lstat(existing).then((s) => s.isSymbolicLink(), () => false));
    if (!real || linked || (real !== root && !real.startsWith(root + path.sep))) {
      throw new StartFailure("That commit contains a link that leaves its folder", `${path.relative(rev.dir!, path.resolve(target)) || "."} resolves outside the copy, so nothing was written there.`);
    }
  }
}

const isDir = (p: string) => fsp.stat(p).then((s) => s.isDirectory(), () => false);
const exists = (p: string) => fsp.lstat(p).then(() => true, () => false);

// Past code runs on today's installed packages: link each node_modules from your tree to where the old tree expects it.
async function linkModules(live: string, dest: string) {
  const queue: [string, number][] = [["", 0]];
  for (let seen = 0; queue.length && seen < 4000; seen++) {
    const [rel, depth] = queue.shift()!;
    const modules = path.join(live, rel, "node_modules");
    const target = path.join(dest, rel, "node_modules");
    if ((await isDir(modules)) && !(await exists(target))) await fsp.symlink(await fsp.realpath(modules), target, "junction");
    if (depth >= 4) continue;
    const entries = await fsp.readdir(path.join(dest, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) queue.push([path.join(rel, e.name), depth + 1]);
    }
  }
}

const LOCKFILES = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"];

// Next puts its project root at a lockfile. One inside the copy would end the root before your linked node_modules; without it the root is your own project, which holds both.
async function dropLockfiles(dest: string, app: string) {
  for (const dir of new Set([dest, path.join(dest, app)])) {
    for (const name of LOCKFILES) await fsp.rm(path.join(dir, name), { force: true }).catch(() => {});
  }
}

// Env files are rarely committed; without yours a past version would boot without its settings.
async function copyEnv(liveApp: string, destApp: string) {
  for (const name of await fsp.readdir(liveApp).catch(() => [] as string[])) {
    if (!/^\.env(\..+)?$/.test(name) || /\.(example|sample)$/.test(name)) continue;
    const from = path.join(liveApp, name);
    if (!(await fsp.stat(from).then((s) => s.isFile(), () => false))) continue;
    await fsp.copyFile(from, path.join(destApp, name), fs.constants.COPYFILE_EXCL).catch(() => {});
  }
}

function devFlags(appDir: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")) as { scripts?: { dev?: string } };
    const m = /\bnext\s+dev\b([^&|;]*)/.exec(pkg.scripts?.dev ?? "");
    return (m?.[1] ?? "").split(/\s+/).filter((t) => t === "--turbopack" || t === "--turbo" || t === "--webpack");
  } catch {
    return [];
  }
}

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  // Next sets private variables for its own workers; a second Next started with them would believe it was one of those.
  for (const [k, v] of Object.entries(process.env)) if (!/^(__NEXT|NEXT_PRIVATE|NEXT_RUNTIME|NEXT_DEPLOYMENT_ID|PORT$)/.test(k)) env[k] = v;
  env.NODE_ENV = "development";
  env.NEXT_DIFF_REVISION = "1";
  env.NEXT_TELEMETRY_DISABLED = "1";
  return env as NodeJS.ProcessEnv;
}

// --- Moving a running server to another commit ---

interface Change {
  removed: boolean;
  file: string;
}

async function changedFiles(info: RepoInfo, from: string, to: string): Promise<Change[]> {
  const out = await new Promise<string>((resolve, reject) => {
    execFile("git", ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", from, to], { cwd: info.root, env: gitEnv(), maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  const parts = out.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ removed: parts[i].startsWith("D"), file: parts[i + 1] });
  return changes;
}

async function applyChanges(rev: Revision, info: RepoInfo, changes: Change[], to: string) {
  const dir = rev.dir!;
  const within = (file: string) => {
    const full = path.resolve(dir, file);
    return full.startsWith(dir + path.sep) ? full : null;
  };
  const gone = new Set<string>();
  for (const c of changes) {
    if (!c.removed) continue;
    const full = within(c.file);
    if (!full) continue;
    await guard(rev, path.dirname(full));
    await fsp.rm(full, { force: true, recursive: true });
    gone.add(path.dirname(full));
  }
  // A folder that is now empty may be about to become a file.
  for (const start of gone) {
    for (let d = start; d.startsWith(dir + path.sep); d = path.dirname(d)) {
      try {
        await fsp.rmdir(d);
      } catch {
        break;
      }
    }
  }
  const files = changes.filter((c) => !c.removed && within(c.file)).map((c) => c.file);
  for (let i = 0; i < files.length; i += 80) {
    if (rev.closed) throw new Cancelled();
    await extract(info, to, dir, rev.abort.signal, files.slice(i, i + 80));
  }
}

// The dev server finds out about new files from its file watcher, some time after they are written, and a page asked for before then comes back
// as the old commit. A route written after the changes, and waited for, shows that the watcher has caught up: events arrive in order.
const PROBE = "diff-probe-x";
const SETTLE_MS = 6000;
const SETTLE_FALLBACK_MS = 1500;

interface Probe {
  dir: string;
  file: string;
  url: string;
  source: (nonce: string) => string;
}

async function chooseProbe(appDir: string): Promise<Probe | null> {
  for (const base of ["app", "src/app"]) {
    if (await isDir(path.join(appDir, base))) {
      const dir = path.join(appDir, base, PROBE);
      return { dir, file: path.join(dir, "route.ts"), url: `/${PROBE}`, source: (n) => `export const dynamic = "force-dynamic";\nexport const GET = () => new Response("${n}");\n` };
    }
  }
  for (const base of ["pages", "src/pages"]) {
    if (await isDir(path.join(appDir, base))) {
      const file = path.join(appDir, base, "api", `${PROBE}.ts`);
      return { dir: file, file, url: `/api/${PROBE}`, source: (n) => `export default function handler(_req: unknown, res: { end(body: string): void }) {\n  res.end("${n}");\n}\n` };
    }
  }
  return null;
}

// Present from the start, so the first compile includes it and a later change to it is an edit rather than a new route.
async function plantProbe(rev: Revision, appDir: string) {
  const probe = await chooseProbe(appDir);
  if (!probe) return;
  await guard(rev, probe.dir, probe.file);
  await fsp.mkdir(path.dirname(probe.file), { recursive: true });
  await fsp.writeFile(probe.file, probe.source("start"));
}

async function settle(rev: Revision, appDir: string) {
  const probe = rev.noProbe ? null : await chooseProbe(appDir);
  if (!probe) {
    await sleep(SETTLE_FALLBACK_MS);
    return;
  }
  const nonce = Date.now().toString(36);
  await guard(rev, probe.dir, probe.file);
  await fsp.mkdir(path.dirname(probe.file), { recursive: true });
  await fsp.writeFile(probe.file, probe.source(nonce));
  const until = Date.now() + SETTLE_MS;
  while (!rev.closed && Date.now() < until) {
    const body = await fetch(`${rev.origin}${probe.url}`, { signal: AbortSignal.any([rev.abort.signal, AbortSignal.timeout(Math.max(1, until - Date.now()))]), redirect: "manual" })
      .then((r) => r.text())
      .catch(() => "");
    if (body === nonce) return;
    await sleep(100);
  }
  if (!rev.closed) rev.noProbe = true;
}

// Only what differs between the two commits is rewritten, so the running dev server treats the switch as edits and keeps what it has compiled.
async function syncLoop(rev: Revision, info: RepoInfo) {
  while (!rev.closed && rev.applied !== rev.sha) {
    const from = rev.applied;
    const to = rev.sha;
    phase(rev, 0, `Updating files for ${to.slice(0, 7)}`);
    const changes = await changedFiles(info, from, to);
    if (changes.some((c) => NEEDS_RESTART.test(c.file))) throw new Restart();
    try {
      await applyChanges(rev, info, changes, to);
    } catch (err) {
      if (err instanceof Cancelled) throw err;
      throw new StartFailure("Couldn’t switch to that commit", (err as Error).message);
    }
    rev.applied = to;
  }
  if (rev.closed) return;
  const target = rev.sha;
  phase(rev, 1, "Compiling the changes");
  await settle(rev, path.join(rev.dir!, info.app));
  await warm(rev, rev.origin!);
  if (rev.closed || rev.sha !== target) return;
  if (rev.exit) throw new StartFailure("That version of the site stopped", rev.log.slice(-6).join("\n"));
  rev.state = "ready";
  rev.phase = "Ready";
  rev.step = REVISION_STEPS.length;
}

async function warm(rev: Revision, origin: string) {
  await fetch(`${origin}/`, { signal: AbortSignal.any([rev.abort.signal, AbortSignal.timeout(START_TIMEOUT_MS)]), redirect: "manual", headers: { accept: "text/html" } })
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

// --- Lifecycle ---

async function run(rev: Revision, info: RepoInfo) {
  const live = () => {
    if (rev.closed) throw new Cancelled();
  };

  const root = await ensureBase(info);
  rev.dir = await fsp.mkdtemp(path.join(root, "r-"));
  store.all.add(rev);
  await fsp.writeFile(path.join(rev.dir, OWNER), JSON.stringify({ owner: process.pid }));
  live();

  phase(rev, 0, `Unpacking ${rev.sha.slice(0, 7)}`);
  try {
    await extract(info, rev.sha, rev.dir, rev.abort.signal);
  } catch (err) {
    if (err instanceof Cancelled) throw err;
    throw new StartFailure("Couldn’t unpack that commit", (err as Error).message);
  }
  live();

  const liveApp = path.join(info.root, info.app);
  const appDir = path.join(rev.dir, info.app);
  if (!(await exists(path.join(appDir, "package.json")))) {
    throw new StartFailure("The app isn’t in that commit", `There is no package.json at ${info.app || "the top of the repository"} in ${rev.sha.slice(0, 7)}.`);
  }

  phase(rev, 1);
  await guard(rev, appDir);
  await dropLockfiles(rev.dir, info.app);
  await linkModules(info.root, rev.dir);
  await guard(rev, appDir);
  await copyEnv(liveApp, appDir);
  await plantProbe(rev, appDir);
  live();

  let nextBin: string;
  try {
    nextBin = path.join(path.dirname(createRequire(path.join(liveApp, "package.json")).resolve("next/package.json")), "dist", "bin", "next");
  } catch {
    throw new StartFailure("Couldn’t find Next.js", "next isn’t installed for this app.");
  }

  phase(rev, 2);
  const port = await freePort();
  live();
  const child = spawn(process.execPath, [nextBin, "dev", ...devFlags(appDir), "-p", String(port), "-H", "127.0.0.1"], {
    cwd: appDir,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so the whole tree can be stopped at once.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  rev.child = child;
  if (rev.closed) {
    killTree(child, "SIGKILL");
    throw new Cancelled();
  }
  rev.exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      rev.exit = { code, signal };
      resolve();
    });
    child.once("error", (err) => {
      note(rev, err.message);
      rev.exit ??= { code: 1, signal: null };
      resolve();
    });
  });
  child.stdout?.on("data", (c) => note(rev, c));
  child.stderr?.on("data", (c) => note(rev, c));
  await fsp.writeFile(path.join(rev.dir, OWNER), JSON.stringify({ owner: process.pid, child: child.pid }));

  const began = Date.now();
  while (!(await accepting(port))) {
    live();
    if (rev.exit) throw new StartFailure("That version of the site didn’t start", rev.log.slice(-6).join("\n") || `next dev exited with code ${rev.exit.code}.`);
    if (Date.now() - began > START_TIMEOUT_MS) throw new StartFailure("That version of the site took too long to start", rev.log.slice(-6).join("\n"));
    await sleep(150);
  }
  live();

  // The first request compiles the app from cold, which on a real site outlasts a pane's patience: do it here, where the bar can say so.
  phase(rev, 3);
  const origin = `http://127.0.0.1:${port}`;
  await warm(rev, origin);
  live();
  if (rev.exit) throw new StartFailure("That version of the site stopped", rev.log.slice(-6).join("\n"));

  rev.origin = origin;
  rev.state = "ready";
  rev.phase = "Ready";
  rev.step = REVISION_STEPS.length;
  // It can still die later; surface that instead of leaving the pane to time out.
  void rev.exited.then(() => {
    if (!rev.closed && rev.state === "ready") fail(rev, new StartFailure("That version of the site stopped", rev.log.slice(-6).join("\n")));
  });
}

function fail(rev: Revision, err: unknown) {
  // Even for a closed revision: a child spawned while close() was waiting must not outlive it.
  killTree(rev.child, "SIGKILL");
  if (rev.closed || err instanceof Cancelled) return;
  const e = err instanceof StartFailure ? err : new StartFailure("Couldn’t start that version", err instanceof Error ? err.message : "Unknown error");
  rev.state = "error";
  rev.origin = undefined;
  rev.error = { title: e.title, message: e.message };
  void removeDir(rev.dir);
}

async function close(rev: Revision) {
  rev.closed = true;
  rev.abort.abort();
  if (store.current === rev) store.current = null;
  killTree(rev.child, "SIGTERM");
  if (rev.exited) {
    const grace = setTimeout(() => killTree(rev.child, "SIGKILL"), 4000);
    await rev.exited;
    clearTimeout(grace);
  }
  await rev.task.catch(() => {});
  await removeDir(rev.dir);
  store.all.delete(rev);
}

function closeAllSync() {
  for (const rev of store.all) {
    rev.closed = true;
    killTree(rev.child, "SIGKILL");
    removeDirSync(rev.dir);
  }
  store.all.clear();
  store.current = null;
}

function hook() {
  if (store.hooked) return;
  store.hooked = true;
  // Ctrl-C and a normal stop both end in an exit event. A hard kill can't be caught: the next start sweeps up after it.
  process.once("exit", closeAllSync);
  store.timer = setInterval(() => {
    const rev = store.current;
    if (!rev) return;
    const now = Date.now();
    if (now - rev.touched > IDLE_MS || now - rev.created > ABSOLUTE_MS) void close(rev);
  }, 15_000);
  store.timer.unref?.();
}

/** Clear out copies left by a dev server that was killed without a chance to clean up. */
export async function sweepStale() {
  const root = base();
  if (!root) return;
  const names = await fsp.readdir(root).catch(() => [] as string[]);
  for (const name of names) {
    if (!/^r-[A-Za-z0-9]+$/.test(name)) continue;
    const dir = path.join(root, name);
    if ([...store.all].some((r) => r.dir === dir)) continue;
    let owner: { owner?: number; child?: number } = {};
    try {
      owner = JSON.parse(await fsp.readFile(path.join(dir, OWNER), "utf8"));
    } catch {
      const st = await fsp.stat(dir).catch(() => null);
      if (st && Date.now() - st.mtimeMs < 60 * 60 * 1000) continue;
    }
    // Another live dev server's copy, or one of this process's own, is not stale.
    if (owner.owner && (owner.owner === process.pid || alive(owner.owner))) continue;
    if (owner.child && alive(owner.child) && process.platform !== "win32") {
      // Only if that process is still the server for this very folder, not a stranger that was given the same number since.
      const cmd = spawnSync("ps", ["-p", String(owner.child), "-o", "command="], { encoding: "utf8" }).stdout ?? "";
      if (cmd.includes(dir)) {
        try {
          process.kill(-owner.child, "SIGKILL");
        } catch {}
      }
    }
    await removeDir(dir);
  }
}

// --- What the route uses ---

function begin(info: RepoInfo, sha: string, prev: Revision | null): Revision {
  const now = Date.now();
  const rev: Revision = { sha, applied: sha, syncing: false, state: "starting", phase: "Preparing", step: 0, log: [], abort: new AbortController(), task: Promise.resolve(), closed: false, touched: now, created: now };
  store.current = rev;
  store.all.add(rev);
  rev.task = (async () => {
    if (prev) await close(prev);
    if (rev.closed) return;
    await run(rev, info);
  })().catch((err) => fail(rev, err));
  return rev;
}

function retarget(rev: Revision, info: RepoInfo) {
  if (rev.syncing) return;
  rev.syncing = true;
  void syncLoop(rev, info)
    .catch((err) => {
      // The server can't take these changes as edits: start over on the commit now being asked for.
      if (err instanceof Restart && !rev.closed) begin(info, rev.sha, rev);
      else fail(rev, err);
    })
    .finally(() => {
      rev.syncing = false;
      // A newer commit may have been chosen as the last one finished.
      if (!rev.closed && store.current === rev && rev.state === "starting" && rev.applied !== rev.sha) retarget(rev, info);
    });
}

/** Begin serving `sha` (or keep serving it). Returns at once; poll `currentRevision()` for progress. */
export async function ensureRevision(info: RepoInfo, sha: string): Promise<RevisionStatus> {
  if (!SHA.test(sha) || !(await hasCommit(info, sha))) throw new StartFailure("Unknown commit", "That commit isn’t in this repository.");
  hook();
  baseDir = path.join(info.root, info.app, DIR);
  const now = Date.now();
  const have = store.current;
  if (have && !have.closed && have.state !== "error") {
    have.touched = now;
    if (have.sha === sha) return status(have);
    if (have.state === "starting" && !have.syncing && now - have.created < MIN_START_MS) return status(have);
    // A running server is moved along; one that is still starting up is simply replaced.
    if (have.state === "ready" || have.syncing) {
      have.sha = sha;
      have.state = "starting";
      have.error = undefined;
      phase(have, 0, `Switching to ${sha.slice(0, 7)}`);
      retarget(have, info);
      return status(have);
    }
  }
  const rev = begin(info, sha, have);
  void sweepStale().catch(() => {});
  return status(rev);
}

export function currentRevision(): RevisionStatus | null {
  const rev = store.current;
  if (!rev) return null;
  rev.touched = Date.now();
  return status(rev);
}

/** The address a pass-through session may be opened against: only while a revision is actually being served. */
export function revisionOrigin(): string | undefined {
  const rev = store.current;
  return rev && rev.state === "ready" ? rev.origin : undefined;
}

export async function stopRevision() {
  const rev = store.current;
  if (rev) await close(rev);
}

export const isStartFailure = (err: unknown): err is StartFailure => err instanceof StartFailure;
