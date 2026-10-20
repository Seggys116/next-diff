import type {
  Anchor,
  Block,
  ChangeStatus,
  DiffResult,
  DiffStats,
  Pair,
  PageSnapshot,
  StyleChange,
  TextSeg,
} from "./types";

type Group = "text" | "media" | "input" | "region";

interface Prep {
  b: Block;
  group: Group;
  key: string | null;
  norm: string;
  toks: Set<string>;
  grams: Set<string> | null;
  file: string;
  ar: number;
}

const TEXTY = new Set(["heading", "text", "list-item", "link", "button"]);

function groupOf(kind: Block["kind"]): Group {
  if (TEXTY.has(kind)) return "text";
  if (kind === "image" || kind === "graphic" || kind === "media") return "media";
  if (kind === "input") return "input";
  return "region";
}

function normText(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const p = ` ${s} `;
  for (let i = 0; i < p.length - 1; i++) out.add(p.slice(i, i + 2));
  return out;
}

function fileOf(src: string | undefined): string {
  if (!src) return "";
  const last = src.split("/").pop() ?? "";
  return last
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_.]?[0-9a-f]{8,}$/i, "")
    .replace(/[-_]\d{2,4}x\d{2,4}$/i, "");
}

function prep(b: Block): Prep {
  const group = groupOf(b.kind);
  const norm = group === "media" ? normText(b.alt) : normText(b.text);
  let key: string | null = null;
  if (group === "text") key = norm.length >= 3 ? `t|${norm}` : null;
  else if (group === "media") key = b.src ? `m|${b.src}` : null;
  else if (group === "input") key = `i|${b.alt ?? ""}|${norm}`;
  else key = norm ? `r|${b.rt ?? ""}|${norm}` : null;
  return {
    b,
    group,
    key,
    norm,
    toks: new Set(norm ? norm.split(" ") : []),
    grams: group === "text" || group === "region" ? (norm ? bigrams(norm) : null) : null,
    file: fileOf(b.src),
    ar: b.h > 0 ? b.w / b.h : 0,
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function textSim(a: Prep, b: Prep): number {
  if (!a.norm || !b.norm) return 0;
  if (a.norm === b.norm) return 1;
  const la = a.norm.length;
  const lb = b.norm.length;
  const ratio = Math.min(la, lb) / Math.max(la, lb);
  if (ratio < 0.3 && Math.min(la, lb) > 12) return 0;
  const jac = jaccard(a.toks, b.toks);
  if (jac === 0 && Math.min(la, lb) >= 14) return 0;
  const d = a.grams && b.grams ? dice(a.grams, b.grams) : 0;
  return Math.max(jac, d * 0.97);
}

const THRESH: Record<Group, number> = { text: 0.45, media: 0.3, input: 0.5, region: 0.3 };

function sim(a: Prep, b: Prep): number {
  if (a.group !== b.group) return 0;
  switch (a.group) {
    case "text": {
      const s = textSim(a, b);
      if (s === 0) return 0;
      const short = Math.min(a.norm.length, b.norm.length) < 10;
      if (short && s < 0.6) return 0;
      const factor = a.b.kind === b.b.kind ? 1 : a.b.kind === "heading" || b.b.kind === "heading" ? 0.85 : 0.93;
      const out = s * factor;
      return out >= THRESH.text ? out : 0;
    }
    case "media": {
      let s = 0;
      if (a.b.src && a.b.src === b.b.src) s = 1;
      else if (a.file && a.file === b.file) s = 0.9;
      else if (a.norm && a.norm === b.norm) s = 0.8;
      else if (a.ar > 0 && b.ar > 0) {
        const ar = Math.min(a.ar, b.ar) / Math.max(a.ar, b.ar);
        const w = Math.min(a.b.w, b.b.w) / Math.max(a.b.w, b.b.w);
        if (ar >= 0.9 && w >= 0.55) s = 0.32;
      }
      if (a.b.kind !== b.b.kind) s *= 0.8;
      return s >= THRESH.media ? s : 0;
    }
    case "input": {
      if ((a.b.alt ?? "") !== (b.b.alt ?? "")) return 0;
      return 0.6 + 0.4 * (a.norm === b.norm ? 1 : textSim(a, b));
    }
    case "region": {
      if ((a.b.rt ?? "") !== (b.b.rt ?? "")) return 0;
      if (a.norm && b.norm) {
        if (a.norm === b.norm) return 1;
        const s = textSim(a, b) * 0.9;
        if (s >= 0.45) return s;
      }
      // Same kind of landmark in a similar slot stays one section even if the heading changed.
      const hr = Math.min(a.b.h, b.b.h) / Math.max(a.b.h, b.b.h, 1);
      return hr >= 0.35 ? 0.32 : 0;
    }
  }
}

type Op = { i?: number; j?: number; s: number };

function lis(pairs: Array<[number, number]>): Array<[number, number]> {
  // pairs sorted by [0]; longest strictly increasing subsequence on [1].
  const tails: number[] = [];
  const prev: number[] = new Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[k][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out: Array<[number, number]> = [];
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    out.push(pairs[k]);
    k = prev[k];
  }
  return out.reverse();
}

function alignGap(A: Prep[], B: Prep[], a0: number, a1: number, b0: number, b1: number, ops: Op[]) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n <= 0 || m <= 0) {
    for (let i = a0; i < a1; i++) ops.push({ i, s: 0 });
    for (let j = b0; j < b1; j++) ops.push({ j, s: 0 });
    return;
  }

  if (n * m > 4_000_000) {
    // Too large for the full DP: monotone two-pointer fallback.
    let j = b0;
    for (let i = a0; i < a1; i++) {
      let hit = -1;
      let hs = 0;
      for (let k = j; k < Math.min(b1, j + 40); k++) {
        const s = sim(A[i], B[k]);
        if (s > hs) {
          hs = s;
          hit = k;
        }
      }
      if (hit >= 0) {
        for (; j < hit; j++) ops.push({ j, s: 0 });
        ops.push({ i, j: hit, s: hs });
        j = hit + 1;
      } else ops.push({ i, s: 0 });
    }
    for (; j < b1; j++) ops.push({ j, s: 0 });
    return;
  }

  const W = m + 1;
  const dp = new Float32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sim(A[a0 + i - 1], B[b0 + j - 1]);
      let best = dp[(i - 1) * W + j];
      const left = dp[i * W + j - 1];
      if (left > best) best = left;
      if (s > 0) {
        const diag = dp[(i - 1) * W + j - 1] + s;
        if (diag > best) best = diag;
      }
      dp[i * W + j] = best;
    }
  }

  const rev: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = sim(A[a0 + i - 1], B[b0 + j - 1]);
      if (s > 0 && Math.abs(dp[i * W + j] - (dp[(i - 1) * W + j - 1] + s)) < 1e-4) {
        rev.push({ i: a0 + i - 1, j: b0 + j - 1, s });
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && (i === 0 || Math.abs(dp[i * W + j] - dp[i * W + j - 1]) < 1e-4)) {
      rev.push({ j: b0 + j - 1, s: 0 });
      j--;
    } else {
      rev.push({ i: a0 + i - 1, s: 0 });
      i--;
    }
  }
  for (let k = rev.length - 1; k >= 0; k--) ops.push(rev[k]);
}

