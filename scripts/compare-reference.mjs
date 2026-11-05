#!/usr/bin/env node
/**
 * Renders the animation at exactly 1920×1080 in a headless system browser
 * (Edge, falling back to Chrome) and diffs the WebGL canvas at time `--t`
 * against the reference PNG, pixel by pixel, inside the page.
 *
 *   node scripts/compare-reference.mjs [--url http://localhost:5173] [--t 2.2] [--out shot.png]
 *
 * Requires the dev (or preview) server to be running.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://localhost:5173';
const t = Number(args.t ?? 0);

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
    } catch {
      /* try next */
    }
  }
  throw new Error('No Edge or Chrome installation found for playwright-core.');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${url}/?debug=0`);
// Wait until R3F has measured the stage and resized the drawing buffer.
await page.waitForFunction(() => window.__pieFirework && document.querySelector('canvas')?.width === 1920);

const result = await page.evaluate(async (time) => {
  const engine = window.__pieFirework;
  engine.pause();
  engine.seek(time);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const gl = document.querySelector('canvas');
  const W = 1920, H = 1080;
  const rendered = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  rendered.drawImage(gl, 0, 0, W, H);
  const a = rendered.getImageData(0, 0, W, H).data;

  const img = new Image();
  img.src = '/references/piechart-for-diwali-gif.png'; // served from the project root by Vite
  await img.decode();
  const ref = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  ref.drawImage(img, 0, 0);
  const b = ref.getImageData(0, 0, W, H).data;

  let exact = 0, within8 = 0, worst = 0, sumAbs = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d === 0) exact++;
    if (d <= 8) within8++;
    if (d > worst) worst = d;
    sumAbs += d;
  }
  const px = (x, y) => Array.from(a.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
  const total = W * H;
  return {
    canvasSize: [gl.width, gl.height],
    duration: engine.getSnapshot().duration,
    phase: engine.getSnapshot().schedule[engine.getSnapshot().phaseIndex].id,
    exactPct: (100 * exact) / total,
    within8Pct: (100 * within8) / total,
    over8Pixels: total - within8,
    worstChannelDiff: worst,
    meanChannelDiff: sumAbs / total,
    samples: { bg: px(100, 100), orange: px(1060, 440), white: px(1050, 640), gapCenter: px(1100, 540) },
    dataUrl: gl.toDataURL('image/png'),
  };
}, t);

if (args.out) writeFileSync(args.out, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
delete result.dataUrl;
console.log(JSON.stringify({ t, ...result, consoleErrors: errors }, null, 2));
await browser.close();
