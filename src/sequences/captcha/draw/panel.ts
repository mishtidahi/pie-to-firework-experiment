import type { CaptchaParams } from '../config';
import type { CaptchaState } from '../engine';
import { frontHitAge } from './explosion';
import { ICONS } from './icons';
import { C, FONT, TAU, clamp01, easeOutBack, easeOutCubic, rnd, roundRect } from './style';

/**
 * The CAPTCHA panel (design space, 1080 × 1920): an off-white card with a deep
 * blue header, a 3 × 3 grid of tiles and a control row with VERIFY.
 *
 * The card is built from pieces (header, nine grid cells, footer). At rest the
 * pieces tile the card seamlessly; when the burst's front reaches a piece it
 * breaks away (closed-form drift, spin and scale), so the interface is blown
 * apart by the explosion rather than vanishing before it arrives.
 */
export const PANEL = (() => {
  const w = 900;
  const x = (1080 - w) / 2;
  const y = 300;
  const pad = 20;
  const headH = 236;
  const gap = 12;
  const tile = (w - 2 * pad - 2 * gap) / 3;
  const grid = 3 * tile + 2 * gap;
  const footH = 124;
  const h = pad + headH + pad + grid + pad + footH;
  const gx = x + pad;
  const gy = y + pad + headH + pad;
  return { x, y, w, h, pad, headH, gap, tile, grid, footH, gx, gy, radius: 28 };
})();

export const tileRect = (i: number) => {
  const c = i % 3;
  const r = Math.floor(i / 3);
  return { x: PANEL.gx + c * (PANEL.tile + PANEL.gap), y: PANEL.gy + r * (PANEL.tile + PANEL.gap), s: PANEL.tile };
};

interface Piece {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  radii: [number, number, number, number];
  content: (ctx: CanvasRenderingContext2D, st: CaptchaState) => void;
}

const P = PANEL;
const half = P.gap / 2;
const colX = [P.x, P.gx + (P.tile + P.gap) - half, P.gx + 2 * (P.tile + P.gap) - half, P.x + P.w];
const rowY = [P.gy - P.pad / 2, P.gy + (P.tile + P.gap) - half, P.gy + 2 * (P.tile + P.gap) - half, P.gy + P.grid + P.pad / 2];

const PIECES: Piece[] = [
  { x0: P.x, y0: P.y, x1: P.x + P.w, y1: rowY[0], radii: [P.radius, P.radius, 0, 0], content: drawHeader },
  ...Array.from({ length: 9 }, (_, i): Piece => {
    const c = i % 3;
    const r = Math.floor(i / 3);
    return { x0: colX[c], y0: rowY[r], x1: colX[c + 1], y1: rowY[r + 1], radii: [0, 0, 0, 0], content: (ctx, st) => drawTile(ctx, i, st.sel[i], i === 8) };
  }),
  { x0: P.x, y0: rowY[3], x1: P.x + P.w, y1: P.y + P.h, radii: [0, 0, P.radius, P.radius], content: drawFooter },
];

// ── Header ────────────────────────────────────────────────────────────────

function drawHeader(ctx: CanvasRenderingContext2D) {
  const hx = P.x + P.pad;
  const hy = P.y + P.pad;
  const hw = P.w - 2 * P.pad;
  roundRect(ctx, hx, hy, hw, P.headH, 16);
  ctx.fillStyle = C.blue;
  ctx.fill();
  const left = hx + 40;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.off;
  ctx.font = `600 46px ${FONT}`;
  ctx.fillText('Select all images that', left, hy + 86);
  // Line 2: "will bring joy." with "joy" in yellow; shrinks to fit if a font runs wide.
  let size = 96;
  const avail = hw - 80;
  ctx.font = `800 ${size}px ${FONT}`;
  const full = ctx.measureText('will bring joy.').width;
  if (full > avail) {
    size = Math.floor((size * avail) / full);
    ctx.font = `800 ${size}px ${FONT}`;
  }
  const a = 'will bring ';
  ctx.fillStyle = C.off;
  ctx.fillText(a, left, hy + 192);
  const ax = left + ctx.measureText(a).width;
  ctx.fillStyle = C.yellow;
  ctx.fillText('joy', ax, hy + 192);
  ctx.fillStyle = C.off;
  ctx.fillText('.', ax + ctx.measureText('joy').width, hy + 192);
}

