import type { CaptchaParams } from '../config';
import { C, TAU, clamp01, easeOutCubic, easeOutExpo, poly, rnd, sparkStroke } from './style';

/**
 * The rocket's burst and the yellow takeover, all closed-form in the burst age
 * a = t − burstAt (seek-safe). Layers, back to front:
 *   rays (thick angular kites, orange / yellow) → fragmented rings (off-white,
 *   orange) → serrated takeover disc (orange edge band + yellow) → chunky cel
 *   sparks and geometric shards → white-hot flash.
 * The disc's valley radius reaches the farthest frame corner exactly at
 * `fillAt`; after that the frame is solid #ffde59.
 */

const FRONT_R0 = 60;
const FRONT_R1 = 960;
const FRONT_S = 0.55;

/** Radius of the leading (off-white) ring: also the shock front that blows the panel apart. */
export function frontRadius(a: number): number {
  return FRONT_R0 + (FRONT_R1 - FRONT_R0) * easeOutCubic(a / FRONT_S);
}

/** Burst age at which the front reaches distance d. */
export function frontHitAge(d: number): number {
  if (d <= FRONT_R0) return 0;
  const x = Math.min(1, (d - FRONT_R0) / (FRONT_R1 - FRONT_R0));
  return FRONT_S * (1 - Math.cbrt(1 - x));
}

/** Distance from the burst point to the farthest frame corner. */
export function coverRadius(p: CaptchaParams, H: number): number {
  return Math.hypot(540, Math.max(p.burstY, H - p.burstY));
}

/** Valley (inner) radius of the takeover disc. */
function discRadius(p: CaptchaParams, a: number, H: number): number {
  const x = clamp01(a / (p.fillAt - p.burstAt));
  const pop = 170 * (1 - Math.exp(-a / 0.05));
  const target = coverRadius(p, H) + 12;
  return pop + (target - 170) * Math.pow(x, 2.2);
}

