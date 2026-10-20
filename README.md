<div align="center">

<h1>
  <img src="https://raw.githubusercontent.com/Seggys116/next-diff/main/.github/assets/icon.svg" alt="" width="72" align="absmiddle" />
  &nbsp;next-diff
</h1>

Compare your local Next.js site against live without leaving the page.

[![CI](https://github.com/Seggys116/next-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/Seggys116/next-diff/actions/workflows/ci.yml)

</div>

Press the button, or `Ctrl/Cmd + Shift + D`, and the page becomes two views: live on the left, local on the right, with every difference marked. Press **Exit diff** and you're back on the page you were looking at. It runs inside your own `next dev`. Nothing is sent to a service.

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

Run `next dev`. A round button sits just above Next's own dev-tools button. Local is that dev server, so it needs nothing else. The viewer always compares live (left) with local (right).

## What ships

`next build` does not compile this package into the app. `withDiff` returns your config unchanged, and the button and the dev route are not part of the build. The Next.js that serves the site is the one your app already installed.

The dev server only fetches the origin in `withDiff`. Sessions stay in memory and expire on their own. Your cookies are not sent to the live site.

Pages behind a login are shown logged out. Pages that refuse to be framed may not render.

## Development

```bash
pnpm install
pnpm --filter playground dev
pnpm --filter playground live
```

The playground is a small Next app on port 3001. `withDiff` is already in its config. `live` serves a stand-in of the same pages on port 3100.

Bug reports and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

next-diff is released under the [MIT License](LICENSE).

---

<div align="center">

<a href="https://www.buymeacoffee.com/seggy116"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-violet.png" alt="Buy me a coffee" height="50" /></a>

</div>
