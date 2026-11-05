#!/usr/bin/env node
/**
 * Phase 3 verification and review captures. Requires the dev/preview server.
 *
 *   node scripts/verify-phase3.mjs [--url http://localhost:5173] [--out captures/phase3] [--skip-recordings]
 *
 * A. State continuity across the whole timeline and at every phase boundary.
 * B. Seeking determinism: canvas hashes for sequential vs shuffled seeks, and a
 *    frame reached by real playback vs the same timestamp reached by seeking.
 * C. Final colour: exact #ffde59 on every pixel of 1920×1080 frames in the
 *    hold phase; first fully-yellow frame; residual blue during the engulf.
 * D. Performance: real-time 1× playback frame pacing per phase at 1080p/720p.
 * E. Temporal aliasing at 30 and 60 fps for every rotating/moving element.
 * F. Captures: real-time full-res recording (0–8 s), real-time firework +
 *    expansion recording (4–8 s), deterministic contact sheet, frame strips.
 *    Frames and timing are written to disk; scripts/assemble-captures.py builds
 *    the animated WebP/GIF files and contact sheets (needs Python + Pillow).
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const url = args.url ?? 'http://localhost:5173';
const out = args.out ?? 'captures/phase3';
mkdirSync(out, { recursive: true });

async function launch(gpuArgs) {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: [...gpuArgs, '--disable-background-timer-throttling'] });
    } catch { /* next */ }
  }
  throw new Error('No Edge or Chrome installation found.');
}
// Hardware GPU (what viewers get) and SwiftShader (software, bit-exact: the export path).
const browser = await launch(['--use-angle=d3d11', '--enable-gpu']);
const swBrowser = await launch(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);