function serrated(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spike: number, n: number, rot: number) {
  const pts: [number, number][] = [];
  for (let k = 0; k < 2 * n; k++) {
    const a = rot + (k / (2 * n)) * TAU;
    const rr = k % 2 ? r : r + spike * (k % 4 === 0 ? 1 : 0.62);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  poly(ctx, pts);
}

export function drawExplosion(ctx: CanvasRenderingContext2D, p: CaptchaParams, t: number, H: number) {
  const a = t - p.burstAt;
  if (a < 0) return;
  const cx = 540;
  const cy = p.burstY;
  const Rc = coverRadius(p, H);

  // Rays: long kites, thick near the centre, sharp tips beyond the frame.
  const grow = easeOutExpo(a / 0.42);
  const spin = 0.2 * easeOutCubic(a / 1.2);
  for (const layer of [0, 1]) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const j = layer * n + i;
      const th = ((i + layer * 0.5) / n) * TAU + (rnd(p.seed, 10, j) - 0.5) * 0.18 + spin * (layer ? -1 : 1);
      const L = Rc * (layer ? 1.25 : 1.6) * (0.85 + 0.3 * rnd(p.seed, 11, j)) * grow;
      const hw = layer ? 0.1 : 0.15;
      const m = 0.28 * L;
      poly(ctx, [
        [cx, cy],
        [cx + Math.cos(th - hw) * m, cy + Math.sin(th - hw) * m],
        [cx + Math.cos(th) * L, cy + Math.sin(th) * L],
        [cx + Math.cos(th + hw) * m, cy + Math.sin(th + hw) * m],
      ]);
      ctx.fillStyle = layer ? C.yellow : C.orange;
      ctx.fill();
    }
  }

  // Fragmented rings: arcs that expand and thin out (by width, not opacity).
  const ring = (age: number, r: number, w: number, segs: number, rot: number, color: string) => {
    if (age < 0 || w <= 0.5) return;
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    for (let s = 0; s < segs; s++) {
      const a0 = rot + (s / segs) * TAU;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + (TAU / segs) * 0.68);
      ctx.stroke();
    }
  };
  ring(a, frontRadius(a), 44 * Math.pow(clamp01(1 - a / 0.6), 0.7), 12, 0.35 * a, C.off);
  const a2 = a - 0.08;
  ring(a2, 40 + 760 * easeOutCubic(a2 / 0.62), 30 * Math.pow(clamp01(1 - a2 / 0.62), 0.7), 9, 0.6 - 0.45 * a2, C.orange);

  // Takeover: orange edge band, then the yellow disc; serrated so it reads as a burst, not a fade.
  const r = discRadius(p, a, H);
  const spike = 26 + 0.14 * r;
  const rot = 0.3 * a;
  serrated(ctx, cx, cy, r * 1.06 + 22, spike * 1.15, 26, rot + 0.06);
  ctx.fillStyle = C.orange;
  ctx.fill();
  serrated(ctx, cx, cy, r, spike, 26, rot);
  ctx.fillStyle = C.yellow;
  ctx.fill();

  // Chunky cel sparks (same stroke as the spinner's sparks).
  const k = 2.7;
  const g = 520;
  for (let i = 0; i < p.sparkCount; i++) {
    const delay = 0.06 * rnd(p.seed, 20, i);
    const s = a - delay;
    const life = 0.45 + 0.4 * rnd(p.seed, 21, i);
    if (s < 0 || s > life) continue;
    const th = (i / p.sparkCount) * TAU + (rnd(p.seed, 22, i) - 0.5) * 0.35;
    const v0 = 1100 + 1500 * Math.pow(rnd(p.seed, 23, i), 0.7);
    const e = Math.exp(-k * s);
    const f = (1 - e) / k;
    const x = cx + Math.cos(th) * v0 * f;
    const y = cy + Math.sin(th) * v0 * f + g * (s / k - f / k);
    const vx = Math.cos(th) * v0 * e;
    const vy = Math.sin(th) * v0 * e + (g * (1 - e)) / k;
    const w = (15 + 9 * rnd(p.seed, 24, i)) * Math.pow(1 - s / life, 0.5);
    sparkStroke(ctx, x, y, x - vx * 0.05, y - vy * 0.05, w);
  }

  // Geometric shards: sharp four-point stars, spinning outward.
  for (let i = 0; i < 26; i++) {
    const life = 0.55 + 0.35 * rnd(p.seed, 40, i);
    if (a > life) continue;
    const th = (i / 26) * TAU + rnd(p.seed, 41, i) * 0.4;
    const v0 = 700 + 900 * rnd(p.seed, 42, i);
    const f = (1 - Math.exp(-2.2 * a)) / 2.2;
    const x = cx + Math.cos(th) * v0 * f;
    const y = cy + Math.sin(th) * v0 * f + 300 * a * a;
    const size = (22 + 20 * rnd(p.seed, 43, i)) * (1 - a / life);
    const ang = (rnd(p.seed, 44, i) - 0.5) * 8 * a;
    const pts: [number, number][] = [];
    for (let q = 0; q < 8; q++) {
      const rr = q % 2 ? size * 0.32 : size;
      const aa = ang + (q / 8) * TAU;
      pts.push([x + Math.cos(aa) * rr, y + Math.sin(aa) * rr]);
    }
    poly(ctx, pts);
    ctx.fillStyle = i % 3 === 0 ? C.orange : C.off;
    ctx.fill();
  }

  // Flash: a white-hot star at the burst point for the first ~0.2 s.
  if (a < 0.2) {
    const fr = 250 * Math.sin((Math.PI * a) / 0.2);
    const pts: [number, number][] = [];
    for (let q = 0; q < 24; q++) {
      const rr = q % 2 ? fr * 0.42 : fr;
      const aa = (q / 24) * TAU + 0.1;
      pts.push([cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr]);
    }
    poly(ctx, pts);
    ctx.fillStyle = C.hot;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, fr * 0.3, 0, TAU);
    ctx.fillStyle = C.off;
    ctx.fill();
  }
}
