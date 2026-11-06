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
 * S. Sparks: ignition only once the disc is gold, uneven coverage at ignition →
 *    nearly 360° shower by the tilt, extent in body radii, live strand counts,
 *    source attached to the rim, birth tilts of live sparks, gone before the fill.
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
  // The firework rig's outer group (shake + expansion) holds the tilted group, which holds
  // the spinning group with the body meshes; visibility is switched on the outer group.
  let bodyMesh = null;
  window.__pieFireworkScene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aSide) bodyMesh = o; });
  const rig = bodyMesh.parent.parent.parent;
  for (const t of check) { e.seek(t); await window.__frame(); exact.push({ t: +t.toFixed(4), nonYellowPixels: nonYellow(), rigVisible: rig.visible }); }
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
  let sparkTrails = [], streakTrails = [];
  window.__pieFireworkScene.traverse((o) => {
    // Sparks: per-spark trail in aS2.x (strands and split-off embers). Streaks: trail in aS1.y.
    if (o.isMesh && o.geometry.attributes.aS3) { const a = o.geometry.attributes.aS2.array; for (let i = 0; i < a.length; i += 4) sparkTrails.push(a[i]); }
    else if (o.isMesh && o.geometry.attributes.aS1 && o.geometry.attributes.aS2) { const a = o.geometry.attributes.aS1.array; for (let i = 1; i < a.length; i += 4) streakTrails.push(a[i]); }
  });
  const sourceArcDeg = 30; // emission.ts sourceArc(): 30° at ignition → 42° in the full shower
  // Moving cel accents: [count per turn, apparent rev/s] — bevel arcs (pieShader.ts) and
  // side-wall tube stripes (sideShader.ts). Rim heat flashes are re-rolled, not moved.
  const arms = [[3, 2.0], [7, 1.3]];
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
      const windowDeg = Math.min(1, phys * (1 + e.state.smear)) * 360;   // Stage A stretches the hard smear (SpinnerBody)
      // The morph scales the angular structure by (1 − morph); at 1 the bands are rotation-invariant.
      const gap = Math.max(0, step - windowDeg) * (1 - e.state.morph);
      maxStepDeg = Math.max(maxStepDeg, step);
      if (gap > worstGap) { worstGap = gap; worstAt = { t: +t.toFixed(3), stepDeg: +step.toFixed(1), blurWindowDeg: +windowDeg.toFixed(1) }; }
    }
    res[`${fps}fps`] = {
      pieMaxStepDeg: +maxStepDeg.toFixed(1),
      pieUnblurredStepDeg: { worst: +worstGap.toFixed(1), at: worstAt, note: 'part of a frame-to-frame rotation step not covered by the blur window; the smallest sector is 21.9°, so steps well below that cannot strobe' },
      accentsWorstStepOfSpacing: +Math.max(...arms.map(([n, s]) => (n * s) / fps)).toFixed(3),
      streaksWorstStepOfTrail: +(1 / (fps * Math.min(...streakTrails))).toFixed(3),
      sparksWorstStepOfTrail: +(1 / (fps * Math.min(...sparkTrails))).toFixed(3),
      // The nozzle rides the chamfer accents (2 rev/s apparent); its hot source trails it.
      nozzleStepDeg: +((2 * 360) / fps).toFixed(1),
      nozzleStepOfSourceArc: +((2 * 360) / fps / sourceArcDeg).toFixed(3),
    };
  }
  res.criteria = 'moving accents < 0.5 of their spacing (direction cannot alias); streak/spark/source ratio ≤ 1 (each frame overlaps the previous one)';
  return res;
});

