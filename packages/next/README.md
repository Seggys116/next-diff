# @seggy116/next-diff

Compare your local Next.js site against live without leaving the page.

Press the button, or `Ctrl/Cmd + Shift + D`, and the page becomes two views: live on the left, local on the right, with every difference marked. Press **Exit diff** and you're back. It runs inside your own `next dev`. Nothing is sent to a service.

This is a devDependency. It sits on the Next.js your app already has. It does not replace, install, or upgrade Next.js.

## Install

Your app keeps its own Next.js. There is no setup command, no route file, and nothing to add to a layout.

```bash
npm i -D @seggy116/next-diff
```

`pnpm add -D @seggy116/next-diff` and `yarn add -D @seggy116/next-diff` are the same install.

Wrap the Next config. `live` is an origin (`https://example.com`), not a path. The same wrapper works in `next.config.ts`.

```js
// next.config.mjs
import { withDiff } from "@seggy116/next-diff";

export default withDiff(
  {
    // your config
  },
  { live: "https://example.com" },
);
```

Run `next dev`. A round button sits just above Next's own dev-tools button. Local is that dev server. The viewer always compares live (left) with local (right).

## Share card and metadata

In the window view, each page's Open Graph card sits above its site and a table of its head tags below it, with the tags that differ marked and, when a local page or past commit still names the live site in `og:image`, the picture loaded from the instance you are viewing.

## Git history

When the project is inside a Git repository, the **Live** tag on the left becomes a switch. Press it to swap live for the project's own history: a scrubber, `[` and `]`, or the commit list moves the left side through past commits, while the right side stays your working tree, uncommitted changes included.

The first commit you stop on is unpacked into a temporary `.next-diff` folder in your app and served by a throwaway `next dev` on an ephemeral port, using your installed packages and `.env` files. Moving to another commit rewrites only the files that differ, so the server recompiles just those, like an edit; it starts over only when the config, dependencies or env files differ. The server and the folder are removed when you press the tag again, close the viewer, or stop your dev server. Your own files are only read, never changed; the one addition is a `.next-diff/` line in the repository's local `.git/info/exclude` so the folder stays out of `git status`. It uses the `git` already on your machine and your own repository, with no network access, so private repositories work the same as public ones.

A commit that needs different dependencies than the ones installed may not start; the bar shows the dev server's output and a retry. The history followed is the first-parent line from `HEAD`, up to 300 commits.

## What ships

`next build` does not compile this package into the app. `withDiff` returns your config unchanged, and the button and the dev route are not part of the build. The Next.js that serves the site is the one your app already installed.

The dev server only fetches the origin in `withDiff`. Sessions stay in memory and expire on their own. Cookies the live site sets during a preview are kept for that preview. Cookies your browser already holds for the live site are not sent.

Pages behind a login are shown logged out. Pages that refuse to be framed may not render.

## License

Released under the [MIT License](https://github.com/Seggys116/next-diff/blob/main/LICENSE).

---

<div align="center">

<a href="https://www.buymeacoffee.com/seggy116"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-violet.png" alt="Buy me a coffee" height="50" /></a>

</div>
