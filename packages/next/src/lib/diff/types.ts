export type BlockKind =
  | "heading"
  | "text"
  | "list-item"
  | "link"
  | "button"
  | "image"
  | "graphic"
  | "media"
  | "input"
  | "region";

export interface BlockStyle {
  c?: string;
  bg?: string;
  fs?: string;
  fw?: string;
  ff?: string;
  ta?: string;
  tt?: string;
  ls?: string;
  br?: string;
  bi?: number;
}

export interface Block {
  id: number;
  kind: BlockKind;
  tag: string;
  text?: string;
  /** Normalised media source (path only) for images / media. */
  src?: string;
  raw?: string;
  alt?: string;
  href?: string;
  lvl?: number;
  /** Landmark type for regions. */
  rt?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Id of the enclosing region block (0 = none). */
  reg: number;
  fixed: boolean;
  sticky: boolean;
  depth: number;
  path: string;
  st?: BlockStyle;
  nw?: number;
  nh?: number;
  bg?: number;
}

export interface PageSnapshot {
  v: number;
  url: string;
  title: string;
  lang: string;
  docH: number;
  vw: number;
  vh: number;
  y: number;
  ms: number;
  truncated: boolean;
  blocks: Block[];
}

export type ChangeStatus =
  | "same"
  | "changed"
  | "restyled"
  | "moved"
  | "removed"
  | "added";

export interface TextSeg {
  t: "eq" | "del" | "ins";
  s: string;
}

export interface StyleChange {
  prop: string;
  label: string;
  a: string;
  b: string;
  swatch?: boolean;
}

export interface Pair {
  id: string;
  status: ChangeStatus;
  a?: Block;
  b?: Block;
  /** 0..1 similarity of the matched blocks. */
  score: number;
  segs?: TextSeg[];
  styles?: StyleChange[];
  /** Position in the combined, document-ordered list. */
  order: number;
  /** Set when this change is rolled up into another (its section, or a run of similar edits). */
  parent?: string;
  /** How many other changes this one stands in for. */
  count?: number;
  /** For a rolled-up run: every block id it covers, per side, so one box can outline them all. */
  run?: { a: number[]; b: number[] };
}

export interface Anchor {
  /** y of the block top in doc coordinates for A and B. */
  a: number;
  b: number;
}

export interface DiffStats {
  total: number;
  same: number;
  changed: number;
  restyled: number;
  moved: number;
  removed: number;
  added: number;
  /** 0..100 */
  similarity: number;
}

export interface DiffResult {
  pairs: Pair[];
  /** Pages share almost no content, so per-element highlights would only be noise. */
  unrelated: boolean;
  /** Changes left after roll-ups. */
  topLevel: number;
  /** So many changes that outlining each one would hide the page. */
  crowded: boolean;
  anchors: Anchor[];
  stats: DiffStats;
  aVersion: number;
  bVersion: number;
}