// ── Tiles ─────────────────────────────────────────────────────────────────

/** Press-down share of a selection (the tile switches to "selected" at its bottom). */
const PRESS = 0.22;

function drawTile(ctx: CanvasRenderingContext2D, i: number, p: number, last: boolean) {
  const { x, y, s } = tileRect(i);
  const cx = x + s / 2;
  const cy = y + s / 2;
  const selected = p >= PRESS;
  const q = selected ? (p - PRESS) / (1 - PRESS) : 0;
  // Tactile scale: press in, spring back with a small overshoot, settle exactly at 1.
  const amp = last ? 0.1 : 0.08;
  let scale = 1;
  if (p > 0 && !selected) scale = 1 - amp * Math.sin((Math.PI / 2) * (p / PRESS));
  else if (selected && q < 1) scale = 1 - amp * Math.exp(-3.4 * q) * Math.cos(5.8 * q) * (1 - Math.pow(q, 4));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  roundRect(ctx, x, y, s, s, 14);
  ctx.fillStyle = selected ? C.warm : C.off;
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  const iconScale = selected ? 1 - 0.1 * easeOutCubic(q / 0.4) : 1;
  ctx.scale(1.08 * iconScale, 1.08 * iconScale);
  ICONS[i](ctx);
  ctx.restore();

  // Border: thin blue at rest, a heavy orange frame once selected.
  const bw = selected ? 4 + 7 * easeOutCubic(q / 0.3) : 4;
  roundRect(ctx, x + bw / 2, y + bw / 2, s - bw, s - bw, 14 - bw / 2);
  ctx.lineWidth = bw;
  ctx.strokeStyle = selected ? C.orange : C.blue;
  ctx.stroke();

  if (selected) {
    // Ripple: an orange ring that expands and thins out (width, never opacity).
    if (q < 0.55) {
      const k = q / 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, s * (0.22 + 0.36 * easeOutCubic(k)), 0, TAU);
      ctx.lineWidth = 14 * (1 - k);
      ctx.strokeStyle = C.orange;
      ctx.stroke();
    }
    // Check badge in the top-left corner (clear of the illustration).
    const r = 27 * easeOutBack(q / 0.45, 2.2);
    if (r > 0.5) {
      const bx = x + 36;
      const by = y + 36;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, TAU);
      ctx.fillStyle = C.orange;
      ctx.fill();
      ctx.lineWidth = 5 * (r / 27);
      ctx.strokeStyle = C.off;
      ctx.stroke();
      const k = r / 27;
      ctx.beginPath();
      ctx.moveTo(bx - 11 * k, by + 1 * k);
      ctx.lineTo(bx - 3 * k, by + 9 * k);
      ctx.lineTo(bx + 12 * k, by - 8 * k);
      ctx.lineWidth = 6.5 * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = C.off;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Footer ────────────────────────────────────────────────────────────────

function drawFooter(ctx: CanvasRenderingContext2D, st: CaptchaState) {
  const sepY = P.gy + P.grid + P.pad;
  ctx.fillStyle = C.offShade;
  ctx.fillRect(P.gx, sepY - 1.5, P.grid, 3);
  const cy = sepY + P.footH / 2;
  ctx.strokeStyle = C.blueMuted;
  ctx.fillStyle = C.blueMuted;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // refresh
  const rx = P.gx + 44;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(rx, cy, 21, -0.9, TAU - 1.9);
  ctx.stroke();
  const ax = rx + 21 * Math.cos(-0.9);
  const ay = cy + 21 * Math.sin(-0.9);
  ctx.beginPath();
  ctx.moveTo(ax + 3, ay - 14);
  ctx.lineTo(ax + 6, ay + 4);
  ctx.lineTo(ax - 12, ay + 3);
  ctx.closePath();
  ctx.fill();
  // info
  const ix = P.gx + 118;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ix, cy, 22, 0, TAU);
  ctx.stroke();
  ctx.fillRect(ix - 3.5, cy - 4, 7, 16);
  ctx.beginPath();
  ctx.arc(ix, cy - 11, 4.2, 0, TAU);
  ctx.fill();
  // VERIFY: pressed once every tile is selected; turns orange (done).
  const v = st.verify;
  const bw = 240;
  const bh = 86;
  const bx = P.x + P.w - P.pad - bw;
  const sc = 1 - 0.08 * Math.sin(Math.PI * clamp01(v));
  ctx.save();
  ctx.translate(bx + bw / 2, cy);
  ctx.scale(sc, sc);
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
  ctx.fillStyle = v >= 0.5 ? C.orange : C.blue;
  ctx.fill();
  ctx.fillStyle = C.off;
  ctx.font = `800 38px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '3px';
  ctx.fillText('VERIFY', 1.5, 2);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.restore();
}

// ── Assembly and break-up ────────────────────────────────────────────────

/** Panel + its pieces; `t` drives the break-up once the burst front arrives. */
export function drawPanel(ctx: CanvasRenderingContext2D, p: CaptchaParams, st: CaptchaState, t: number) {
  if (st.panelAlpha <= 0) return;
  const pcx = P.x + P.w / 2;
  const pcy = P.y + P.h / 2;
  ctx.save();
  ctx.globalAlpha = st.panelAlpha;
  // Entrance: rise + scale about the panel centre.
  ctx.translate(pcx, pcy + st.panelY);
  ctx.scale(st.panelScale, st.panelScale);
  ctx.translate(-pcx, -pcy);

  const poses = PIECES.map((pc, i) => piecePose(p, pc, i, t));
  // Hard drop shadows first (deep blue, offset straight down), then the pieces.
  for (const pass of ['shadow', 'face'] as const) {
    PIECES.forEach((pc, i) => {
      const pose = poses[i];
      ctx.save();
      if (pass === 'shadow') ctx.translate(0, 18);
      const mx = (pc.x0 + pc.x1) / 2;
      const my = (pc.y0 + pc.y1) / 2;
      ctx.translate(mx + pose.dx, my + pose.dy);
      ctx.rotate(pose.rot);
      ctx.scale(pose.scale, pose.scale);
      ctx.translate(-mx, -my);
      // Pieces overlap by a hair at rest so the assembled card has no seams.
      const o = pose.free ? 0 : 0.75;
      roundRect(ctx, pc.x0 - o, pc.y0 - o, pc.x1 - pc.x0 + 2 * o, pc.y1 - pc.y0 + 2 * o, pc.radii);
      ctx.fillStyle = pass === 'shadow' ? C.blueDeep : C.off;
      ctx.fill();
      if (pass === 'face') {
        if (pose.free) {
          ctx.save();
          roundRect(ctx, pc.x0, pc.y0, pc.x1 - pc.x0, pc.y1 - pc.y0, pc.radii);
          ctx.clip();
          pc.content(ctx, st);
          ctx.restore();
          roundRect(ctx, pc.x0, pc.y0, pc.x1 - pc.x0, pc.y1 - pc.y0, pc.radii);
          ctx.lineWidth = 4;
          ctx.strokeStyle = C.offShade;
          ctx.stroke();
        } else pc.content(ctx, st);
      }
      ctx.restore();
    });
  }
  ctx.restore();
}

function piecePose(p: CaptchaParams, pc: Piece, i: number, t: number) {
  const mx = (pc.x0 + pc.x1) / 2;
  const my = (pc.y0 + pc.y1) / 2;
  const dxC = mx - 540;
  const dyC = my - p.burstY;
  const dist = Math.hypot(dxC, dyC);
  const b = t - p.burstAt - frontHitAge(dist);
  if (t < p.burstAt || b <= 0) return { dx: 0, dy: 0, rot: 0, scale: 1, free: false };
  const ux = dist > 1 ? dxC / dist : 0;
  const uy = dist > 1 ? dyC / dist : -1;
  const v0 = 1500 * (1 - dist / 1500) + 500 * rnd(p.seed, 30, i);
  const k = 2.1;
  const f = (1 - Math.exp(-k * b)) / k;
  const spin = (rnd(p.seed, 31, i) < 0.5 ? -1 : 1) * (0.7 + 1.3 * rnd(p.seed, 32, i));
  return {
    dx: ux * v0 * f,
    dy: uy * v0 * f + 650 * b * b,
    rot: spin * (1 - Math.exp(-2.2 * b)),
    scale: 1 + 0.45 * (1 - Math.exp(-3 * b)),
    free: true,
  };
}
