#!/usr/bin/env node
/**
 * Browser verification of presets (requires the dev server).
 *
 *   node scripts/verify-presets.mjs [--url http://localhost:5173] [--baseline-url http://localhost:5174 [--baseline-until 4.0]]
 *
 * Renders on SwiftShader (bit-exact), with the workbench stage forced to the
 * same 960×540 canvas as the player so frames can be compared pixel for pixel.
 *
 *  1. Cross-mode: workbench vs player for the default, a repository preset
 *     (?preset=final) and an inline custom preset: same fingerprint, params,
 *     duration, anim state and frame hashes at the 9 reference timestamps.
 *  2. Reload persistence (named, inline-imported, draft restore).
 *  3. Export JSON through the UI and import it into a fresh browser session;
 *     the player link reproduces it.
 *  4. Validation in the UI (invalid file rejected, nothing applied).
 *  5. Explicit errors: unknown preset, bad inline data, ambiguous URL, fingerprint pin.
 *  6. Dev "Save to project" endpoint (create, refuse overwrite, protect default, reject invalid).
 *  7. Export plan → player page consistency (Phase 4 contract).
 *  8. Optional: default animation pixel-identical to a baseline build (e.g. tag phase3-complete),
 *     over the whole timeline or only before --baseline-until seconds (for intentional later changes).
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { animationDuration, defaultParams } from '../src/config/params.ts';
import { PRESET_VERSION, createPreset, encodePresetForUrl, presetFingerprint, serializePreset, validatePreset } from '../src/config/preset.ts';
import { PRESET_DIR, resolveExportConfig } from './lib/export-config.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const BASE = args.url ?? 'http://localhost:5173';
const BASELINE = args['baseline-url'];
const BASELINE_UNTIL = args['baseline-until'] !== undefined ? Number(args['baseline-until']) : Infinity;
const TIMES = [0.0, 1.6, 2.05, 4.0, 4.8, 5.5, 6.9, 7.6, 8.0];
const W = 960, H = 540;
const tmp = mkdtempSync(join(tmpdir(), 'pie-presets-'));
const results = [];
const check = (name, pass, detail = {}) => {
  results.push({ name, pass: Boolean(pass), ...detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${Object.keys(detail).length ? `  ${JSON.stringify(detail)}` : ''}`);
};

const browser = await (async () => {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    } catch { /* next */ }
  }
  throw new Error('No Edge or Chrome installation found.');
})();

