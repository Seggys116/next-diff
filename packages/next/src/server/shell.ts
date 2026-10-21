import { PREFIX } from "../prefix";

export interface ShellConfig {
  prefix: string;
  /** The remote environments you configured. "Local" is added in the browser, from the address you're on. */
  environments: { id: string; label: string; origin: string; hint?: string }[];
  path: string;
  /** Opened by the button: your page is shrinking into the viewer, so the viewer stays see-through to let it show. */
  handoff: boolean;
  /** The project is in a Git repository: the left pane can switch from live to a past commit. */
  git: boolean;
}

export function shellHtml(config: ShellConfig): string {
  // "<" can never close the script tag from inside the JSON.
  const json = JSON.stringify(config).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");
  return `<!doctype html>
<html lang="en" class="dark" style="${config.handoff ? "background:transparent" : "background:#08080a"};color-scheme:dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>diff</title>
<link rel="stylesheet" href="${PREFIX}/assets/app.css">
</head>
<body style="margin:0;${config.handoff ? "background:transparent" : "background:#08080a"}">
<div id="root"></div>
<script>window.__DIFF=${json};</script>
<script type="module" src="${PREFIX}/assets/app.js"></script>
</body>
</html>`;
}
