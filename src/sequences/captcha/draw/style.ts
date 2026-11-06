import { PALETTE } from '../../../config/palette';

/**
 * Colours for the CAPTCHA sequence: the spinner's exact palette plus a few
 * tints and shades derived from it (flat, stepped cel tones; no gradients).
 */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

export const C = {
  blue: PALETTE.blue,
  off: PALETTE.white,
  orange: PALETTE.orange,
  yellow: PALETTE.yellow,
  /** Hard drop shadow under the panel (deep blue, darker). */
  blueDeep: mix(PALETTE.blue, '#000000', 0.32),
  /** Muted UI blue for secondary controls and the separator. */
  blueMuted: mix(PALETTE.blue, PALETTE.white, 0.55),
  /** Shadow band on off-white shapes. */
  offShade: mix(PALETTE.white, PALETTE.blue, 0.13),
  /** Shadow band on orange shapes. */
  orangeShade: mix(PALETTE.orange, PALETTE.blue, 0.14),
  /** Deep orange (gulab jamun, interiors). */
  orangeDeep: mix(PALETTE.orange, PALETTE.blue, 0.3),
  /** Gold shadow band on yellow shapes. */
  gold: mix(PALETTE.yellow, PALETTE.orange, 0.38),
  /** Ladoo / sweet orange-yellow. */
  saffron: mix(PALETTE.orange, PALETTE.yellow, 0.45),
  /** Selected-tile background: warm yellow tint. */
  warm: mix(PALETTE.white, PALETTE.yellow, 0.42),
  /** White-hot core (same derivation as the spinner's HOT: yellow lifted toward white). */
  hot: mix(PALETTE.yellow, '#ffffff', 0.55),
} as const;

export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Design space: every drawing is authored on a 1080-wide frame. */
export const DESIGN_W = 1080;

export const TAU = Math.PI * 2;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x)));
export const easeOutBack = (x: number, s = 1.70158) => {
  const u = clamp01(x) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

/** Deterministic hash → [0, 1) for (seed, stream, index). No Math.random anywhere. */
export function rnd(seed: number, stream: number, index: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(stream + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(index + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1-D value noise in [−1, 1] (seeded, a pure function of x). */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(rnd(seed, 99, i), rnd(seed, 99, i + 1), s) * 2 - 1;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Closed polygon through points. */
export function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * Cel spark stroke (same construction as the spinner's sparks): a capsule from
 * head to tail with an orange edge, a gold body and a white-hot core near the head.
 */
export function sparkStroke(ctx: CanvasRenderingContext2D, hx: number, hy: number, tx: number, ty: number, w: number, core = true) {
  if (w <= 0.3) return;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.strokeStyle = C.orange;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = w * 0.62;
  ctx.stroke();
  if (core) {
    ctx.beginPath();
    ctx.moveTo(hx + (tx - hx) * 0.45, hy + (ty - hy) * 0.45);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = C.hot;
    ctx.lineWidth = w * 0.3;
    ctx.stroke();
  }
}
