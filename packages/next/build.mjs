// The viewer bundle carries its own React and runs in its own frame, so it never collides with the host page's React or CSS.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(root, ...p);
const dist = at("dist");

// --clean wipes dist/ first; without it, overwrite in place so a dev server watching dist/ does not see the package vanish.
if (process.argv.includes("--clean")) rmSync(dist, { recursive: true, force: true });
mkdirSync(at("dist", "ui"), { recursive: true });

const shared = { absWorkingDir: root, tsconfig: at("tsconfig.json"), bundle: true, legalComments: "none", logLevel: "info" };

// useDiff loads ./diff.worker.ts; in dist that file is ./diff.worker.js next to app.js.
const workerUrl = {
  name: "worker-url",
  setup(b) {
    b.onLoad({ filter: /[\\/]useDiff\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace('"./diff.worker.ts"', '"./diff.worker.js"'),
      loader: "ts",
    }));
  },
};

const browser = { ...shared, platform: "browser", format: "esm", target: "es2022", minify: true, jsx: "automatic" };

await Promise.all([
  build({
    ...browser,
    entryPoints: { app: at("src/ui/main.tsx") },
    outdir: at("dist/ui"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [workerUrl],
  }),
  build({ ...browser, entryPoints: { "diff.worker": at("src/lib/diff/diff.worker.ts") }, outdir: at("dist/ui") }),
  // Loaded by Next only when withDiff adds it, which is `next dev`.
  build({
    ...browser,
    minify: false,
    entryPoints: { instrument: at("src/instrument.ts") },
    outdir: dist,
    external: ["react", "react/jsx-runtime", "next", "next/*"],
    banner: { js: '"use client";' },
  }),
  build({
    ...shared,
    platform: "node",
    format: "esm",
    target: "node20",
    entryPoints: { config: at("src/config.ts"), "dev-server": at("src/dev-server.ts") },
    outdir: dist,
    external: ["next", "next/*"],
  }),
]);

// The inspector script is injected into pages as is.
cpSync(at("src/probe/probe.js"), at("dist/ui/probe.js"));

// Styles: Tailwind, compiled once, loaded only inside the viewer's frame.
execFileSync(at("node_modules/.bin/tailwindcss"), ["-i", at("src/ui/viewer.css"), "-o", at("dist/ui/app.css"), "--minify"], {
  cwd: root,
  stdio: "inherit",
});

cpSync(at("types", "config.d.ts"), at("dist", "config.d.ts"));

console.log("built @seggy116/next-diff");
