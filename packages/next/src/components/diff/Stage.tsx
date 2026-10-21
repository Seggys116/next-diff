"use client";

/* eslint-disable react-hooks/refs -- pane handles expose getScroll and bindIframe */

import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  ExternalLink,
  GripVertical,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DiffResult, Pair } from "@/lib/diff/types";
import { cn } from "@/lib/utils";
import type { Device, ViewMode } from "./devices";
import type { Pane, PaneId } from "./usePane";
import { StatusDot } from "./primitives/StatusDot";
import { Favicon } from "./Favicon";
import { HEADER_H, Ribbons } from "./Ribbons";
import { useHandoff } from "./devtools";
import { EASE, Segmented } from "./ui";

const PAD = 20;
const GUTTER_RIBBONS = 44;
const GUTTER_PLAIN = 20;
const BAR_H = 64;

export interface StageProps {
  a: Pane;
  b: Pane;
  mode: ViewMode;
  device: Device;
  landscape: boolean;
  customW: number;
  diff: DiffResult | null;
  selected: Pair | null;
  showRibbons: boolean;
  onReload: (pane: PaneId) => void;
  /** Covers the left pane while it is travelling to another point in history. */
  travel?: React.ReactNode;
  onHeaderClick?: (pane: PaneId) => void;
}

interface Target {
  s: number;
  dw: number;
  dh: number;
  bz: number;
  ax: number;
  bx: number;
  y: number;
}

function computeTarget(
  size: { w: number; h: number },
  mode: ViewMode,
  device: Device,
  landscape: boolean,
  customW: number,
  ribbons: boolean,
): Target {
  const side = mode === "side";
  const cols = side ? 2 : 1;
  const gutter = side ? (ribbons ? GUTTER_RIBBONS : GUTTER_PLAIN) : 0;
  const availW = Math.max(120, (size.w - PAD * 2 - gutter) / cols);
  const header = side ? HEADER_H : 0;
  const bottom = side ? 0 : BAR_H;
  const availH = Math.max(160, size.h - PAD * 2 - header - bottom);

  let dw = device.id === "custom" ? customW : device.w;
  let dhFixed: number | null = device.h === "fill" ? null : device.h;
  if (landscape && dhFixed !== null) {
    const t = dw;
    dw = dhFixed;
    dhFixed = t;
  }
  const bz = device.bezel;
  const innerW = availW - bz * 2;
  const innerH = availH - bz * 2;
  const s = Math.max(
    0.12,
    Math.min(1, innerW / dw, dhFixed ? innerH / dhFixed : Infinity),
  );
  const dh = dhFixed ?? innerH / s;
  const cw = dw * s + bz * 2;
  const ch = dh * s + bz * 2;

  const colLeft = PAD + (availW - cw) / 2;
  const ax = colLeft;
  const bx = side ? PAD + availW + gutter + (availW - cw) / 2 : colLeft;
  const totalH = header + ch;
  const y = PAD + Math.max(0, (size.h - PAD * 2 - bottom - totalH) / 2);
  return { s, dw, dh, bz, ax, bx, y };
}

export function Stage(props: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={host} className="relative h-full w-full overflow-hidden">
      {size.w > 0 && <StageInner {...props} host={host} size={size} />}
    </div>
  );
}

