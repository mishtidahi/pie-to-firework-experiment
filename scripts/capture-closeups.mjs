#!/usr/bin/env node
/**
 * Deterministic close-up captures for visual review (SwiftShader, 1920×1080).
 * Run the same command against two builds or states to compare them.
 *
 *   node scripts/capture-closeups.mjs --out captures/refine/revised [--url http://localhost:5173]
 *
 * Writes PNG crops plus meta.json:
 *   transition-30fps/  consecutive 30 fps frames, 3.967–4.5 s, centred on the disc
 *   transition-60fps/  consecutive 60 fps frames, 4.0–4.3 s
 *   rim/               tilt-and-zoom frames cropped to the visible side wall/bevel
 * Build comparison sheets with: python scripts/compare-closeups.py <a> <b> <out.png> [labels]
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const url = args.url ?? 'http://localhost:5173';
const out = args.out ?? 'captures/closeups';
const W = 1920, H = 1080;

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

/** Seek, render, and return a PNG data URL of the crop box (or the full frame). */
async function grab(t, box) {
  return page.evaluate(async ({ t, box }) => {
    const e = window.__pieFirework;
    e.pause();
    e.seek(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const gl = document.querySelector('canvas');
    const [x, y, w, h] = box ?? [0, 0, gl.width, gl.height];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(gl, x, y, w, h, 0, 0, w, h);
    return c.toDataURL('image/png');
  }, { t, box });
}

/** Bounding box of the pixels the side wall contributes at time t (null if none). */
async function sideWallBox(t) {
  return page.evaluate(async (t) => {
    const e = window.__pieFirework;
    e.seek(t);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const px = () => {
      const gl = document.querySelector('canvas');
      const ctx = new OffscreenCanvas(gl.width, gl.height).getContext('2d');
      ctx.drawImage(gl, 0, 0);
      return ctx.getImageData(0, 0, gl.width, gl.height).data;
    };
    let side = null;
    window.__pieFireworkScene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aSide) side = o; });
    if (!side) return null;
    await frame();
    const a = px();
    side.material.visible = false;
    await frame();
    const b = px();
    side.material.visible = true;
    const W = 1920;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
        const x = (i / 4) % W, y = Math.floor(i / 4 / W);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1, y1];
  }, t);
}

const save = (dir, name, dataUrl) => writeFileSync(join(dir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const meta = {};

for (const [name, fps, f0, f1] of [['transition-30fps', 30, 119, 135], ['transition-60fps', 60, 240, 258]]) {
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  meta[name] = [];
  for (let f = f0; f <= f1; f++) {
    save(dir, `f${String(f - f0).padStart(2, '0')}.png`, await grab(f / fps, [W / 2 - 240, H / 2 - 240, 480, 480]));
    meta[name].push(+(f / fps).toFixed(4));
  }
}

const rimDir = join(out, 'rim');
rmSync(rimDir, { recursive: true, force: true });
mkdirSync(rimDir, { recursive: true });
meta.rim = [];
for (const [i, t] of [5.6, 6.6, 6.9, 7.1].entries()) {
  const bb = await sideWallBox(t);
  // Square crop centred just above the lowest (nearest) point of the side wall, where the
  // thickness and bevel are seen best, with the top-face edge above it.
  const size = Math.min(H, Math.max(360, bb ? (bb[2] - bb[0]) * 0.42 : 600));
  const cx = bb ? (bb[0] + bb[2]) / 2 : W / 2, cy = bb ? bb[3] - 0.38 * size : H / 2;
  const box = [Math.round(Math.min(Math.max(cx - size / 2, 0), W - size)), Math.round(Math.min(Math.max(cy - size / 2, 0), H - size)), Math.round(size), Math.round(size)];
  save(rimDir, `r${i}.png`, await grab(t, box));
  save(rimDir, `full${i}.png`, await grab(t));
  meta.rim.push({ t, sideWallBox: bb, crop: box });
}
writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta.rim));
await browser.close();
