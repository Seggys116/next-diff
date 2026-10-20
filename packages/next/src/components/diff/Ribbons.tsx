"use client";

/* eslint-disable react-hooks/refs -- ribbons read scroll and motion on every frame */

import type { MotionValue } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { Block, DiffResult, Pair } from "@/lib/diff/types";
import type { Pane } from "./usePane";

export const HEADER_H = 44;

const STATUS_RGB: Record<string, string> = {
  changed: "251,191,36",
  restyled: "167,139,250",
  moved: "56,189,248",
  removed: "251,113,133",
  added: "52,211,153",
  same: "255,255,255",
};

const MAX_PATHS = 120;

export interface RibbonMotion {
  s: MotionValue<number>;
  ax: MotionValue<number>;
  bx: MotionValue<number>;
  y: MotionValue<number>;
  cw: MotionValue<number>;
  bz: MotionValue<number>;
  screenH: MotionValue<number>;
}

interface Candidate {
  id: string;
  status: Pair["status"];
  A?: Block;
  B?: Block;
}

// Drawn on one canvas from scroll and motion events, so a scroll never waits on a React render.
export function Ribbons({
  a,
  b,
  diff,
  selected,
  radius,
  mvs,
  size,
}: {
  a: Pane;
  b: Pane;
  diff: DiffResult | null;
  selected: string | null;
  radius: number;
  mvs: RibbonMotion;
  size: { w: number; h: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const dpr = useRef(1);

  // Drop unchanged text once per diff; it can never draw a ribbon.
  const candidates = useMemo<Candidate[]>(() => {
    if (!diff || diff.unrelated || diff.crowded) return [];
    const out: Candidate[] = [];
    for (const p of diff.pairs) {
      if (p.parent) continue;
      const A = p.a;
      const B = p.b;
      if (p.status === "same" && (!A || !B || (A.kind !== "heading" && A.kind !== "image"))) continue;
      if (A && B && (A.fixed || B.fixed)) continue;
      out.push({ id: p.id, status: p.status, A, B });
    }
    return out;
  }, [diff]);

  // Everything the draw reads that React owns lives in a ref, so `draw` stays stable.
  const live = useRef({ candidates, selected, radius, size, a, b, mvs });
  live.current = { candidates, selected, radius, size, a, b, mvs };

  const draw = useRef(() => {});
  draw.current = () => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const { candidates: list, selected: sel, radius: rad, size: sz, a: pa, b: pb, mvs: mv } = live.current;
    const ratio = dpr.current;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, sz.w, sz.h);
    if (!list.length) return;

    const s = mv.s.get();
    const ax = mv.ax.get();
    const bx = mv.bx.get();
    const cw = mv.cw.get();
    const bz = mv.bz.get();
    const top = mv.y.get() + HEADER_H + bz;
    const vh = mv.screenH.get();
    const sa = pa.getScroll();
    const sb = pb.getScroll();

    // Ribbons run under the chassis, so the device outline clips them at the outer corner radius.
    const x0 = ax + cw;
    const x1 = bx;
    if (!(x1 > x0)) return;
    const mid = (x0 + x1) / 2;
    const tuck = Math.max(0, Math.min(rad + 4, cw / 2));
    const xa = x0 - tuck;
    const xb = x1 + tuck;
    const clamp = (v: number) => Math.max(top, Math.min(top + vh, v));

    ctx.save();
    ctx.beginPath();
    ctx.rect(xa, top, Math.max(0, xb - xa), vh);
    ctx.clip();
    ctx.lineJoin = "round";

    let drawn = 0;
    for (const c of list) {
      const { A, B } = c;
      const aT = A ? top + (A.y - sa.y) * s : 0;
      const aB = A ? aT + Math.max(2, A.h * s) : 0;
      const bT = B ? top + (B.y - sb.y) * s : 0;
      const bB = B ? bT + Math.max(2, B.h * s) : 0;
      const aVis = A ? aB >= top && aT <= top + vh : false;
      const bVis = B ? bB >= top && bT <= top + vh : false;
      if (!aVis && !bVis) continue;

      const isSel = sel === c.id;
      const strong = c.status !== "same";
      const rgb = STATUS_RGB[c.status];
      let fill: number;
      let stroke: number;
      const path = new Path2D();

      if (A && B) {
        const at = clamp(aT);
        const ab = Math.max(clamp(aB), at + 1.5);
        const bt = clamp(bT);
        const bb = Math.max(clamp(bB), bt + 1.5);
        path.moveTo(xa, at);
        path.lineTo(x0, at);
        path.bezierCurveTo(mid, at, mid, bt, x1, bt);
        path.lineTo(xb, bt);
        path.lineTo(xb, bb);
        path.lineTo(x1, bb);
        path.bezierCurveTo(mid, bb, mid, ab, x0, ab);
        path.lineTo(xa, ab);
        path.closePath();
        stroke = isSel ? 1.4 : strong ? 0.9 : 0.6;
        fill = isSel ? 0.34 : strong ? 0.16 : 0.035;
      } else if (A && aVis) {
        const at = clamp(aT);
        const ab = Math.max(clamp(aB), at + 3);
        path.moveTo(xa, at);
        path.lineTo(x0, at);
        path.lineTo(x0 + 16, (at + ab) / 2);
        path.lineTo(x0, ab);
        path.lineTo(xa, ab);
        path.closePath();
        stroke = 1;
        fill = isSel ? 0.7 : 0.4;
      } else if (B && bVis) {
        const bt = clamp(bT);
        const bb = Math.max(clamp(bB), bt + 3);
        path.moveTo(xb, bt);
        path.lineTo(x1, bt);
        path.lineTo(x1 - 16, (bt + bb) / 2);
        path.lineTo(x1, bb);
        path.lineTo(xb, bb);
        path.closePath();
        stroke = 1;
        fill = isSel ? 0.7 : 0.4;
      } else {
        continue;
      }

      ctx.fillStyle = `rgba(${rgb},${fill})`;
      ctx.strokeStyle = `rgba(${rgb},${Math.min(0.9, fill + 0.25)})`;
      ctx.lineWidth = stroke;
      ctx.fill(path);
      ctx.stroke(path);
      if (++drawn >= MAX_PATHS) break;
    }
    ctx.restore();
  };

  const schedule = useRef(() => {});
  schedule.current = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw.current();
    });
  };

  useEffect(() => {
    const go = () => schedule.current();
    const offs = [...Object.values(mvs).map((m) => m.on("change", go)), a.subscribeScroll(go), b.subscribeScroll(go)];
    return () => {
      offs.forEach((o) => o());
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [a, b, mvs]);

  // Backing store follows the stage size and the screen's pixel ratio.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    dpr.current = ratio;
    el.width = Math.max(1, Math.round(size.w * ratio));
    el.height = Math.max(1, Math.round(size.h * ratio));
    schedule.current();
  }, [size.w, size.h]);

  useEffect(() => {
    schedule.current();
  }, [candidates, selected, radius]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