function StageInner(
  props: StageProps & {
    host: React.RefObject<HTMLDivElement | null>;
    size: { w: number; h: number };
  },
) {
  const {
    a,
    b,
    mode,
    device,
    landscape,
    customW,
    diff,
    selected,
    showRibbons,
    host,
    size,
  } = props;

  const [first] = useState(() =>
    computeTarget(size, mode, device, landscape, customW, showRibbons),
  );
  const overlayAtStart = mode !== "side";
  const s = useMotionValue(first.s);
  const dw = useMotionValue(first.dw);
  const dh = useMotionValue(first.dh);
  const bz = useMotionValue(first.bz);
  const ax = useMotionValue(first.ax);
  const bx = useMotionValue(first.bx);
  const y = useMotionValue(first.y);
  const headerOpacity = useMotionValue(overlayAtStart ? 0 : 1);
  const bClip = useMotionValue(mode === "slider" ? 1 : 0);
  const bOpacity = useMotionValue(1);
  const barOpacity = useMotionValue(overlayAtStart ? 1 : 0);

  const pct = useMotionValue(50);
  const [fade, setFade] = useState(50);
  const [interact, setInteract] = useState<"a" | "b">("b");
  const lastKey = useRef(`${mode}|${device.id}|${landscape}|${showRibbons}`);
  const firstRun = useRef(true);

  const target = useMemo(
    () => computeTarget(size, mode, device, landscape, customW, showRibbons),
    [size, mode, device, landscape, customW, showRibbons],
  );

  // Tell the page that is shrinking into the viewer exactly where its slot is.
  const handoff = useHandoff();
  const { slot, onLayout } = handoff;
  useEffect(() => {
    if (!onLayout || !slot || mode !== "side") return;
    const at = host.current?.getBoundingClientRect();
    if (!at) return;
    const bz = target.bz;
    onLayout(
      {
        x: at.left + (slot === "a" ? target.ax : target.bx) + bz,
        y: at.top + target.y + HEADER_H + bz,
        w: target.dw * target.s,
        h: target.dh * target.s,
      },
      Math.max(6, device.radius - device.bezel),
    );
  }, [onLayout, slot, mode, target, device.radius, device.bezel, host]);

  // Animate between layouts when the device / mode changes; follow resizes instantly.
  useEffect(() => {
    const key = `${mode}|${device.id}|${landscape}|${showRibbons}`;
    const changed = key !== lastKey.current;
    lastKey.current = key;
    const glide = changed && !firstRun.current;
    firstRun.current = false;
    const apply = (mv: MotionValue<number>, v: number) =>
      glide ? animate(mv, v, { duration: 0.7, ease: EASE }) : mv.set(v);
    apply(s, target.s);
    apply(dw, target.dw);
    apply(dh, target.dh);
    apply(bz, target.bz);
    apply(ax, target.ax);
    apply(bx, target.bx);
    apply(y, target.y);
    const overlay = mode !== "side";
    const to = (mv: MotionValue<number>, v: number, d: number) =>
      glide ? animate(mv, v, { duration: d, ease: EASE }) : mv.set(v);
    to(headerOpacity, overlay ? 0 : 1, 0.45);
    to(barOpacity, overlay ? 1 : 0, 0.5);
    to(bOpacity, mode === "fade" ? fade / 100 : 1, 0.5);
    to(bClip, mode === "slider" ? 1 : 0, 0.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, mode, device.id, landscape, showRibbons]);

  useEffect(() => {
    if (mode === "fade") bOpacity.set(fade / 100);
  }, [fade, mode, bOpacity]);
  const cw = useTransform(
    [dw, s, bz] as MotionValue<number>[],
    ([d, sc, z]: number[]) => d * sc + z * 2,
  );
  const ch = useTransform(
    [dh, s, bz] as MotionValue<number>[],
    ([d, sc, z]: number[]) => d * sc + z * 2,
  );
  const screenW = useTransform(
    [dw, s] as MotionValue<number>[],
    ([d, sc]: number[]) => d * sc,
  );
  const screenH = useTransform(
    [dh, s] as MotionValue<number>[],
    ([d, sc]: number[]) => d * sc,
  );

  const sliderLeft = useTransform(
    [ax, bz, screenW, pct] as MotionValue<number>[],
    ([x, z, w, p]: number[]) => x + z + (w * p) / 100,
  );
  const sliderTop = useTransform(
    [y, bz] as MotionValue<number>[],
    ([yy, z]: number[]) => yy + z,
  );
  const clipInset = useTransform(
    [bClip, pct] as MotionValue<number>[],
    ([c, p]: number[]) => p * c,
  );
  const bClipPath = useMotionTemplate`inset(0 0 0 ${clipInset}%)`;
  const handleOpacity = bClip;
  const barY = useTransform(barOpacity, [0, 1], [16, 0]);

  const dragging = useRef(false);
  const onHandleDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return;
    const left = ax.get() + bz.get();
    const w = screenW.get();
    const p = ((e.clientX - rect.left - left) / w) * 100;
    pct.set(Math.max(0, Math.min(100, p)));
  };
  const onHandleUp = () => (dragging.current = false);

  const blend = mode === "difference";
  const overlay = mode !== "side";

  // A resize re-renders this every frame; pane frames must update only through motion values.
  const ribbonMv = useMemo(() => ({ s, ax, bx, y, cw, bz, screenH }), [s, ax, bx, y, cw, bz, screenH]);
  const mvA = useMemo(
    () => ({ x: ax, y, cw, ch, screenW, screenH, dw, dh, s, bz, headerOpacity }),
    [ax, y, cw, ch, screenW, screenH, dw, dh, s, bz, headerOpacity],
  );
  const mvB = useMemo(
    () => ({ x: bx, y, cw, ch, screenW, screenH, dw, dh, s, bz, headerOpacity }),
    [bx, y, cw, ch, screenW, screenH, dw, dh, s, bz, headerOpacity],
  );
  const { onReload } = props;
  const reloadA = useCallback(() => onReload("a"), [onReload]);
  const reloadB = useCallback(() => onReload("b"), [onReload]);

  return (
    <>
      {showRibbons && mode === "side" && (
        <Ribbons
          a={a}
          b={b}
          diff={diff}
          selected={selected?.id ?? null}
          radius={Math.max(6, device.radius)}
          mvs={ribbonMv}
          size={size}
        />
      )}

      <PaneFrame
        id="a"
        pane={a}
        index={0}
        mv={mvA}
        device={device}
        zIndex={1}
        pointerEvents={overlay && interact !== "a" ? "none" : "auto"}
        onReload={reloadA}
        overlay={overlay}
        travel={props.travel}
      />
      <PaneFrame
        id="b"
        pane={b}
        index={1}
        mv={mvB}
        device={device}
        zIndex={2}
        pointerEvents={overlay && interact !== "b" ? "none" : "auto"}
        onReload={reloadB}
        overlay={overlay}
        clipPath={bClipPath}
        opacity={bOpacity}
        blend={blend}
      />

      <motion.div
        className="absolute z-30"
        style={{
          left: sliderLeft,
          top: sliderTop,
          height: screenH,
          opacity: handleOpacity,
          pointerEvents: mode === "slider" ? "auto" : "none",
          x: "-50%",
        }}
      >
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          className="group relative flex h-full w-8 cursor-ew-resize touch-none items-center justify-center"
        >
          <div className="h-full w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_0_24px_rgba(255,255,255,0.25)]" />
          <div className="absolute top-1/2 flex h-9 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-zinc-900 text-white shadow-xl transition-transform duration-200 group-hover:scale-110">
            <GripVertical className="size-3.5" />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="absolute inset-x-0 bottom-3 z-40 flex justify-center"
        style={{
          opacity: barOpacity,
          y: barY,
          pointerEvents: overlay ? "auto" : "none",
        }}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/95 px-3 py-2 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)]">
          <Segmented
            size="sm"
            value={interact}
            onChange={setInteract}
            options={[
              { id: "a", label: "Use A" },
              { id: "b", label: "Use B" },
            ]}
          />
          <span className="h-5 w-px bg-white/10" />
          {mode === "fade" && (
            <label className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
              <span className="text-rose-300">A</span>
              <input
                type="range"
                min={0}
                max={100}
                value={fade}
                onChange={(e) => setFade(+e.target.value)}
                className="h-1 w-40 cursor-pointer accent-white"
                aria-label="Blend between A and B"
              />
              <span className="text-emerald-300">B</span>
            </label>
          )}
          {mode === "slider" && (
            <span className="text-[11px] font-medium text-zinc-400">
              Drag the handle to compare. Left is A, right is B.
            </span>
          )}
          {mode === "difference" && (
            <span className="text-[11px] font-medium text-zinc-400">
              Black means identical. Anything bright is different.
            </span>
          )}
        </div>
      </motion.div>
    </>
  );
}

