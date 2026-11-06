#!/usr/bin/env node
/**
 * Deterministic spark-emission captures for visual review (SwiftShader, 1920×1080).
 * Run against two builds (or states) and compare with scripts/compare-sparks.py.
 *
 *   node scripts/capture-sparks.mjs --out captures/sparks/revised [--url http://localhost:5173]
 *
 * Four stages, each as a progression (8 frames across the stage) and as runs of
 * consecutive frames at 30 and 60 fps:
 *   1-ignition    first concentrated emission (5.1–5.45 s)
 *   2-spread      concentrated spray → full shower (5.45–6.2 s)
 *   3-peak        peak-speed emission (6.0–6.3 s)
 *   4-tilt        peak emission carrying into the 3D tilt (6.2–7.0 s)
 * Writes full frames (PNG) plus meta.json with every timestamp.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const url = args.url ?? 'http://localhost:5173';
const out = args.out ?? 'captures/sparks/current';
const W = 1920, H = 1080;

const frames = (fps, f0, n) => Array.from({ length: n }, (_, i) => (f0 + i) / fps);
const spread = (t0, t1, n) => Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
const STAGES = {
  '1-ignition': { progression: spread(5.1, 5.45, 8), c30: frames(30, 154, 6), c60: frames(60, 308, 8) },
  '2-spread': { progression: spread(5.45, 6.2, 8), c30: frames(30, 171, 6), c60: frames(60, 342, 8) },
  '3-peak': { progression: spread(6.0, 6.3, 8), c30: frames(30, 183, 6), c60: frames(60, 366, 8) },
  '4-tilt': { progression: spread(6.2, 7.0, 8), c30: frames(30, 195, 6), c60: frames(60, 390, 8) },
};

const browser = await (async () => {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    } catch { /* next */ }
  }
  throw new Error('No Edge or Chrome installation found.');
})();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`${url}/?debug=0&autoplay=0`);
await page.waitForFunction((w) => window.__pieFirework && window.__pieFireworkScene && document.querySelector('canvas')?.width === w, W);

async function grab(t) {
  return page.evaluate(async (t) => {
    const e = window.__pieFirework;
    e.pause();
    e.seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector('canvas').toDataURL('image/png');
  }, t);
}

const meta = {};
for (const [stage, sets] of Object.entries(STAGES)) {
  meta[stage] = {};
  for (const [set, times] of Object.entries(sets)) {
    const dir = join(out, stage, set);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [i, t] of times.entries()) {
      writeFileSync(join(dir, `f${String(i).padStart(2, '0')}.png`), Buffer.from((await grab(t)).split(',')[1], 'base64'));
    }
    meta[stage][set] = times.map((t) => +t.toFixed(4));
  }
}
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`captured ${Object.values(meta).reduce((n, s) => n + Object.values(s).flat().length, 0)} frames → ${out}`);
await browser.close();
