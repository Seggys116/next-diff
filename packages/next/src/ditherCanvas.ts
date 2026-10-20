export interface DitherOptions {
  cell?: number;
  /** Animation speed multiplier. Default 1. 0 = static. */
  speed?: number;
  /** Glyph SVG drawn black or white per cell: plain inversion fails because red and green match the lightness of their inverses. */
  glyph?: string;
  glyphSize?: number;
}

type Rgb = readonly [number, number, number];

const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const RED = ['#0a0a0b', '#2a2a2e', '#a8394f', '#f43f5e'].map(hex);
const GREEN = ['#0a0a0b', '#2a2a2e', '#2f9e75', '#10b981'].map(hex);

// 4x4 ordered-dither (Bayer) thresholds, 0..1.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number): number => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

// Wave constants (cell units / radians per second): full cycles of ~8s and ~7s.
const K1 = 0.35;
const K2 = 0.6;
const W1 = (2 * Math.PI) / 8;
const W2 = (2 * Math.PI) / 7;
const COS_A = Math.cos(0.6);
const SIN_A = Math.sin(0.6);

const FRAME_MS = 50; // ~20 fps
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Brightness (0..1) of the picture averaged over a small square around each pixel, so a mark reads one colour over a region, not per cell. */
function localBrightness(px: Uint8ClampedArray, w: number, h: number, radius: number): Float32Array {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  // Summed-area table: each box average is four lookups.
  const stride = w + 1;
  const sum = new Float32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const total = sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
      out[y * w + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

export function startDither(canvas: HTMLCanvasElement, options: DitherOptions = {}): () => void {
  const cell = Math.max(1, options.cell ?? 2);
  const speed = options.speed ?? 1;
  const ctx = canvas.getContext('2d');
  const buffer = document.createElement('canvas');
  const bctx = buffer.getContext('2d');
  if (!ctx || !bctx) return () => {};

  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = !reduced && speed !== 0;

  // The glyph's coverage (0..255 per pixel) at the canvas's current pixel size, once its SVG has loaded.
  let glyphAlpha: Uint8ClampedArray | null = null;
  let haloAlpha: Uint8ClampedArray | null = null;
  let glyphFor = '';
  const glyphImage = new Image();
  let glyphReady = false;
  if (options.glyph) {
    glyphImage.onload = () => {
      glyphReady = true;
      glyphFor = '';
      if (!animate) paint();
    };
    glyphImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(options.glyph);
  }

  function rasterGlyph(pw: number, ph: number, scale: number): void {
    const key = pw + 'x' + ph;
    if (!glyphReady || glyphFor === key) return;
    glyphFor = key;
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const g = c.getContext('2d');
    if (!g) return;
    const size = Math.round((options.glyphSize ?? 22) * scale);
    g.drawImage(glyphImage, Math.round((pw - size) / 2), Math.round((ph - size) / 2), size, size);
    const px = g.getImageData(0, 0, pw, ph).data;
    glyphAlpha = new Uint8ClampedArray(pw * ph);
    for (let i = 0; i < glyphAlpha.length; i++) glyphAlpha[i] = px[i * 4 + 3];

    // A thin opposite-colour ring keeps the mark readable where the local average is a mid-tone.
    const r = Math.max(1, Math.round(scale));
    haloAlpha = new Uint8ClampedArray(pw * ph);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        let m = 0;
        for (let dy = -r; dy <= r && m < 255; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ph) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < pw && glyphAlpha[yy * pw + xx] > m) m = glyphAlpha[yy * pw + xx];
          }
        }
        haloAlpha[y * pw + x] = m;
      }
    }
  }

  let image: ImageData | null = null;
  let time = 0;
  let raf = 0;
  let last = 0;
  let stopped = false;

  function paint(): void {
    if (!ctx || !bctx) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(cssW * scale));
    const ph = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;

    const gw = Math.ceil(cssW / cell);
    const gh = Math.ceil(cssH / cell);
    if (!image || image.width !== gw || image.height !== gh) {
      buffer.width = gw;
      buffer.height = gh;
      image = bctx.createImageData(gw, gh);
    }
    const data = image.data;

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const t = clamp((x / gw) * 0.9 + (y / gh) * 0.1, 0, 1);
        const level = clamp(
          0.6 +
            0.3 * Math.sin(K1 * (x * COS_A + y * SIN_A) + time * W1) +
            0.15 * Math.sin(K2 * (x * 0.6 - y * 0.8) - time * W2),
          0,
          1,
        );
        const idx = Math.floor(clamp(level + (bayer(x, y) - 0.5) * 0.55, 0, 0.999) * 4);
        // Across the middle the two hues interleave, using a second threshold, rather than blending.
        let green = t >= 0.5;
        if (t > 0.38 && t < 0.62) green = (t - 0.38) / 0.24 > bayer(x + 2, y + 1);
        const [r, g, b] = (green ? GREEN : RED)[idx];
        const o = (y * gw + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }

    bctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(buffer, 0, 0, gw, gh, 0, 0, pw, ph);

    rasterGlyph(pw, ph, scale);
    if (glyphAlpha) {
      const out = ctx.getImageData(0, 0, pw, ph);
      const px = out.data;
      const near = localBrightness(px, pw, ph, Math.max(1, Math.round(cell * scale * 1.5)));
      for (let i = 0; i < glyphAlpha.length; i++) {
        const a = glyphAlpha[i];
        const h = haloAlpha ? haloAlpha[i] : 0;
        if (!a && !h) continue;
        const o = i * 4;
        const target = near[i] > 0.5 ? 0 : 255;
        if (h && a < 255) {
          const ring = 255 - target;
          const kr = (h / 255) * 0.55 * (1 - a / 255);
          px[o] = px[o] + (ring - px[o]) * kr;
          px[o + 1] = px[o + 1] + (ring - px[o + 1]) * kr;
          px[o + 2] = px[o + 2] + (ring - px[o + 2]) * kr;
        }
        if (!a) continue;
        const k = a / 255;
        px[o] = px[o] + (target - px[o]) * k;
        px[o + 1] = px[o + 1] + (target - px[o + 1]) * k;
        px[o + 2] = px[o + 2] + (target - px[o + 2]) * k;
      }
      ctx.putImageData(out, 0, 0);
    }
  }

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    time += ((last ? now - last : FRAME_MS) / 1000) * speed;
    last = now;
    paint();
  }

  function run(): void {
    if (!animate || stopped || raf) return;
    last = 0; // avoid a time jump after being paused
    raf = requestAnimationFrame(tick);
  }

  function halt(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') halt();
    else run();
  }

  const observer =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => paint()) : null;
  observer?.observe(canvas);

  paint();
  if (animate) {
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState !== 'hidden') run();
  }

  return () => {
    if (stopped) return;
    stopped = true;
    halt();
    observer?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