interface FrameMV {
  x: MotionValue<number>;
  y: MotionValue<number>;
  cw: MotionValue<number>;
  ch: MotionValue<number>;
  screenW: MotionValue<number>;
  screenH: MotionValue<number>;
  dw: MotionValue<number>;
  dh: MotionValue<number>;
  s: MotionValue<number>;
  bz: MotionValue<number>;
  headerOpacity: MotionValue<number>;
}

const PaneFrame = memo(function PaneFrame({
  id,
  pane,
  index,
  mv,
  device,
  zIndex,
  pointerEvents,
  onReload,
  overlay,
  travel,
  clipPath,
  opacity,
  blend,
}: {
  id: PaneId;
  pane: Pane;
  index: number;
  mv: FrameMV;
  device: Device;
  zIndex: number;
  pointerEvents: "auto" | "none";
  onReload: () => void;
  overlay: boolean;
  travel?: React.ReactNode;
  clipPath?: MotionValue<string>;
  opacity?: MotionValue<number>;
  blend?: boolean;
}) {
  const { entered, landed, ghost } = useHandoff();
  // The pane your own page is shrinking into: it stays empty and see-through, and the page shows there.
  const isGhost = ghost === id;
  const st = pane.state;
  const loaded =
    st.status === "ready" || (st.status === "loading" && !!st.current);
  const errored = st.status === "error";
  const radius = device.radius;
  const innerRadius = Math.max(6, radius - device.bezel);

  return (
    <motion.div
      className="absolute left-0 top-0"
      style={{
        x: mv.x,
        y: mv.y,
        width: mv.cw,
        zIndex,
        pointerEvents: "none",
        opacity,
        mixBlendMode: blend ? "difference" : undefined,
      }}
    >
      <motion.div
        initial={isGhost ? { opacity: 0 } : { opacity: 0, y: 56, scale: 0.955 }}
        animate={
          isGhost
            ? { opacity: entered ? 1 : 0 }
            : entered
              ? { opacity: 1, y: 0, scale: 1 }
              : { opacity: 0, y: 56, scale: 0.955 }
        }
        transition={isGhost ? { duration: 0.35, ease: EASE, delay: 0.5 } : { duration: 1, ease: EASE, delay: 0.15 + index * 0.16 }}
        style={{ transformOrigin: "50% 0%" }}
      >
        <motion.div
          className="flex items-center gap-2.5 px-1"
          style={{
            height: HEADER_H,
            opacity: mv.headerOpacity,
            pointerEvents: "auto",
          }}
        >
          <Favicon src={st.icon} size={18} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-medium text-zinc-100">
              {st.title || hostOf(st.requested) || "Loading…"}
            </div>
            <div className="truncate font-mono text-[10.5px] text-zinc-500">
              {prettyUrl(st.current || st.requested)}
            </div>
          </div>
          {st.httpStatus && st.httpStatus >= 400 && (
            <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
              {st.httpStatus}
            </span>
          )}
          <StatusDot
            status={errored ? "failed" : st.status === "ready" ? "done" : st.status === "idle" ? "pending" : "running"}
            size={16}
            strokeWidth={1.6}
            color="#a1a1aa"
            doneColor="#34d399"
            errorColor="#fb7185"
            className="shrink-0"
          />
          <button
            type="button"
            onClick={onReload}
            aria-label={`Reload ${id.toUpperCase()}`}
            className="grid size-6 place-items-center rounded-md text-zinc-500 outline-none transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
              )}
            />
          </button>
          {(st.current || st.requested) && (
            <a
              href={st.current || st.requested}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the real page in a new tab"
              className="grid size-6 place-items-center rounded-md text-zinc-500 outline-none transition hover:bg-white/[0.06] hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </motion.div>

        <motion.div
          className="relative"
          style={{
            height: mv.ch,
            width: mv.cw,
            borderRadius: radius,
            pointerEvents: "none",
          }}
        >
          <motion.div
            className={cn(
              "absolute inset-0 transition-[background-color,box-shadow,border-color] duration-500",
              device.bezel > 0
                ? "bg-zinc-950 shadow-[0_24px_48px_-28px_rgba(0,0,0,0.7)]"
                : "bg-transparent",
            )}
            style={{
              borderRadius: radius,
              opacity: overlay && !device.bezel ? 0 : 1,
            }}
          />
          <motion.div
            className={cn("absolute isolate transform-gpu overflow-hidden", !isGhost && "bg-zinc-950")}
            style={{
              left: mv.bz,
              top: mv.bz,
              width: mv.screenW,
              height: mv.screenH,
              borderRadius: innerRadius,
              clipPath,
              pointerEvents,
            }}
          >
            {/* No page background: the probe supplies the canvas colour, so this slot is never painted white. */}
            <AnimatePresence initial={false}>
              {pane.src && (
                <motion.iframe
                  key={pane.src}
                  ref={pane.bindIframe}
                  src={pane.src}
                  name={pane.name}
                  title={`Page ${id.toUpperCase()}`}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads"
                  referrerPolicy="no-referrer"
                  className="absolute left-0 top-0 block border-0 bg-transparent"
                  initial={isGhost ? { opacity: 0 } : { opacity: 0, filter: "blur(10px)" }}
                  animate={
                    loaded && !errored && (!isGhost || landed)
                      ? { opacity: 1, filter: "blur(0px)" }
                      : isGhost
                        ? { opacity: 0 }
                        : { opacity: 0, filter: "blur(10px)" }
                  }
                  exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.45, ease: EASE } }}
                  transition={{ duration: isGhost ? 0.6 : 0.85, ease: EASE }}
                  style={{
                    width: mv.dw,
                    height: mv.dh,
                    scale: mv.s,
                    originX: 0,
                    originY: 0,
                  }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {!loaded && !errored && !isGhost && (
                <Skeleton key="sk" progress={st.status} />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {errored && <ErrorCard key="er" pane={pane} onRetry={onReload} />}
            </AnimatePresence>
            <AnimatePresence>{travel}</AnimatePresence>
            {pane.state.warm !== null && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-white/10">
                <div
                  className="h-full bg-white/80 transition-[width] duration-150"
                  style={{
                    width: `${Math.round((pane.state.warm ?? 0) * 100)}%`,
                  }}
                />
              </div>
            )}
          </motion.div>
          {/* Masks the light anti-aliased fringe the page leaves on the rounded screen corners. */}
          {device.bezel > 0 && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute z-10 shadow-[0_0_0_2px_#09090b,inset_0_0_0_1.5px_#09090b]"
              style={{
                left: mv.bz,
                top: mv.bz,
                width: mv.screenW,
                height: mv.screenH,
                borderRadius: innerRadius,
              }}
            />
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
});

function hostOf(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function prettyUrl(u: string) {
  try {
    const x = new URL(u);
    return x.host + (x.pathname === "/" ? "" : x.pathname) + x.search + x.hash;
  } catch {
    return u;
  }
}

function Skeleton({ progress }: { progress: string }) {
  return (
    <motion.div
      className="absolute inset-0 z-10 overflow-hidden bg-zinc-950"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <div className="absolute inset-0 p-[6%]">
        <div className="mb-[8%] flex items-center justify-between">
          <div className="h-3 w-[14%] rounded-full bg-white/[0.07]" />
          <div className="flex gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-2.5 w-10 rounded-full bg-white/[0.05]"
              />
            ))}
          </div>
        </div>
        <div className="mx-auto mb-3 h-[5%] w-[62%] rounded-xl bg-white/[0.08]" />
        <div className="mx-auto mb-3 h-[5%] w-[44%] rounded-xl bg-white/[0.08]" />
        <div className="mx-auto mb-[6%] mt-[4%] h-2.5 w-[50%] rounded-full bg-white/[0.05]" />
        <div className="mx-auto mb-[10%] h-9 w-[16%] rounded-full bg-white/[0.1]" />
        <div className="grid grid-cols-3 gap-[3%]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="aspect-[4/5] rounded-2xl bg-white/[0.045]"
            />
          ))}
        </div>
      </div>
      <div className="rbd-shimmer absolute inset-0" />
      <div className="absolute inset-x-0 bottom-4 text-center text-[11px] font-medium tracking-wide text-zinc-500">
        {progress === "registering" ? "Connecting…" : "Loading page…"}
      </div>
    </motion.div>
  );
}

function ErrorCard({ pane, onRetry }: { pane: Pane; onRetry: () => void }) {
  const e = pane.state.error;
  return (
    <motion.div
      className="absolute inset-0 z-20 grid place-items-center bg-zinc-950 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-full bg-rose-500/10 text-rose-300 ring-8 ring-rose-500/[0.06]">
          <TriangleAlert className="size-5" />
        </div>
        <h3 className="text-[15px] font-semibold text-zinc-100">
          {e?.title ?? "Something went wrong"}
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">
          {e?.message}
        </p>
        {e?.hint && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">
            {e.hint}
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-zinc-100 outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <RefreshCw className="size-3.5" /> Try again
        </button>
      </div>
    </motion.div>
  );
}
