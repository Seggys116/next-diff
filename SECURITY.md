# Security

next-diff is maintained by one person, so only the latest release gets fixes.

## Reporting a vulnerability

Please don't open a public issue. Use [Report a vulnerability](https://github.com/Seggys116/next-diff/security/advisories/new) on the Security tab instead, which keeps the report private until a fix is out.

Include the package version, your Node and Next.js versions, and the steps to reproduce. I'll reply as soon as I can.

The part most worth a look is the dev-only proxy. It fetches the live origin passed to `withDiff` and serves it on a `localhost` preview host. It is not part of a production build.