// ── E2. Cel / 3D appearance checks ──────────────────────────────────────────
// (a) Banding: inside the body, nearly all pixels fall into a handful of flat
//     tones (cel shading), not a gradient. Measured on a disc around the
//     projected body centre, away from the silhouette and the sparks.
// (b) Thickness: pixels that change when the side-wall mesh is hidden, i.e. the
//     visible side face. It should appear with the ignition tilt and grow in the zoom.
report.appearance = await page.evaluate(async () => {
  const e = window.__pieFirework;
  let side = null;
  window.__pieFireworkScene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aSide) side = o; });
  const times = [4.3, 4.8, 5.6, 6.6, 6.9, 7.1, 7.3];
  const out = [];
  for (const t of times) {
    e.seek(t); await window.__frame();
    const a = window.__pixels().slice();
    // Banding inside a disc of radius 0.6 R around the screen projection of the body centre.
    const W = 1920, H = 1080;
    const rig = side.parent.parent;
    const c = rig.getWorldPosition(side.position.clone().set(0, 0, 0)).project(window.__pieFireworkCamera);
    const cx = Math.round((c.x * 0.5 + 0.5) * W), cy = Math.round((1 - (c.y * 0.5 + 0.5)) * H);
    const counts = new Map(); let n = 0;
    const R = Math.round(Math.min(170 * Math.exp(e.state.expandLog), 900)); // integer: pixel indices must be whole
    for (let y = Math.max(0, cy - R); y < Math.min(H, cy + R); y += 2) for (let x = Math.max(0, cx - R); x < Math.min(W, cx + R); x += 2) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const i = (y * W + x) * 4; const k = (a[i] << 16) | (a[i + 1] << 8) | a[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1); n++;
    }
    const top = [...counts.values()].sort((p, q) => q - p);
    const share8 = top.slice(0, 8).reduce((p, q) => p + q, 0) / Math.max(n, 1);
    // Side wall contribution.
    side.material.visible = false;            // SpinnerBody owns mesh.visible; the material flag is free
    await window.__frame();
    const b = window.__pixels();
    side.material.visible = true;
    await window.__frame();
    let sidePx = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) sidePx++;
    out.push({ t, shade: +e.state.shade.toFixed(2), bodyPixelsInTop8Tones: +share8.toFixed(4), distinctTonesSampled: counts.size, sideWallPixels: sidePx });
  }
  return out;
});

