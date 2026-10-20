import { createRequire } from "node:module";
import path from "node:path";

let dir: string | null = null;

// Find this package from the project running next dev: once the bundler inlines this file, import.meta.url points at the wrong place.
export function packageDir(): string {
  if (dir) return dir;
  const fromProject = createRequire(path.join(process.cwd(), "package.json"));
  dir = path.dirname(fromProject.resolve("@seggy116/next-diff/package.json"));
  return dir;
}

export const uiFile = (name: string) => path.join(packageDir(), "dist", "ui", name);
