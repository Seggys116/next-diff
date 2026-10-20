// One forward pass: the usual script/head regexes are quadratic on an unclosed tag, and an unterminated opener ends the scan.

/** Longest start tag we will look inside. Real tags are a few hundred bytes. */
export const MAX_TAG = 16_384;

export interface Span {
  start: number;
  end: number;
}

export function* scriptBlocks(html: string): Generator<Span> {
  const open = /<script(?=[\s/>])/gi;
  const close = /<\/script>/gi;
  let pos = 0;
  for (;;) {
    open.lastIndex = pos;
    const o = open.exec(html);
    if (!o) return;
    const gt = html.indexOf(">", o.index + 7);
    if (gt === -1) return;
    close.lastIndex = gt + 1;
    const c = close.exec(html);
    if (!c) return;
    const end = c.index + c[0].length;
    yield { start: o.index, end };
    pos = end;
  }
}

// First start tag whose name matches opener, through its closing >.
export function findStartTag(html: string, opener: string, from = 0): Span | null {
  const re = new RegExp(opener, "gi");
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return null;
  const gt = html.indexOf(">", m.index + m[0].length);
  if (gt === -1) return null;
  return { start: m.index, end: gt + 1 };
}

export function* startTags(html: string, name: string): Generator<Span> {
  const re = new RegExp(`<${name}(?=[\\s/>])`, "gi");
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    const m = re.exec(html);
    if (!m) return;
    const gt = html.indexOf(">", m.index + m[0].length);
    if (gt === -1) return;
    yield { start: m.index, end: gt + 1 };
    pos = gt + 1;
  }
}

export function stripComments(html: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const s = html.indexOf("<!--", pos);
    if (s === -1) break;
    const e = html.indexOf("-->", s + 4);
    if (e === -1) break;
    out += html.slice(pos, s);
    pos = e + 3;
  }
  return out + html.slice(pos);
}

export function stripElements(html: string, name: string): string {
  const open = new RegExp(`<${name}(?=[\\s/>])`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  let out = "";
  let pos = 0;
  for (;;) {
    open.lastIndex = pos;
    const o = open.exec(html);
    if (!o) break;
    close.lastIndex = o.index + o[0].length;
    const c = close.exec(html);
    if (!c) break;
    out += html.slice(pos, o.index);
    pos = c.index + c[0].length;
  }
  return out + html.slice(pos);
}

export function titleText(html: string): string | undefined {
  const tag = findStartTag(html, "<title(?=[\\s>])");
  if (!tag) return undefined;
  const close = /<\/title\s*>/gi;
  close.lastIndex = tag.end;
  const c = close.exec(html);
  return c ? html.slice(tag.end, c.index) : undefined;
}