async function openStage(w, h, b = browser) {
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}/?debug=0`);
  await page.waitForFunction((w) => window.__pieFirework && window.__pieFireworkGL && document.querySelector('canvas')?.width === w, w);
  await page.evaluate(() => {
    window.__pieFirework.pause();
    window.__frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__pixels = () => {
      const gl = document.querySelector('canvas');
      const ctx = (window.__ctx ??= new OffscreenCanvas(gl.width, gl.height).getContext('2d', { willReadFrequently: true }));
      ctx.drawImage(gl, 0, 0);
      return ctx.getImageData(0, 0, gl.width, gl.height).data;
    };
    window.__hash = async () => {
      const d = await crypto.subtle.digest('SHA-256', window.__pixels().buffer);
      return Array.from(new Uint8Array(d).slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
  });
  return { page, errors };
}

const report = {};
const { page, errors } = await openStage(1920, 1080);

// ── A. State continuity ───────────────────────────────────────────────────
report.continuity = await page.evaluate(() => {
  const e = window.__pieFirework;
  const { schedule, duration } = e.getSnapshot();
  const skip = new Set(['phase', '_gsap', 'time']);
  const read = () => Object.fromEntries(Object.entries(e.state).filter(([k, v]) => !skip.has(k) && typeof v === 'number'));
  // Designed, invisible discontinuities (documented in the phase modules).
  const designed = {
    sweepVelocity: 'the wipe edge starts at "start speed" × average (Phase 2 parameter; set it to 0 for a start from rest)',
    angularVelocity: 'body velocity starts at the wipe hand-off; sweepVelocity (the visible edge/body speed) is continuous',
    finalFill: 'switches on at the hold phase, when the disc already covers the frame in flat yellow (pixel-verified)',
    bgMix: 'set to 1 at the hold phase; already ≈1 and hidden behind the disc',
  };
  const boundaries = schedule.slice(1).map((s) => s.start);
  const eps = 1e-4;
  const atBoundaries = boundaries.map((b) => {
    e.seek(b - eps); const a = read(); e.seek(b + eps); const c = read();
    const jumps = Object.keys(a).map((k) => [k, Math.abs(c[k] - a[k])]).filter(([k, d]) => d > (k === 'sweepDeg' || k === 'rotationDeg' ? 5 : k === 'sweepVelocity' ? 50 : 0.01));
    return { t: +b.toFixed(3), jumps: jumps.map(([k, d]) => ({ field: k, jump: +d.toFixed(4), designed: designed[k] ?? null })) };
  });
  // Whole-timeline scan: biggest per-step change of each 0..1 driver at 1200 Hz.
  const dt = 1 / 1200; let prev = null; const maxStep = {};
  for (let t = 0; t <= duration; t += dt) {
    e.seek(t); const cur = read();
    if (prev) for (const k of Object.keys(cur)) {
      if (['sweepDeg', 'rotationDeg', 'sweepVelocity', 'angularVelocity', 'expandLog'].includes(k)) continue;
      const d = Math.abs(cur[k] - prev[k]);
      if (!maxStep[k] || d > maxStep[k].d) maxStep[k] = { d, t };
    }
    prev = cur;
  }
  const steps = Object.fromEntries(Object.entries(maxStep).map(([k, v]) => [k, { maxStepPer1200Hz: +v.d.toFixed(5), at: +v.t.toFixed(3), designed: designed[k] ?? null }]));
  return { boundaries: atBoundaries, maxSteps: steps };
});

// ── B. Seeking determinism ────────────────────────────────────────────────
// The renderer state is a pure function of time; we prove it on SwiftShader
// (bit-exact) and report the residual hardware-GPU rasterisation noise.
async function seekingTest(pg, times) {
  return pg.evaluate(async (times) => {
    const e = window.__pieFirework;
    const render = async (order) => {
      const out = {};
      for (const t of order) { e.seek(t); await window.__frame(); out[t] = { hash: await window.__hash(), px: window.__pixels().slice() }; }
      return out;
    };
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
    const seq = await render(times);
    const shuffled = [...times].sort((a, b) => Math.sin(a * 12.9898) - Math.sin(b * 12.9898));
    const shuf = await render(shuffled);
    const mism = times.filter((t) => seq[t].hash !== shuf[t].hash).map((t) => ({ t: +t.toFixed(4), pixels: diff(seq[t].px, shuf[t].px) }));
    e.seek(5.1); e.play(); await new Promise((r) => setTimeout(r, 450)); e.pause();
    const tPlay = e.getSnapshot().time; await window.__frame();
    const pPlay = window.__pixels().slice();
    e.seek(1.0); await window.__frame(); e.seek(tPlay); await window.__frame();
    const pSeek = window.__pixels();
    return {
      framesChecked: times.length,
      framesWithDifferences: mism.length,
      worstDifferingPixels: Math.max(0, ...mism.map((m) => m.pixels)),
      playbackVsSeek: { t: +tPlay.toFixed(4), differingPixels: diff(pPlay, pSeek) },
    };
  }, times);
}
{
  const frames30 = Array.from({ length: 241 }, (_, i) => i).filter((f) => f >= 110 || f % 10 === 0).map((f) => f / 30);
  const frames60 = [301, 333, 347, 361, 389, 421, 437, 443, 449, 455].map((f) => f / 60);
  const gpu = await seekingTest(page, [...frames30, ...frames60]);
  const { page: swPage } = await openStage(960, 540, swBrowser);
  const sw = await seekingTest(swPage, [...frames30.filter((_, i) => i % 3 === 0), ...frames60]);
  await swPage.close();
  report.seeking = {
    swiftShader_bitExact: { ...sw, verdict: sw.framesWithDifferences === 0 && sw.playbackVsSeek.differingPixels === 0 ? 'PASS: bit-identical regardless of seek order or playback' : 'FAIL' },
    hardwareGpu_1080p: { ...gpu, note: 'state and uniforms are identical; residual differences are a handful of rim pixels from GPU rasterisation/MSAA (absent on SwiftShader)' },
  };
}

// ── C. Final colour accuracy (exact pixels at 1920×1080) ────────────────────
report.finalColour = await page.evaluate(async () => {
  const e = window.__pieFirework;
  const Y = [255, 222, 89];
  const nonYellow = () => { const d = window.__pixels(); let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== Y[0] || d[i + 1] !== Y[1] || d[i + 2] !== Y[2]) n++; return n; };
  const holdStart = e.getSnapshot().schedule.find((s) => s.id === 'hold').start;
  const check = [holdStart - 1 / 60, holdStart, holdStart + 0.1, holdStart + 0.2, holdStart + 0.3, e.getSnapshot().duration];
  const exact = [];
  for (const t of check) { e.seek(t); await window.__frame(); exact.push({ t: +t.toFixed(4), nonYellowPixels: nonYellow(), rigVisible: (() => { let v = null; window.__pieFireworkScene.traverse((o) => { if (o.isGroup && o.children.some((c) => c.isMesh)) v = o.visible; }); return v; })() }); }
  // Engulf: residual non-yellow pixels per 60 fps frame, and first fully-yellow frame.
  const engulf = []; let firstFull = null;
  for (let f = Math.round(7.2 * 60); f <= Math.round(holdStart * 60); f++) {
    e.seek(f / 60); await window.__frame();
    const n = nonYellow(); engulf.push({ t: +(f / 60).toFixed(3), nonYellowPixels: n });
    if (n === 0 && firstFull === null) firstFull = +(f / 60).toFixed(3);
  }
  return { holdStart, exactFrames: exact, firstFullyYellowFrame60fps: firstFull, engulf };
});

// ── E. Temporal aliasing analysis at 30 and 60 fps ─────────────────────────
report.aliasing = await page.evaluate(() => {
  const e = window.__pieFirework;
  const p = e.getParams();
  let sparkTrail = null, streakTrails = [];
  window.__pieFireworkScene.traverse((o) => {
    if (o.isMesh && o.geometry.attributes.aSpark0) sparkTrail = Number(/max\(age - ([0-9.]+)/.exec(o.material.vertexShader)[1]);
    if (o.isMesh && o.geometry.attributes.aS1) { const a = o.geometry.attributes.aS1.array; for (let i = 1; i < a.length; i += 4) streakTrails.push(a[i]); }
  });
  // Energy/swirl arms in the disc shader: [arms, apparent rev/s] (pieShader.ts).
  const arms = [[3, 1.45], [4, 1.9 + (0.5 * 3.1) / (2 * Math.PI)], [2, 1.15], [4, 1.3], [3, 1.05]];
  const res = {};
  for (const fps of [30, 60]) {
    // Pie rotation vs blur window, while the segmented pie is still visible.
    let worstGap = 0, worstAt = null, maxStepDeg = 0;
    for (let f = Math.round(2.9 * fps); f <= Math.round(4.8 * fps); f++) {
      const t = f / fps;
      e.seek(t - 1 / fps); const a = e.state.rotationDeg; e.seek(t); const b = e.state.rotationDeg;
      const step = Math.abs(b - a);
      const speed = Math.abs(e.state.angularVelocity);
      const onset = p.blurStartSpeed;
      const sm = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
      const gate = e.state.phase.spinUp > 0 ? 1 : 0;
      const onsetW = gate * (onset > 0 ? sm((speed - 0.5 * onset) / (0.5 * onset)) : 1);
      const phys = speed * (1 / 30) * p.blurStrength * onsetW;
      const windowDeg = Math.min(1, phys + (1 - phys) * e.state.blurMix) * 360;
      const gap = Math.max(0, step - windowDeg);
      maxStepDeg = Math.max(maxStepDeg, step);
      if (gap > worstGap) { worstGap = gap; worstAt = { t: +t.toFixed(3), stepDeg: +step.toFixed(1), blurWindowDeg: +windowDeg.toFixed(1) }; }
    }
    res[`${fps}fps`] = {
      pieMaxStepDeg: +maxStepDeg.toFixed(1),
      pieUnblurredStepDeg: { worst: +worstGap.toFixed(1), at: worstAt, note: 'part of a frame-to-frame rotation step not covered by the blur window; the smallest sector is 21.9°, so steps well below that cannot strobe' },
      energyArmsWorstStepOfSpacing: +Math.max(...arms.map(([n, s]) => (n * s) / fps)).toFixed(3),
      streaksWorstStepOfTrail: +(1 / (fps * Math.min(...streakTrails))).toFixed(3),
      sparksStepOfTrail: +(1 / (fps * sparkTrail)).toFixed(3),
    };
  }
  res.criteria = 'energy arms < 0.5 of spacing (direction cannot alias); streak/spark ratio ≤ 1 (trails overlap frame to frame)';
  return res;
});

// ── D. Performance: real-time playback frame pacing ────────────────────────
async function measurePlayback(pg) {
  return pg.evaluate(async () => {
    const e = window.__pieFirework;
    const gl = window.__pieFireworkGL.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const { schedule } = e.getSnapshot();
    e.setSpeed(1); e.seek(0); await window.__frame();
    const samples = [];
    e.play();
    await new Promise((resolve) => {
      const tick = (now) => {
        samples.push({ now, t: e.getSnapshot().time, calls: window.__pieFireworkGL.info.render.calls });
        if (e.getSnapshot().playing) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    const perPhase = schedule.map((s) => {
      const gaps = [];
      for (let i = 1; i < samples.length; i++) if (samples[i].t > s.start && samples[i].t <= s.end) gaps.push(samples[i].now - samples[i - 1].now);
      gaps.sort((a, b) => a - b);
      const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(gaps.length, 1);
      return { phase: s.id, fps: +(1000 / mean).toFixed(1), p95ms: +(gaps[Math.floor(gaps.length * 0.95)] ?? 0).toFixed(1), worstMs: +(gaps.at(-1) ?? 0).toFixed(1) };
    });
    const wall = samples.at(-1).now - samples[0].now;
    return { renderer, wallSeconds: +(wall / 1000).toFixed(3), timelineSpeed: +((samples.at(-1).t - samples[0].t) / (wall / 1000)).toFixed(4), framesOver33ms: samples.slice(1).filter((s, i) => s.now - samples[i].now > 33.4).length, maxDrawCalls: Math.max(...samples.map((s) => s.calls)), perPhase };
  });
}
report.performance = { '1920x1080': await measurePlayback(page) };
{
  const { page: p720 } = await openStage(1280, 720);
  report.performance['1280x720'] = await measurePlayback(p720);
  await p720.close();
}

// ── F. Captures ──────────────────────────────────────────────────────────────
// Deterministic contact sheet frames.
const sheetTimes = [0.3, 1.0, 1.6, 1.7, 2.05, 2.93, 3.5, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0, 5.3, 5.8, 6.2, 6.6, 6.9, 7.1, 7.25, 7.35, 7.45, 7.6, 8.0];
rmSync(join(out, 'contact'), { recursive: true, force: true });
mkdirSync(join(out, 'contact'), { recursive: true });
const sheetMeta = [];
for (const [i, t] of sheetTimes.entries()) {
  const info = await page.evaluate(async (t) => {
    const e = window.__pieFirework; e.seek(t); await window.__frame();
    const s = e.state; const seg = e.getSnapshot().schedule[e.getSnapshot().phaseIndex];
    return { t, phase: seg.label, url: document.querySelector('canvas').toDataURL('image/png') };
  }, t);
  writeFileSync(join(out, 'contact', `k${String(i).padStart(2, '0')}.png`), Buffer.from(info.url.split(',')[1], 'base64'));
  sheetMeta.push({ t: info.t, phase: info.phase });
}
writeFileSync(join(out, 'contact', 'meta.json'), JSON.stringify(sheetMeta));

// Consecutive-frame strips at 30 and 60 fps (temporal aliasing review).
for (const fps of [30, 60]) {
  for (const [name, t0] of [['spinup', 3.6], ['firework', 5.5]]) {
    const dir = join(out, 'strips', `${name}-${fps}fps`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 8; i++) {
      const urlData = await page.evaluate(async (t) => { const e = window.__pieFirework; e.seek(t); await window.__frame(); return document.querySelector('canvas').toDataURL('image/png'); }, t0 + i / fps);
      writeFileSync(join(dir, `f${i}.png`), Buffer.from(urlData.split(',')[1], 'base64'));
    }
  }
}

// Real-time screencast recordings.
async function record(w, h, from, to, name) {
  const { page: pg } = await openStage(w, h);
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const cdp = await pg.context().newCDPSession(pg);
  const shots = [];
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    shots.push({ data, ts: metadata.timestamp });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await pg.evaluate(async (from) => { const e = window.__pieFirework; e.setSpeed(1); e.seek(from); await window.__frame(); }, from);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, 300)); // let the first frame land
  await pg.evaluate(async (to) => {
    const e = window.__pieFirework; e.play();
    await new Promise((resolve) => { const tick = () => (e.getSnapshot().time >= to || !e.getSnapshot().playing ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });
  }, to);
  await new Promise((r) => setTimeout(r, 300));
  await cdp.send('Page.stopScreencast');
  shots.forEach((s, i) => writeFileSync(join(dir, `frame_${String(i).padStart(4, '0')}.jpg`), Buffer.from(s.data, 'base64')));
  writeFileSync(join(dir, 'timing.json'), JSON.stringify(shots.map((s) => s.ts)));
  await pg.close();
  const span = shots.at(-1).ts - shots[0].ts;
  return { frames: shots.length, seconds: +span.toFixed(2), captureFps: +((shots.length - 1) / span).toFixed(1), size: `${w}x${h}` };
}
if (!args['skip-recordings']) {
  report.recordings = {
    fullPlayback: await record(1920, 1080, 0, 8, 'rec-full-1080p'),
    fireworkAndExpansion: await record(1280, 720, 4.0, 8, 'rec-firework-720p'),
  };
}

report.consoleErrors = errors;
await swBrowser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