function parseColor(c: string | undefined): [number, number, number, number] | null {
  if (!c) return null;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
  return [p[0], p[1], p[2], p[3] ?? 1];
}

export function colorToHex(c: string | undefined): string {
  const p = parseColor(c);
  if (!p) return c ?? "";
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(p[0])}${h(p[1])}${h(p[2])}${p[3] < 1 ? h(p[3] * 255) : ""}`;
}

function sameColor(a?: string, b?: string): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a === b;
  return Math.abs(pa[0] - pb[0]) <= 2 && Math.abs(pa[1] - pb[1]) <= 2 && Math.abs(pa[2] - pb[2]) <= 2 && Math.abs(pa[3] - pb[3]) <= 0.05;
}

const px = (v?: string) => (v ? parseFloat(v) : NaN);

function styleDiff(a: Block, b: Block, group: Group): StyleChange[] {
  const out: StyleChange[] = [];
  const sa = a.st ?? {};
  const sb = b.st ?? {};
  const color = (prop: string, label: string, x?: string, y?: string) => {
    if (!sameColor(x, y)) out.push({ prop, label, a: colorToHex(x) || "none", b: colorToHex(y) || "none", swatch: true });
  };
  if (group === "text" || group === "input") {
    color("c", "Text colour", sa.c, sb.c);
    color("bg", "Background", sa.bg, sb.bg);
    const fa = px(sa.fs);
    const fb = px(sb.fs);
    if (!Number.isNaN(fa) && !Number.isNaN(fb) && Math.abs(fa - fb) >= 0.75) {
      out.push({ prop: "fs", label: "Font size", a: `${Math.round(fa * 10) / 10}px`, b: `${Math.round(fb * 10) / 10}px` });
    }
    if (sa.fw && sb.fw && Math.abs(+sa.fw - +sb.fw) >= 100) out.push({ prop: "fw", label: "Weight", a: sa.fw, b: sb.fw });
    if (sa.ff && sb.ff && sa.ff.toLowerCase() !== sb.ff.toLowerCase()) out.push({ prop: "ff", label: "Font", a: sa.ff, b: sb.ff });
    if (sa.ta && sb.ta && sa.ta !== sb.ta && !(["start", "left"].includes(sa.ta) && ["start", "left"].includes(sb.ta))) {
      out.push({ prop: "ta", label: "Alignment", a: sa.ta, b: sb.ta });
    }
    if ((sa.tt ?? "none") !== (sb.tt ?? "none")) out.push({ prop: "tt", label: "Case", a: sa.tt ?? "none", b: sb.tt ?? "none" });
    if ((sa.br ?? "0px") !== (sb.br ?? "0px") && (a.kind === "button" || a.kind === "link" || a.kind === "input")) {
      out.push({ prop: "br", label: "Corner radius", a: sa.br ?? "0px", b: sb.br ?? "0px" });
    }
  } else if (group === "region") {
    color("bg", "Background", sa.bg, sb.bg);
  } else {
    if ((sa.br ?? "0px") !== (sb.br ?? "0px")) out.push({ prop: "br", label: "Corner radius", a: sa.br ?? "0px", b: sb.br ?? "0px" });
  }

  // Box size (same viewport width on both sides, so this is meaningful).
  if (group !== "region" && !a.fixed && !b.fixed) {
    const dw = Math.abs(a.w - b.w);
    const dh = Math.abs(a.h - b.h);
    const wBig = dw > 24 && dw / Math.max(a.w, b.w, 1) > 0.15;
    const hBig = dh > 24 && dh / Math.max(a.h, b.h, 1) > 0.2;
    if (wBig || hBig) {
      out.push({ prop: "size", label: "Size", a: `${Math.round(a.w)}×${Math.round(a.h)}`, b: `${Math.round(b.w)}×${Math.round(b.h)}` });
    }
  }
  return out;
}

export function wordDiff(a: string, b: string): TextSeg[] {
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  if (ta.length > 140 || tb.length > 140) {
    return [
      { t: "del", s: a },
      { t: "ins", s: b },
    ];
  }
  const n = ta.length;
  const m = tb.length;
  const W = m + 1;
  const dp = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = ta[i] === tb[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const segs: TextSeg[] = [];
  const add = (t: TextSeg["t"], s: string) => {
    const last = segs[segs.length - 1];
    if (last && last.t === t) last.s += " " + s;
    else segs.push({ t, s });
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      add("eq", ta[i]);
      i++;
      j++;
    } else if (i < n && (j === m || dp[(i + 1) * W + j] >= dp[i * W + j + 1])) {
      add("del", ta[i++]);
    } else {
      add("ins", tb[j++]);
    }
  }
  return segs;
}

function pairId(a?: Block, b?: Block) {
  return `${a?.id ?? 0}-${b?.id ?? 0}`;
}

export function diffSnapshots(a: PageSnapshot, b: PageSnapshot): DiffResult {
  const A = a.blocks.map(prep);
  const B = b.blocks.map(prep);

  // 1) Patience anchors: keys that occur exactly once on each side.
  const idxA = new Map<string, number[]>();
  const idxB = new Map<string, number[]>();
  A.forEach((p, i) => p.key && (idxA.get(p.key)?.push(i) ?? idxA.set(p.key, [i])));
  B.forEach((p, j) => p.key && (idxB.get(p.key)?.push(j) ?? idxB.set(p.key, [j])));
  const cand: Array<[number, number]> = [];
  for (const [k, la] of idxA) {
    const lb = idxB.get(k);
    if (la.length === 1 && lb && lb.length === 1) cand.push([la[0], lb[0]]);
  }
  cand.sort((x, y) => x[0] - y[0]);
  const anchors = lis(cand);

  // 2) Weighted LCS inside each gap between anchors.
  const ops: Op[] = [];
  let pa = 0;
  let pb = 0;
  for (const [ai, bj] of anchors) {
    alignGap(A, B, pa, ai, pb, bj, ops);
    ops.push({ i: ai, j: bj, s: 1 });
    pa = ai + 1;
    pb = bj + 1;
  }
  alignGap(A, B, pa, A.length, pb, B.length, ops);

  // 3) Content that merely moved: pair leftovers on both sides.
  const removed = ops.map((o, k) => (o.i !== undefined && o.j === undefined ? k : -1)).filter((k) => k >= 0);
  const added = ops.map((o, k) => (o.j !== undefined && o.i === undefined ? k : -1)).filter((k) => k >= 0);
  const moved = new Set<number>();
  const dropped = new Set<number>();
  if (removed.length && added.length) {
    const byKey = new Map<string, number[]>();
    for (const k of added) {
      const p = B[ops[k].j!];
      if (p.key && p.group !== "region") (byKey.get(p.key) ?? byKey.set(p.key, []).get(p.key)!).push(k);
    }
    for (const k of removed) {
      const p = A[ops[k].i!];
      const list = p.key ? byKey.get(p.key) : undefined;
      if (list?.length) {
        const target = list.shift()!;
        ops[target] = { i: ops[k].i, j: ops[target].j, s: 1 };
        moved.add(target);
        dropped.add(k);
      }
    }
    const left = removed.filter((k) => !dropped.has(k));
    const leftAdd = added.filter((k) => !moved.has(k));
    if (left.length && leftAdd.length && left.length * leftAdd.length <= 160_000) {
      const used = new Set<number>();
      for (const k of left) {
        const pa2 = A[ops[k].i!];
        if (pa2.group === "region") continue;
        let best = -1;
        let bs = 0.8;
        for (const t of leftAdd) {
          if (used.has(t)) continue;
          const s = sim(pa2, B[ops[t].j!]);
          if (s >= bs) {
            bs = s;
            best = t;
          }
        }
        if (best >= 0) {
          used.add(best);
          ops[best] = { i: ops[k].i, j: ops[best].j, s: bs };
          moved.add(best);
          dropped.add(k);
        }
      }
    }
  }

  // A removal sitting next to an addition of the same kind is one replacement, not two edits.
  {
    let k = 0;
    while (k < ops.length) {
      if (dropped.has(k) || ops[k].i !== undefined === (ops[k].j !== undefined)) {
        k++;
        continue;
      }
      let end = k;
      while (end < ops.length && !dropped.has(end) && (ops[end].i !== undefined) !== (ops[end].j !== undefined)) end++;
      const rems: number[] = [];
      const adds: number[] = [];
      for (let t = k; t < end; t++) (ops[t].i !== undefined ? rems : adds).push(t);
      if (rems.length && adds.length) {
        const used = new Set<number>();
        for (const r of rems) {
          const pr = A[ops[r].i!];
          if (pr.group === "region") continue;
          const hit = adds.find((t) => !used.has(t) && B[ops[t].j!].b.kind === pr.b.kind && B[ops[t].j!].group === pr.group);
          if (hit === undefined) continue;
          used.add(hit);
          ops[hit] = { i: ops[r].i, j: ops[hit].j, s: 0.3 };
          dropped.add(r);
        }
      }
      k = end;
    }
  }

  const pairs: Pair[] = [];
  ops.forEach((op, k) => {
    if (dropped.has(k)) return;
    const pA = op.i !== undefined ? A[op.i] : undefined;
    const pB = op.j !== undefined ? B[op.j] : undefined;
    const ba = pA?.b;
    const bb = pB?.b;
    if (pA && !pB) {
      pairs.push({ id: pairId(ba, bb), status: "removed", a: ba, score: 0, order: pairs.length });
      return;
    }
    if (pB && !pA) {
      pairs.push({ id: pairId(ba, bb), status: "added", b: bb, score: 0, order: pairs.length });
      return;
    }
    if (!pA || !pB || !ba || !bb) return;

    const group = pA.group;
    let status: ChangeStatus = "same";
    let segs: TextSeg[] | undefined;
    if (group === "text" || group === "input") {
      if ((ba.text ?? "") !== (bb.text ?? "")) {
        status = "changed";
        segs = wordDiff(ba.text ?? "", bb.text ?? "");
      }
    } else if (group === "media") {
      if (ba.src !== bb.src) status = "changed";
    }
    // Regions only anchor alignment; their label changing isn't a change by itself.
    const styles = styleDiff(ba, bb, group);
    if (status === "same" && styles.length) status = "restyled";
    if (moved.has(k)) status = status === "changed" ? "changed" : "moved";
    pairs.push({
      id: pairId(ba, bb),
      status,
      a: ba,
      b: bb,
      score: op.s,
      segs,
      styles: styles.length ? styles : undefined,
      order: pairs.length,
    });
  });

  const stats = computeStats(pairs);
  const topLevel = rollUp(pairs, a.blocks, b.blocks);
  const contentA = a.blocks.filter((x) => x.kind !== "region").length;
  const contentB = b.blocks.filter((x) => x.kind !== "region").length;
  const matched = pairs.filter((p) => p.a && p.b && (p.a.kind !== "region")).length;
  const unrelated = Math.max(contentA, contentB) > 8 && matched / Math.max(contentA, contentB, 1) < 0.2;

  return {
    pairs,
    unrelated,
    topLevel,
    crowded: topLevel > 120,
    anchors: buildAnchors(pairs),
    stats,
    aVersion: a.v,
    bVersion: b.v,
  };
}

// Roll a wholly added or removed section into one row, and any run of three or more adjacent additions or removals into one change.
function rollUp(pairs: Pair[], blocksA: Block[], blocksB: Block[]): number {
  const byA = new Map(blocksA.map((x) => [x.id, x]));
  const byB = new Map(blocksB.map((x) => [x.id, x]));
  const regionPair = { added: new Map<number, Pair>(), removed: new Map<number, Pair>() };
  for (const p of pairs) {
    if (p.status === "removed" && p.a?.kind === "region") regionPair.removed.set(p.a.id, p);
    if (p.status === "added" && p.b?.kind === "region") regionPair.added.set(p.b.id, p);
  }

  const ancestor = (blk: Block, side: "a" | "b", status: "added" | "removed"): Pair | null => {
    const table = status === "added" ? regionPair.added : regionPair.removed;
    const lookup = side === "a" ? byA : byB;
    let r = blk.reg;
    let guard = 0;
    while (r && guard++ < 40) {
      const hit = table.get(r);
      if (hit) return hit;
      r = lookup.get(r)?.reg ?? 0;
    }
    return null;
  };

  for (const p of pairs) {
    if (p.status !== "added" && p.status !== "removed") continue;
    const blk = (p.status === "added" ? p.b : p.a)!;
    const host = ancestor(blk, p.status === "added" ? "b" : "a", p.status);
    if (host && host !== p) {
      p.parent = host.id;
      host.count = (host.count ?? 0) + 1;
    }
  }

  // Runs of adjacent unmatched content that no section already covers.
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.parent || (p.status !== "added" && p.status !== "removed") || (p.a ?? p.b)!.kind === "region") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pairs.length) {
      const n = pairs[j + 1];
      if (n.status !== p.status || n.parent || (n.a ?? n.b)!.kind === "region") break;
      j++;
    }
    if (j - i + 1 >= 3) {
      const leader = p;
      leader.run = { a: [], b: [] };
      for (let k = i; k <= j; k++) {
        const m = pairs[k];
        if (m.a) leader.run.a.push(m.a.id);
        if (m.b) leader.run.b.push(m.b.id);
        if (k > i) m.parent = leader.id;
      }
      leader.count = (leader.count ?? 0) + (j - i);
    }
    i = j + 1;
  }

  return pairs.filter((p) => !p.parent && p.status !== "same" && !((p.a ?? p.b)!.kind === "region" && p.status !== "added" && p.status !== "removed")).length;
}

function buildAnchors(pairs: Pair[]): Anchor[] {
  const eligible = pairs
    .filter((p) => p.a && p.b && p.status !== "moved" && !p.a.fixed && !p.b.fixed && !p.a.sticky && !p.b.sticky)
    .map((p) => [p.a!.y, p.b!.y] as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  // Dedupe near-identical Ys, then keep the longest order-preserving run.
  const deduped: Array<[number, number]> = [];
  for (const e of eligible) {
    const last = deduped[deduped.length - 1];
    if (last && e[0] - last[0] < 1) continue;
    deduped.push(e);
  }
  return lis(deduped).map(([ya, yb]) => ({ a: ya, b: yb }));
}

function computeStats(pairs: Pair[]): DiffStats {
  const s: DiffStats = { total: 0, same: 0, changed: 0, restyled: 0, moved: 0, removed: 0, added: 0, similarity: 100 };
  let weight = 0;
  for (const p of pairs) {
    const isRegion = (p.a ?? p.b)?.kind === "region";
    if (isRegion) continue;
    s.total++;
    s[p.status]++;
    weight +=
      p.status === "same" ? 1 : p.status === "restyled" ? 0.85 : p.status === "moved" ? 0.9 : p.status === "changed" ? 0.7 * p.score : 0;
  }
  s.similarity = s.total ? Math.round((weight / s.total) * 100) : 100;
  return s;
}

export interface ScrollMap {
  aToB: (y: number) => number;
  bToA: (y: number) => number;
}

function interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return x;
  if (x <= xs[0]) return ys[0] + (x - xs[0]);
  if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

export interface PageMetrics {
  docH: number;
  vh: number;
}

// Piecewise scroll map through matched blocks, lined up on a reference line ~30% down the viewport.
export function buildScrollMap(anchors: Anchor[], A: PageMetrics, B: PageMetrics, ref = 0.3): ScrollMap {
  const maxA = Math.max(0, A.docH - A.vh);
  const maxB = Math.max(0, B.docH - B.vh);
  const pts: Array<[number, number]> = [[0, 0]];
  for (const an of anchors) {
    const sa = Math.min(maxA, Math.max(0, an.a - ref * A.vh));
    const sb = Math.min(maxB, Math.max(0, an.b - ref * B.vh));
    pts.push([sa, sb]);
  }
  pts.push([maxA, maxB]);
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const mono = (flip: boolean) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of pts) {
      const x = flip ? p[1] : p[0];
      const y = flip ? p[0] : p[1];
      const lx = xs[xs.length - 1];
      const ly = ys[ys.length - 1];
      if (lx !== undefined && x <= lx + 0.5) continue;
      if (ly !== undefined && y < ly) continue;
      xs.push(x);
      ys.push(y);
    }
    return [xs, ys] as const;
  };
  const [xa, ya] = mono(false);
  const [xb, yb] = mono(true);
  return {
    aToB: (y) => Math.max(0, Math.min(maxB, interp(xa, ya, y))),
    bToA: (y) => Math.max(0, Math.min(maxA, interp(xb, yb, y))),
  };
}
