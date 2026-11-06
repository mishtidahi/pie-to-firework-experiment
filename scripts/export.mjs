#!/usr/bin/env node
/**
 * Phase 4: deterministic MP4 export of a repository preset.
 *
 *   npm run export                               → export/pie-to-firework-final-4s.mp4 (4 s, 240 frames)
 *   npm run export -- --preset final             → export/pie-to-firework-final.mp4    (8 s fallback, 480 frames)
 *
 * 1920×1080, 60 fps, duration × 60 frames, H.264 (libx264, CRF 18, preset medium),
 * yuv420p BT.709, faststart, no audio.
 *
 * The plan (preset, fingerprint, page URL, frame times) comes from
 * scripts/lib/export-config.mjs. A private Vite server serves the standalone
 * player; Edge/Chrome renders it with SwiftShader (bit-exact, GPU-independent);
 * frame i is seeked to t = i / 60 and the canvas PNG is streamed into FFmpeg.
 *
 * FFmpeg: $FFMPEG_PATH, else `ffmpeg` on PATH, else the binary bundled with the
 * Python package imageio-ffmpeg.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { PROJECT_ROOT, frameTimes, parseArgs, resolveExportConfig } from './lib/export-config.mjs';

const { preset = 'final-4s' } = parseArgs(process.argv.slice(2));
const OUT = resolve(PROJECT_ROOT, 'export', `pie-to-firework-${preset}.mp4`);

function findFfmpeg() {
  const works = (bin) => bin && spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
  if (works(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (works('ffmpeg')) return 'ffmpeg';
  for (const py of ['python', 'python3', 'py']) {
    const r = spawnSync(py, ['-c', 'import imageio_ffmpeg as m; print(m.get_ffmpeg_exe())'], { encoding: 'utf8' });
    const bin = r.status === 0 ? r.stdout.trim() : '';
    if (works(bin)) return bin;
  }
  throw new Error('FFmpeg not found: set FFMPEG_PATH, put ffmpeg on PATH, or `pip install imageio-ffmpeg`.');
}

const plan = resolveExportConfig({ preset, width: '1920', height: '1080', fps: '60', format: 'mp4' });
if (plan.preset.version !== 3) throw new Error(`presets/${preset}.json must be version 3 (got ${plan.preset.version}).`);
const exactFrames = plan.timeline.duration * plan.output.fps;
if (Math.abs(exactFrames - Math.round(exactFrames)) > 1e-9 || plan.timeline.frameCount !== Math.round(exactFrames)) {
  throw new Error(`Duration ${plan.timeline.duration} s is not a whole number of frames at ${plan.output.fps} fps.`);
}
const { width: W, height: H, fps } = plan.output;
const ffmpegBin = findFfmpeg();
console.log(`preset ${preset} v${plan.preset.version} (fp ${plan.preset.fingerprint}) → ${W}x${H} @ ${fps} fps, ${plan.timeline.frameCount} frames`);

const server = await createServer({ root: PROJECT_ROOT, logLevel: 'error', server: { port: 5190, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
let browser;
try {
  for (const channel of ['msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      break;
    } catch { /* try the next channel */ }
  }
  if (!browser) throw new Error('No Edge or Chrome installation found.');
  const page = await browser.newPage({ viewport: plan.page.viewport, deviceScaleFactor: plan.page.deviceScaleFactor });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  await page.goto(base + plan.page.url);
  await page.waitForFunction(
    (w) => window.__pieFireworkPresetError || (window.__pieFirework && document.querySelector('canvas')?.width === w),
    W,
    { timeout: 120_000 },
  );
  const loaded = await page.evaluate(() => ({ err: window.__pieFireworkPresetError ?? null, p: window.__pieFireworkPreset ?? null }));
  if (loaded.err || loaded.p?.fingerprint !== plan.preset.fingerprint) {
    throw new Error(`Player did not load the final preset: ${JSON.stringify(loaded.err ?? loaded.p?.fingerprint)}`);
  }

  mkdirSync(resolve(OUT, '..'), { recursive: true });
  const tmp = OUT.replace(/\.mp4$/, '.partial.mp4');
  const ff = spawn(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(fps), '-movflags', '+faststart', tmp,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error(`FFmpeg exited with ${c}`)))));

  const t0 = Date.now();
  const times = frameTimes(plan);
  for (const [i, t] of times.entries()) {
    const png = await page.evaluate(async (t) => {
      const e = window.__pieFirework;
      e.pause();
      e.seek(t);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('canvas').toDataURL('image/png');
    }, t);
    if (!ff.stdin.write(Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 60 === 59 || i === times.length - 1) console.log(`  ${i + 1}/${times.length} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await done;
  if (pageErrors.length) throw new Error(`Page errors during export:\n${pageErrors.join('\n')}`);
  rmSync(OUT, { force: true });
  renameSync(tmp, OUT);
  console.log(`wrote ${OUT} (${(statSync(OUT).size / 1e6).toFixed(2)} MB)`);
} finally {
  await browser?.close();
  await server.close();
}
