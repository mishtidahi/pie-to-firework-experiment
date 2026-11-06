import type { CaptchaParams } from '../config';
import { C, TAU, clamp01, lerp, noise1, poly, rnd, sparkStroke } from './style';

/**
 * The rocket firecracker: a cel-shaded body (shared with the tile icon), its
 * flight path, the stylised exhaust ribbon and the trail sparks. Everything is
 * a pure function of time (closed-form flight and particle motion), so any
 * frame renders identically whether played or seeked.
 */

interface BodyOpts {
  /** Exhaust flame length (local units; 0 = unlit). */
  flame: number;
  /** Flame width multiplier (flicker). */
  flicker: number;
  /** Stick length below the nozzle. */
  stick: number;
}

const OUT = 5;
const SHADE = 'rgba(26, 0, 217, 0.17)';

function stroke(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = OUT;
  ctx.strokeStyle = C.blue;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Stick tied alongside the body (as on a real Diwali rocket), behind everything, so the flame stays clear. */
function drawStick(ctx: CanvasRenderingContext2D, len: number) {
  ctx.beginPath();
  ctx.roundRect(26, -18, 10, 92 + len, 4);
  ctx.fillStyle = C.offShade;
  ctx.fill();
  stroke(ctx);
}

/** Rocket in local units, nose up: body centre (0, 0), nose tip y = −118, nozzle y = 74. */
export function drawRocketBody(ctx: CanvasRenderingContext2D, o: BodyOpts) {
  drawStick(ctx, o.stick);
  if (o.flame > 0) {
    const L = o.flame;
    const w = 26 * o.flicker;
    const drop = (s: number) => {
      ctx.beginPath();
      ctx.moveTo(-w * s, 70);
      ctx.bezierCurveTo(-w * s * 1.1, 70 + L * s * 0.45, -w * s * 0.25, 70 + L * s * 0.8, 0, 70 + L * s);
      ctx.bezierCurveTo(w * s * 0.25, 70 + L * s * 0.8, w * s * 1.1, 70 + L * s * 0.45, w * s, 70);
      ctx.closePath();
    };
    drop(1);
    ctx.fillStyle = C.orange;
    ctx.fill();
    drop(0.7);
    ctx.fillStyle = C.yellow;
    ctx.fill();
    drop(0.4);
    ctx.fillStyle = C.hot;
    ctx.fill();
  }
  // fins
  for (const s of [-1, 1]) {
    poly(ctx, [[22 * s, 16], [48 * s, 58], [48 * s, 80], [22 * s, 62]]);
    ctx.fillStyle = s < 0 ? C.orangeShade : C.orangeDeep;
    ctx.fill();
    stroke(ctx);
  }
  // nozzle
  poly(ctx, [[-17, 60], [17, 60], [13, 76], [-13, 76]]);
  ctx.fillStyle = C.offShade;
  ctx.fill();
  stroke(ctx);
  // body
  const body = () => {
    ctx.beginPath();
    ctx.roundRect(-25, -64, 50, 128, 6);
  };
  body();
  ctx.fillStyle = C.orange;
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = C.yellow;
  ctx.fillRect(-30, -34, 60, 14);
  ctx.fillRect(-30, 18, 60, 14);
  ctx.fillStyle = C.saffron;
  ctx.fillRect(-17, -64, 7, 128);
  ctx.fillStyle = SHADE;
  ctx.fillRect(9, -70, 20, 140);
  ctx.restore();
  body();
  stroke(ctx);
  // nose cone
  const nose = () => {
    ctx.beginPath();
    ctx.moveTo(-25, -62);
    ctx.quadraticCurveTo(-23, -98, 0, -118);
    ctx.quadraticCurveTo(23, -98, 25, -62);
    ctx.closePath();
  };
  nose();
  ctx.fillStyle = C.off;
  ctx.fill();
  ctx.save();
  nose();
  ctx.clip();
  ctx.fillStyle = SHADE;
  ctx.fillRect(6, -130, 30, 80);
  ctx.restore();
  nose();
  stroke(ctx);
}

// ── Flight ────────────────────────────────────────────────────────────────

/** Body centre starts here: nose (y − 118·scale) is below the 1920 frame bottom. */
const START_Y = 2095;
const START_X = 650;
const SCALE0 = 1.45;
const SCALE1 = 1.72;

/**
 * Flight progress: a hard power-curve acceleration for 80 % of the flight,
 * then a short, velocity-matched slow-down into the burst point (the rocket
 * "tops out" before it bursts). C¹-continuous.
 */
export function flightEase(u: number): number {
  const x = clamp01(u);
  const k = 0.8;
  const n = 1.9;
  const d = 1 - k;
  const A = 1 / (Math.pow(k, n) + 0.65 * n * Math.pow(k, n - 1) * d);
  if (x <= k) return A * Math.pow(x, n);
  const vk = A * n * Math.pow(k, n - 1);
  const s = x - k;
  return A * Math.pow(k, n) + vk * s - 0.5 * ((0.7 * vk) / d) * s * s;
}

export interface RocketPose {
  x: number;
  y: number;
  angle: number;
  scale: number;
}

export function rocketPose(p: CaptchaParams, t: number): RocketPose {
  const u = clamp01((t - p.launchAt) / (p.burstAt - p.launchAt));
  const tau = flightEase(u);
  const x = 540 + (START_X - 540) * (1 - tau) * (1 - tau);
  const y = lerp(START_Y, p.burstY, tau);
  // Heading follows the curved path (a directional correction), plus a fading wobble.
  const dx = -2 * (START_X - 540) * (1 - tau);
  const dy = p.burstY - START_Y;
  const angle = Math.atan2(dx, -dy) + 0.045 * Math.sin(TAU * 4.5 * t) * (1 - tau);
  return { x, y, angle, scale: lerp(SCALE0, SCALE1, tau) };
}

/** World position of the nozzle (local (0, 74)). */
function nozzle(pose: RocketPose): [number, number] {
  const d = 74 * pose.scale;
  return [pose.x - Math.sin(pose.angle) * d, pose.y + Math.cos(pose.angle) * d];
}

const TRAIL_S = 0.24;

/** Exhaust ribbon: the nozzle's recent path, a tapered three-band cel stroke. It retracts into the burst. */
function drawRibbon(ctx: CanvasRenderingContext2D, p: CaptchaParams, t: number) {
  const head = Math.min(t, p.burstAt);
  const tail = Math.max(p.launchAt, t - TRAIL_S);
  if (head <= tail) return;
  const N = 28;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const ts = head - ((head - tail) * i) / N;
    const [x, y] = nozzle(rocketPose(p, ts));
    const age = (t - ts) / TRAIL_S;
    pts.push([x, y, Math.pow(clamp01(1 - age), 0.75)]);
  }
  const band = (wMax: number, fill: string, upto = 1) => {
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    const last = Math.max(1, Math.round(N * upto));
    for (let i = 0; i <= last; i++) {
      const [x, y, w] = pts[i];
      const [ax, ay] = pts[Math.max(0, i - 1)];
      const [bx, by] = pts[Math.min(N, i + 1)];
      let nx = -(by - ay);
      let ny = bx - ax;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const hw = (wMax * w) / 2;
      left.push([x + nx * hw, y + ny * hw]);
      right.push([x - nx * hw, y - ny * hw]);
    }
    poly(ctx, [...left, ...right.reverse()]);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  band(86, C.orange);
  band(54, C.yellow);
  band(24, C.hot, 0.45);
}

const TRAIL_SPARKS = 150;

/** Trail sparks: jetted backwards from the nozzle, closed-form drag + gravity. */
function drawTrailSparks(ctx: CanvasRenderingContext2D, p: CaptchaParams, t: number) {
  const flight = p.burstAt - p.launchAt;
  const k = 2.4;
  const g = 1500;
  for (let i = 0; i < TRAIL_SPARKS; i++) {
    const tb = p.launchAt + ((i + rnd(p.seed, 1, i)) / TRAIL_SPARKS) * flight;
    const a = t - tb;
    const life = 0.22 + 0.28 * rnd(p.seed, 2, i);
    if (a < 0 || a > life) continue;
    const pose = rocketPose(p, tb);
    const after = rocketPose(p, tb + 0.005);
    const [x0, y0] = nozzle(pose);
    const [x1, y1] = nozzle(after);
    const rvx = (x1 - x0) / 0.005;
    const rvy = (y1 - y0) / 0.005;
    const dir = pose.angle + Math.PI + (rnd(p.seed, 3, i) - 0.5) * 1.1;
    const jet = 380 + 420 * rnd(p.seed, 4, i);
    const vx0 = 0.2 * rvx - Math.sin(dir) * jet;
    const vy0 = 0.2 * rvy + Math.cos(dir) * jet;
    const e = Math.exp(-k * a);
    const f = (1 - e) / k;
    const x = x0 + vx0 * f;
    const y = y0 + vy0 * f + g * (a / k - f / k);
    const vx = vx0 * e;
    const vy = vy0 * e + (g * (1 - e)) / k;
    const L = 0.035;
    const w = (11 + 6 * rnd(p.seed, 5, i)) * Math.pow(1 - a / life, 0.6);
    sparkStroke(ctx, x, y, x - vx * L, y - vy * L, w);
  }
}

/** Ribbon, trail sparks and (until the burst) the rocket itself. */
export function drawRocketFlight(ctx: CanvasRenderingContext2D, p: CaptchaParams, t: number) {
  if (t < p.launchAt) return;
  drawRibbon(ctx, p, t);
  drawTrailSparks(ctx, p, t);
  if (t >= p.burstAt) return;
  const pose = rocketPose(p, t);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  ctx.scale(pose.scale, pose.scale);
  const flicker = 0.85 + 0.25 * noise1(p.seed + 7, t * 28);
  drawRocketBody(ctx, { flame: 120 * (0.9 + 0.25 * noise1(p.seed + 3, t * 22)), flicker, stick: 150 });
  ctx.restore();
}
