#!/usr/bin/env node
/**
 * Motion verification for build phase 2. Requires the dev/preview server.
 *
 *   node scripts/verify-motion.mjs [--url http://localhost:5173] [--out captures/phase2]
 *
 * 1. Curve analysis (pure track): angle/velocity continuity at every segment
 *    junction, classification of every zero-velocity moment (reversal vs.
 *    unintended stop), wipe monotonicity and sector reveal order.
 * 2. Frame-accurate seeking: frames are rendered in sequential and shuffled
 *    order and the canvas pixels are hashed. Every hash must match.
 * 3. Real-time playback at 1×: per-rAF samples of the playhead and state are
 *    checked against the pure curve, and frame-to-frame jumps are measured.
 *    A CDP screencast of the same run is saved as JPEG frames + timing JSON.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://localhost:5173';
const outDir = args.out ?? 'captures/phase2';
const W = 960, H = 540;

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--disable-background-timer-throttling'] });
    } catch { /* next */ }
  }
  throw new Error('No Edge or Chrome installation found.');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${url}/?debug=0`);
await page.waitForFunction((w) => window.__pieFirework && document.querySelector('canvas')?.width === w, W);
await page.evaluate(() => window.__pieFirework.pause());

// ── 1. Curve analysis ──────────────────────────────────────────────────────
const curve = await page.evaluate(() => {
  const e = window.__pieFirework;
  const { motion, duration, schedule } = e.getSnapshot();
  const span = (id) => schedule.find((s) => s.id === id);
  const revealStart = span('reveal').start;
  const knots = motion.knots();

  // Junction continuity (one-sided limits).
  const eps = 1e-7;
  const junctions = knots.slice(1, -1).map((t, i) => {
    const a = motion.sample(t - eps), b = motion.sample(t + eps);
    return {
      t: +t.toFixed(4),
      between: `${motion.segments[i].label} → ${motion.segments[i + 1].label}`,
      angleJumpDeg: Math.abs(b.angle - a.angle),
      velocityJumpDegPerSec: Math.abs(b.velocity - a.velocity),
      velocityDegPerSec: +a.velocity.toFixed(2),
    };
  });

  // Zero-velocity moments after the wipe begins: reversal or stop?
  const dt = 1e-4, still = 2; // deg/s threshold for "standing still"
  const zeros = [];
  let prev = motion.sample(revealStart + dt);
  let inStill = null;
  for (let t = revealStart + 2 * dt; t <= duration; t += dt) {
    const cur = motion.sample(t);
    if (Math.abs(cur.velocity) < still && !inStill) inStill = { start: t, signBefore: Math.sign(prev.velocity) };
    if (Math.abs(cur.velocity) >= still && inStill) {
      const signAfter = Math.sign(cur.velocity);
      zeros.push({
        t: +((inStill.start + t) / 2).toFixed(3),
        dwellMs: +((t - inStill.start) * 1000).toFixed(1),
        kind: signAfter !== inStill.signBefore ? 'reversal' : 'STOP (no reversal)',
        angle: +cur.angle.toFixed(2),
      });
      inStill = null;
    }
    prev = cur;
  }

  // Wipe monotonic + sector order.
  let monotonic = true, last = -1;
  const sectorStarts = [0, 112, 133.9, 201.3, 270];
  const firstVisible = sectorStarts.map(() => null);
  for (let t = 0; t <= span('reveal').end; t += dt) {
    e.seek(t);
    const r = e.state.reveal;
    if (r < last - 1e-12) monotonic = false;
    last = r;
    sectorStarts.forEach((deg, i) => {
      if (firstVisible[i] === null && r * 360 > deg + 0.5) firstVisible[i] = +t.toFixed(4);
    });
  }

  const at = (t) => { const s = motion.sample(t); return { t: +t.toFixed(4), angle: +s.angle.toFixed(3), velRevPerSec: +(s.velocity / 360).toFixed(3) }; };
  const extremes = motion.segments.map((s) => ({ segment: s.label, endsAt: at(s.t1) }));
  return {
    duration, schedule, junctions, zeros, wipeMonotonic: monotonic,
    sectorFirstVisible: firstVisible, extremes, warnings: motion.warnings,
    maxAngleJump: Math.max(...junctions.map((j) => j.angleJumpDeg)),
    maxVelocityJump: Math.max(...junctions.map((j) => j.velocityJumpDegPerSec)),
  };
});

// ── 2. Frame-accurate, order-independent rendering ─────────────────────────
const fps = 30;
const frames = Array.from({ length: Math.round(4.6 * fps) }, (_, i) => i).filter((f) => f % 3 === 0 || (f >= 45 && f <= 72));
const renderHashes = async (order) => page.evaluate(async ({ order, fps }) => {
  const e = window.__pieFirework;
  const gl = document.querySelector('canvas');
  const ctx = new OffscreenCanvas(gl.width, gl.height).getContext('2d', { willReadFrequently: true });
  const out = {};
  for (const f of order) {
    e.seek(f / fps);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.drawImage(gl, 0, 0);
    const buf = ctx.getImageData(0, 0, gl.width, gl.height).data.buffer;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)).slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
    out[f] = { hash, rot: e.state.rotationDeg, reveal: e.state.reveal };
  }
  return out;
}, { order, fps });
const seq = await renderHashes(frames);
const shuffled = [...frames].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
const shuf = await renderHashes(shuffled);
const mismatched = frames.filter((f) => seq[f].hash !== shuf[f].hash || seq[f].rot !== shuf[f].rot);
const stepCheck = await page.evaluate((fps) => {
  const e = window.__pieFirework; e.seek(1.234); e.stepFrames(1);
  const t = e.getSnapshot().time; // GSAP stores time at 1e-7 s precision; seek(frame / fps) rounds identically.
  return { landed: t, expected: 38 / fps, onGrid: Math.abs(t - 38 / fps) < 1e-6 };
}, fps);

// ── 3. Real-time playback at 1× with screencast ────────────────────────────
rmSync(join(outDir, 'playback'), { recursive: true, force: true });
mkdirSync(join(outDir, 'playback'), { recursive: true });
const cdp = await page.context().newCDPSession(page);
const shots = [];
cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
  shots.push({ data, ts: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await page.evaluate(() => { const e = window.__pieFirework; e.setSpeed(1); e.seek(0); });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const playback = await page.evaluate(async () => {
  const e = window.__pieFirework;
  const { motion } = e.getSnapshot();
  const samples = [];
  e.play();
  await new Promise((resolve) => {
    const tick = (now) => {
      const s = e.state;
      samples.push({ now, t: e.getSnapshot().time, sweep: s.sweepDeg, v: s.sweepVelocity, rot: s.rotationDeg, reveal: s.reveal });
      if (e.getSnapshot().time < 4.6) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  e.pause();
  // Analysis
  const gaps = samples.slice(1).map((s, i) => s.now - samples[i].now);
  const wall = samples.at(-1).now - samples[0].now;
  const tl = samples.at(-1).t - samples[0].t;
  let maxCurveError = 0, maxJumpExcess = 0, worst = null, backwardsDuringSpin = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    maxCurveError = Math.max(maxCurveError, Math.abs(motion.sample(b.t).angle - b.sweep));
    // Displacement vs. what the curve predicts over the same interval (trapezoid):
    const predicted = ((a.v + b.v) / 2) * (b.t - a.t);
    const excess = Math.abs(b.sweep - a.sweep - predicted);
    if (excess > maxJumpExcess) { maxJumpExcess = excess; worst = { t: b.t, dSweep: b.sweep - a.sweep, predicted }; }
    if (b.t > 3.2 && b.sweep < a.sweep) backwardsDuringSpin++;
  }
  return {
    frames: samples.length, avgFps: +(1000 * (samples.length - 1) / wall).toFixed(1),
    maxFrameGapMs: +Math.max(...gaps).toFixed(1), framesOver25ms: gaps.filter((g) => g > 25).length,
    timelineSpeed: +(tl / (wall / 1000)).toFixed(4),
    maxCurveErrorDeg: maxCurveError, maxJumpExcessDeg: +maxJumpExcess.toFixed(4), worstJump: worst,
    backwardsStepsDuringSpin: backwardsDuringSpin,
    perFrameDegAtEnd: +(samples.at(-1).sweep - samples.at(-2).sweep).toFixed(1),
  };
});
await cdp.send('Page.stopScreencast');
shots.forEach((s, i) => writeFileSync(join(outDir, 'playback', `frame_${String(i).padStart(4, '0')}.jpg`), Buffer.from(s.data, 'base64')));
writeFileSync(join(outDir, 'playback', 'timing.json'), JSON.stringify(shots.map((s) => s.ts)));

const report = {
  curve,
  seeking: { framesChecked: frames.length, mismatched, stepFramesLandsOnGrid: stepCheck },
  playback: { ...playback, screencastFrames: shots.length },
  consoleErrors: errors,
};
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
