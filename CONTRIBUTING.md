# Contributing

Bug reports and pull requests are welcome. For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Building and testing

Requires Node.js 20 or newer and pnpm 12.4.1.

```
pnpm install
pnpm typecheck
pnpm build
```

`pnpm dev` rebuilds the package as you edit it. The playground is a small Next app with `withDiff` already in its config:

```
pnpm --filter playground dev
pnpm --filter playground live
```

The app is on port 3001. `live` serves a stand-in of the same pages on port 3100, which is the origin the playground compares against.

## Pull requests

- Keep each pull request to one change.
- Write commit messages as a sentence saying what the change does and why, like the existing history.
- Update [packages/next/README.md](packages/next/README.md) when you change something it describes.