// ── S. Sparks: sequence, coverage, extent, attachment, trajectories ────────────
// Spark pixels are the pixels that change when the spark mesh is hidden. Coverage
// counts 10° sectors around the projected body centre that hold spark pixels outside
// the body; extent is the spark-pixel radius in body radii (screen space).
report.sparks = await page.evaluate(async () => {
  const e = window.__pieFirework;
  const W = 1920, H = 1080;
  const scene = window.__pieFireworkScene, cam = window.__pieFireworkCamera;
  let sparks = null, source = null, side = null;
  scene.traverse((o) => {
    if (o.isMesh && o.geometry.attributes.aS3) sparks = o;
    if (o.isMesh && o.geometry.attributes.aArc) source = o;
    if (o.isMesh && o.geometry.attributes.aSide) side = o;
  });
  const tilted = side.parent.parent; // spinning group → tilted group
  const outer = tilted.parent;       // shake + expansion (the sparks' parent)
  const attr = (k) => sparks.geometry.attributes[k].array;
  const a0 = attr('aS0'), a1 = attr('aS1'), a2 = attr('aS2'), a3 = attr('aS3');
  const n = a0.length / 4;
  const p = e.getParams();
  const snap = e.getSnapshot();
  const fw = snap.schedule.find((s) => s.id === 'firework'), zm = snap.schedule.find((s) => s.id === 'zoom');
  const igniteStart = fw.start + (fw.end - fw.start) * p.goldAt;
  const showerStart = igniteStart + p.igniteDur;
  const gone = zm.start + (zm.end - zm.start) * (p.fillAt - 0.02);
  const V = outer.position.constructor;
  const project = (obj, x, y, z) => {
    const v = obj.localToWorld(new V(x, y, z)).project(cam);
    return [(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * H];
  };
  const diffMask = async (mesh) => {
    await window.__frame();
    const a = window.__pixels().slice();
    mesh.material.visible = false; await window.__frame();
    const b = window.__pixels();
    mesh.material.visible = true; await window.__frame();
    const px = [];
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) px.push(i / 4);
    return px;
  };
  const deg = (r) => +((-r * 180) / Math.PI).toFixed(1);
  const live = (t) => {
    let strands = 0, embers = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const age = t - a0[i * 4];
      if (age < 0 || age - a2[i * 4] > a0[i * 4 + 1]) continue;
      if (a3[i * 4 + 1] >= 0) { if (age > a3[i * 4 + 1]) embers++; continue; }
      strands++;
      lo = Math.min(lo, -a1[i * 4 + 3]); hi = Math.max(hi, -a1[i * 4 + 3]);
    }
    return { liveStrands: strands, liveEmbers: embers, birthTiltRangeDeg: strands ? [deg(-lo), deg(-hi)] : null };
  };
  const rows = [];
  for (const t of [igniteStart - 1 / 60, igniteStart + 0.05, 5.25, 5.35, showerStart, 5.6, 5.8, 6.0, 6.2, 6.45, 6.7, 6.95, 7.2, 7.4, gone + 0.005]) {
    e.seek(t);
    const px = await diffMask(sparks);
    const [cx, cy] = project(outer, 0, 0, 0);
    const [rx, ry] = project(outer, 1, 0, 0), [ux, uy] = project(outer, 0, 1, 0);
    const R = Math.max(Math.hypot(rx - cx, ry - cy), Math.hypot(ux - cx, uy - cy));
    const bins = new Array(36).fill(0);
    const radii = [];
    for (const i of px) {
      const x = i % W, y = Math.floor(i / W);
      const r = Math.hypot(x - cx, y - cy);
      if (r < 1.1 * R) continue;
      bins[Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * 36) % 36]++;
      radii.push(r / R);
    }
    radii.sort((a, b) => a - b);
    // Concentration: share of the spray (outside the body) in its densest 120° window
    // (a uniform halo gives 0.33).
    const total = bins.reduce((a, b) => a + b, 0);
    let best = 0;
    for (let k = 0; k < 36; k++) { let sum = 0; for (let j = 0; j < 12; j++) sum += bins[(k + j) % 36]; best = Math.max(best, sum); }
    // Hot source attached to the physical rim: distance from the nozzle, projected from the
    // tilted body frame, to the nearest pixel the source draws (0 = the nozzle is on it).
    let nozzleToSourceR = null;
    if (t > igniteStart && t < gone) {
      const sp = await diffMask(source);
      if (sp.length) {
        const u = source.material.uniforms;
        const [nx, ny] = project(tilted, u.uCentre.value * Math.cos(u.uNozzle.value), -u.uCentre.value * Math.sin(u.uNozzle.value), 0);
        let d = Infinity;
        for (const i of sp) d = Math.min(d, Math.hypot((i % W) - nx, Math.floor(i / W) - ny));
        nozzleToSourceR = +(d / R).toFixed(3);
      }
    }
    const q = tilted.quaternion;
    rows.push({
      t: +t.toFixed(3),
      sparkPixels: px.length,
      ...live(t),
      bodyTiltDeg: +((2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI).toFixed(1),
      coverage360: +(bins.filter((b) => b >= 4).length / 36).toFixed(2),
      densest120Share: total ? +(best / total).toFixed(2) : null,
      extentR: radii.length ? { p50: +radii[Math.floor(radii.length * 0.5)].toFixed(2), p95: +radii[Math.floor(radii.length * 0.95)].toFixed(2) } : null,
      fire: +e.state.fire.toFixed(3),
      nozzleToSourceR,
    });
  }
  e.seek(igniteStart);
  const goldMixAtIgnition = +e.state.goldMix.toFixed(4);
  let firstBirth = Infinity, lastDeath = 0, embers = 0;
  for (let i = 0; i < n; i++) {
    firstBirth = Math.min(firstBirth, a0[i * 4]);
    lastDeath = Math.max(lastDeath, a0[i * 4] + a0[i * 4 + 1] + a2[i * 4]);
    if (a3[i * 4 + 1] >= 0) embers++;
  }
  return {
    timing: { goldReached: +igniteStart.toFixed(3), goldMixAtIgnition, showerStart: +showerStart.toFixed(3), showerFull: +fw.end.toFixed(3), gone: +gone.toFixed(3) },
    instances: { total: n, embers, firstBirth: +firstBirth.toFixed(4), lastPossibleTrail: +lastDeath.toFixed(3) },
    rows,
    criteria: 'no spark pixels before ignition or after "gone"; ignition: partial coverage and a concentrated spray (densest 120° share well above 0.33); full shower: coverage ≥ 0.9; nozzle on the drawn source (0); live sparks keep the body tilt of their birth while the body tilts on',
  };
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
const sheetTimes = [1.6, 2.93, 3.8, 4.0, 4.08, 4.16, 4.32, 4.5, 4.8, 5.0, 5.12, 5.25, 5.38, 5.5, 5.65, 5.85, 6.05, 6.2, 6.5, 6.8, 7.05, 7.25, 7.47, 7.6];
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
  for (const [name, t0] of [['spinup', 3.6], ['transition', 4.1], ['ignition', 5.15], ['shower', 5.9], ['tilt', 6.25], ['zoom', 6.8]]) {
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
    pieToFirework: await record(1280, 720, 3.7, 5.1, 'rec-transition-720p'),
    sparks: await record(1280, 720, 4.9, 6.6, 'rec-sparks-720p'),
    tiltAndZoom: await record(1280, 720, 6.1, 8.0, 'rec-zoom-720p'),
  };
}

report.consoleErrors = errors;
await swBrowser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