/** Open a page in a fresh context (isolated storage unless a context is given). */
async function open(path, { mode, context, base = BASE } = {}) {
  const ctx = context ?? (await browser.newContext({ acceptDownloads: true }));
  const player = mode === 'player';
  const page = await ctx.newPage({});
  await page.setViewportSize(player ? { width: W, height: H } : { width: 1700, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + path);
  await ready(page, player);
  return { page, ctx, errors };
}

async function ready(page, player) {
  await page.waitForFunction(() => window.__pieFirework || window.__pieFireworkPresetError, null, { timeout: 30000 });
  if (await page.evaluate(() => Boolean(window.__pieFireworkPresetError))) return;
  if (!player) await page.addStyleTag({ content: `.stage { width: ${W}px !important; height: ${H}px !important; aspect-ratio: auto !important; }` });
  await page.waitForFunction(({ W, H }) => { const c = document.querySelector('canvas'); return c && c.width === W && c.height === H; }, { W, H }, { timeout: 30000 });
  await page.evaluate(() => {
    window.__pieFirework.pause();
    window.__frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** State JSON + frame hash at each timestamp. */
async function sample(page, times = TIMES) {
  return page.evaluate(async (times) => {
    const e = window.__pieFirework;
    const out = [];
    for (const t of times) {
      e.seek(t);
      await window.__frame();
      const c = document.querySelector('canvas');
      const ctx = new OffscreenCanvas(c.width, c.height).getContext('2d');
      ctx.drawImage(c, 0, 0);
      const d = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, c.width, c.height).data.buffer);
      out.push({
        t,
        state: JSON.stringify(e.state, (k, v) => (k === '_gsap' ? undefined : v)),
        hash: Array.from(new Uint8Array(d).slice(0, 10)).map((b) => b.toString(16).padStart(2, '0')).join(''),
      });
    }
    return out;
  }, times);
}

const info = (page) =>
  page.evaluate(() => {
    const p = window.__pieFirework.getParams();
    const { exportFps, ...anim } = p;
    return { fingerprint: window.__pieFireworkPreset.fingerprint, name: window.__pieFireworkPreset.name, source: window.__pieFireworkPreset.source.kind, anim, duration: window.__pieFirework.getSnapshot().duration };
  });

const custom = createPreset('verify-custom', {
  ...defaultParams(),
  seed: 4242, tiltDeg: 44, tiltAxisDeg: 12, showerDensity: 2600, glow: 0.8, discOrange: 0.75, overshootDeg: 30, durZoom: 1.5, durHold: 0.3,
}, 'Cross-mode verification preset');
const customHash = `#preset=${encodePresetForUrl(custom)}`;

// ── 1. Cross-mode consistency ────────────────────────────────────────────────
const configs = [
  { label: 'default (no preset in URL)', q: '', expectFp: presetFingerprint(defaultParams()), expectDur: animationDuration(defaultParams()) },
  { label: 'repository preset ?preset=final', q: '?preset=final', expectFp: presetFingerprint(JSON.parse(readFileSync(join(PRESET_DIR, 'final.json'), 'utf8')).params), expectDur: animationDuration(defaultParams()) },
  { label: 'inline custom preset #preset=', q: customHash, expectFp: presetFingerprint(custom.params), expectDur: animationDuration(custom.params) },
];
const samplesByConfig = {};
for (const cfg of configs) {
  const wbPath = cfg.q.startsWith('#') ? `/${cfg.q}` : `/${cfg.q}`;
  const plPath = cfg.q.startsWith('#') ? `/?debug=0&autoplay=0${cfg.q}` : `/${cfg.q ? `${cfg.q}&` : '?'}debug=0&autoplay=0`;
  const wb = await open(wbPath, { mode: 'workbench' });
  const pl = await open(plPath, { mode: 'player' });
  const [wi, pi] = [await info(wb.page), await info(pl.page)];
  const [ws, ps] = [await sample(wb.page), await sample(pl.page)];
  samplesByConfig[cfg.label] = ps;
  const stateMismatch = TIMES.filter((_, i) => ws[i].state !== ps[i].state);
  const frameMismatch = TIMES.filter((_, i) => ws[i].hash !== ps[i].hash);
  check(`[${cfg.label}] same fingerprint in both modes, equal to the preset file`, wi.fingerprint === pi.fingerprint && wi.fingerprint === cfg.expectFp, { workbench: wi.fingerprint, player: pi.fingerprint });
  check(`[${cfg.label}] identical animation params`, JSON.stringify(wi.anim) === JSON.stringify(pi.anim));
  check(`[${cfg.label}] engine duration = animationDuration(preset)`, wi.duration === cfg.expectDur && pi.duration === cfg.expectDur, { duration: pi.duration });
  check(`[${cfg.label}] identical anim state at ${TIMES.join(', ')} s`, stateMismatch.length === 0, { mismatched: stateMismatch });
  check(`[${cfg.label}] bit-identical rendered frames at all timestamps`, frameMismatch.length === 0, { mismatched: frameMismatch });
  check(`[${cfg.label}] no page errors`, wb.errors.length + pl.errors.length === 0, { errors: [...wb.errors, ...pl.errors] });
  await wb.ctx.close();
  await pl.ctx.close();
}
{
  const d = samplesByConfig['default (no preset in URL)'];
  const c = samplesByConfig['inline custom preset #preset='];
  check('custom preset really differs from default in the player (5.5 s and 6.9 s frames)', d[5].hash !== c[5].hash && d[6].hash !== c[6].hash);
}

// ── 2. Reload persistence ────────────────────────────────────────────────────
{
  const { page, ctx } = await open('/?preset=final', { mode: 'workbench' });
  const before = await info(page);
  await page.reload();
  await ready(page, false);
  const after = await info(page);
  check('named preset survives reload', before.fingerprint === after.fingerprint && after.name === 'final');

  // Draft: edit, reload → offered (not auto-applied), restore → edits back.
  await page.evaluate(() => window.__pieFirework.setParams({ ...window.__pieFirework.getParams(), glow: 1.2, seed: 777 }));
  await page.waitForTimeout(200);
  await page.reload();
  await ready(page, false);
  const reloaded = await info(page);
  const banner = await page.locator('.draft-banner').count();
  check('draft is not auto-applied after reload (URL stays authoritative)', reloaded.anim.glow === 0.5 && reloaded.anim.seed === 1337);
  check('draft restore is offered after reload', banner === 1);
  await page.click('.draft-banner button:has-text("Restore")');
  const restored = await info(page);
  check('draft restore brings the edits back', restored.anim.glow === 1.2 && restored.anim.seed === 777);
  const modifiedTag = await page.locator('.tag.modified').count();
  check('workbench marks the preset as modified', modifiedTag === 1);
  await ctx.close();
}

// ── 3. Export JSON via the UI → fresh browser session import → player link ───
{
  const { page, ctx } = await open('/', { mode: 'workbench' });
  await page.evaluate(() => window.__pieFirework.setParams({ ...window.__pieFirework.getParams(), tiltDeg: 50, showerDensity: 2200, discOrange: 0.68 }));
  await page.fill('.preset-panel input.text', 'verify-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export JSON")')]);
  const exportedPath = join(tmp, 'verify-export.json');
  await dl.saveAs(exportedPath);
  const exported = JSON.parse(readFileSync(exportedPath, 'utf8'));
  const v = validatePreset(exported);
  const current = await info(page);
  check(`exported JSON is a valid v${PRESET_VERSION} preset named as requested`, v.ok && exported.version === PRESET_VERSION && exported.name === 'verify-export' && dl.suggestedFilename() === 'verify-export.json');
  check('exported JSON contains exactly the current animation params', v.ok && JSON.stringify(v.preset.params) === JSON.stringify(current.anim));
  check('exported JSON excludes output settings', !('exportFps' in exported.params));
  await ctx.close();

  const fresh = await open('/', { mode: 'workbench' }); // new context = empty localStorage
  await Promise.all([fresh.page.waitForURL(/#preset=/), fresh.page.setInputFiles('[data-testid=preset-import]', exportedPath)]);
  await ready(fresh.page, false);
  const imported = await info(fresh.page);
  check('import into a fresh browser session applies the file exactly', imported.fingerprint === presetFingerprint(exported.params) && imported.name === 'verify-export' && imported.source === 'inline');
  await fresh.page.reload();
  await ready(fresh.page, false);
  check('imported preset survives reload (carried in the URL)', (await info(fresh.page)).fingerprint === imported.fingerprint);
  const wbFrames = await sample(fresh.page, [5.5, 6.9]);
  const playerLink = await fresh.page.evaluate(() => {
    let link = '';
    const orig = window.open;
    window.open = (u) => { link = String(u); return null; };
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open in player').click();
    window.open = orig;
    return new URL(link, location.href).href;
  });
  const pl = await open(new URL(playerLink).pathname + new URL(playerLink).search.replace('?', '?autoplay=0&') + new URL(playerLink).hash, { mode: 'player' });
  const plInfo = await info(pl.page);
  const plFrames = await sample(pl.page, [5.5, 6.9]);
  check('"Open in player" link reproduces the imported preset', plInfo.fingerprint === imported.fingerprint && plFrames.every((f, i) => f.hash === wbFrames[i].hash));
  await pl.ctx.close();

  // ── 4. Invalid import is rejected and nothing changes ─────────────────────
  const bad = { ...exported, params: { ...exported.params, tiltDeg: 400, glow: 'x' } };
  const badPath = join(tmp, 'bad.json');
  writeFileSync(badPath, JSON.stringify(bad));
  const urlBefore = fresh.page.url();
  await fresh.page.setInputFiles('[data-testid=preset-import]', badPath);
  await fresh.page.waitForSelector('[data-testid=preset-messages]');
  const msg = await fresh.page.textContent('[data-testid=preset-messages]');
  check('invalid import shows validation errors', /tiltDeg = 400 is outside/.test(msg) && /glow must be a finite number/.test(msg), { msg: msg.slice(0, 160) });
  check('invalid import leaves the active preset untouched', fresh.page.url() === urlBefore && (await info(fresh.page)).fingerprint === imported.fingerprint);
  writeFileSync(join(tmp, 'notjson.json'), '{ nope');
  await fresh.page.setInputFiles('[data-testid=preset-import]', join(tmp, 'notjson.json'));
  await fresh.page.waitForFunction(() => /not valid JSON/.test(document.querySelector('[data-testid=preset-messages]')?.textContent ?? ''));
  check('non-JSON import is rejected', true);
  await fresh.ctx.close();
}

// ── 5. Explicit errors (no silent fallback) ──────────────────────────────────
for (const [label, path, re] of [
  ['unknown named preset (player)', '/?debug=0&preset=nope', /not found/],
  ['unknown named preset (workbench)', '/?preset=nope', /not found/],
  ['garbage inline preset', '/?debug=0#preset=@@@', /could not be read/],
  ['ambiguous ?preset and #preset', `/?debug=0&preset=default${customHash}`, /Ambiguous/],
  ['fingerprint pin mismatch', '/?debug=0&preset=default&fp=00000000000000', /fingerprint mismatch/i],
]) {
  const { page, ctx } = await open(path, { mode: path.includes('debug=0') ? 'player' : 'workbench' });
  const state = await page.evaluate(() => ({ err: window.__pieFireworkPresetError, engine: Boolean(window.__pieFirework), canvas: Boolean(document.querySelector('canvas')) }));
  check(`explicit error: ${label}`, state.err && re.test(state.err.title) && !state.engine && !state.canvas, { title: state.err?.title });
  await ctx.close();
}
{
  const fp = presetFingerprint(defaultParams());
  const { page, ctx } = await open(`/?debug=0&autoplay=0&preset=default&fp=${fp}`, { mode: 'player' });
  check('correct fingerprint pin loads normally', (await info(page)).fingerprint === fp);
  await ctx.close();
}

// ── 6. Dev "Save to project" endpoint ────────────────────────────────────────
{
  const name = 'zz-verify-temp';
  const file = join(PRESET_DIR, `${name}.json`);
  rmSync(file, { force: true });
  const post = (body) => fetch(`${BASE}/__presets/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const preset = createPreset(name, { ...defaultParams(), seed: 31337 });
  const r1 = await post({ preset });
  const r2 = await post({ preset });
  const r3 = await post({ preset: createPreset('default', defaultParams()), overwrite: true });
  const r4 = await post({ preset: { ...preset, params: { ...preset.params, glow: 99 } }, overwrite: true });
  const r5 = await post({ preset: createPreset(name, { ...defaultParams(), seed: 31338 }), overwrite: true });
  check('save endpoint writes a new preset file', r1.status === 200 && existsSync(file));
  check('save endpoint refuses to overwrite without the flag', r2.status === 409);
  check('save endpoint protects the default preset', r3.status === 403);
  check('save endpoint rejects invalid presets', r4.status === 422 && /glow = 99/.test(r4.body.errors.join(' ')));
  check('save endpoint overwrites when asked', r5.status === 200 && JSON.parse(readFileSync(file, 'utf8')).params.seed === 31338);
  await new Promise((r) => setTimeout(r, 800)); // let Vite pick up the new file
  const { page, ctx } = await open(`/?debug=0&autoplay=0&preset=${name}`, { mode: 'player' });
  const saved = await page.evaluate(() => window.__pieFireworkPreset && window.__pieFireworkPreset.preset.params.seed);
  check('a saved preset is immediately loadable by name', saved === 31338);
  await ctx.close();
  rmSync(file, { force: true });
}

// ── 7. Export plan → player page (Phase 4 contract) ──────────────────────────
for (const opts of [{ preset: 'final', fps: '60' }, { 'preset-file': (writeFileSync(join(tmp, 'verify-custom.json'), serializePreset(custom)), join(tmp, 'verify-custom.json')) }]) {
  const plan = resolveExportConfig(opts);
  const { page, ctx } = await open(plan.page.url, { mode: 'player' });
  const pi = await info(page);
  check(`export plan (${plan.preset.source}: ${plan.preset.name}) loads in the player with the same fingerprint and duration`, pi.fingerprint === plan.preset.fingerprint && pi.duration === plan.timeline.duration, { fp: pi.fingerprint });
  await ctx.close();
}

// ── 8. Default animation unchanged vs a baseline build ───────────────────────
if (BASELINE) {
  const cur = await open('/?debug=0&autoplay=0', { mode: 'player' });
  const old = await open('/?debug=0', { mode: 'player', base: BASELINE });
  const fine = Array.from({ length: 81 }, (_, i) => i * 0.1);
  const times = [...new Set([...TIMES, ...fine].map((t) => +t.toFixed(3)))].filter((t) => t < BASELINE_UNTIL).sort((a, b) => a - b);
  const [a, b] = [await sample(cur.page, times), await sample(old.page, times)];
  // Compare the state keys both builds share (later revisions may add fields).
  const shared = (x, y) => {
    const [px, py] = [JSON.parse(x), JSON.parse(y)];
    return Object.keys(px).filter((k) => k in py).every((k) => JSON.stringify(px[k]) === JSON.stringify(py[k]));
  };
  const diffFrames = times.filter((_, i) => a[i].hash !== b[i].hash);
  const diffState = times.filter((_, i) => !shared(a[i].state, b[i].state));
  const range = Number.isFinite(BASELINE_UNTIL) ? ` (t < ${BASELINE_UNTIL} s)` : '';
  check(`default animation pixel-identical to baseline build at ${times.length} timestamps${range}`, diffFrames.length === 0, { baseline: BASELINE, mismatched: diffFrames });
  check(`default animation state identical to baseline build${range}`, diffState.length === 0, { mismatched: diffState });
  await cur.ctx.close();
  await old.ctx.close();
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync('captures/presets-report.json', JSON.stringify({ timestamps: TIMES, results }, null, 2));
process.exit(failed.length ? 1 : 0);
