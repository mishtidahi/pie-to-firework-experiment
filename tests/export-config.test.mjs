// Unit tests for the Phase 4 export configuration interface (no rendering).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultParams } from '../src/config/params.ts';
import { createPreset, decodePresetFromUrl, presetFingerprint, serializePreset } from '../src/config/preset.ts';
import { ExportConfigError, frameTimes, loadPreset, parseArgs, resolveExportConfig } from '../scripts/lib/export-config.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'pie-export-'));
const writePreset = (file, obj) => {
  const p = join(tmp, file);
  writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
};
const throwsConfig = (fn, re) =>
  assert.throws(fn, (e) => e instanceof ExportConfigError && re.test([e.message, ...e.details].join('\n')));

test('named preset resolves to a full plan with defaults for output options', () => {
  const plan = resolveExportConfig({ preset: 'default' });
  assert.equal(plan.preset.name, 'default');
  assert.equal(plan.preset.source, 'repository');
  assert.equal(plan.preset.fingerprint, presetFingerprint(defaultParams()));
  assert.deepEqual([plan.output.width, plan.output.height, plan.output.fps], [1920, 1080, 30]);
  assert.deepEqual(plan.output.formats, ['png']);
  assert.equal(plan.output.renderer, 'swiftshader');
  assert.equal(plan.timeline.frameCount, 240);
  assert.equal(plan.page.url, `/?debug=0&autoplay=0&preset=default&fp=${plan.preset.fingerprint}`);
});

test('output options are independent of the animation (same fingerprint, different plan)', () => {
  const a = resolveExportConfig(parseArgs(['--preset', 'default', '--width', '1280', '--height', '720', '--fps', '60', '--format', 'png,mp4,gif']));
  assert.deepEqual([a.output.width, a.output.height, a.output.fps], [1280, 720, 60]);
  assert.deepEqual(a.output.formats, ['png', 'mp4', 'gif']);
  assert.equal(a.timeline.frameCount, 480);
  assert.equal(a.preset.fingerprint, resolveExportConfig({ preset: 'default' }).preset.fingerprint);
  const times = frameTimes(a);
  assert.equal(times.length, 480);
  assert.equal(times[0], 0);
  assert.equal(times[60], 1);
});

test('preset files exported from the workbench are passed inline to the player', () => {
  const custom = createPreset('custom-look', { ...defaultParams(), seed: 99, tiltDeg: 40 });
  const file = writePreset('custom-look.json', serializePreset(custom));
  const plan = resolveExportConfig({ 'preset-file': file, fps: '24' });
  assert.equal(plan.preset.source, 'file');
  assert.match(plan.page.url, /^\/\?debug=0&autoplay=0&fp=[0-9a-f]{14}#preset=/);
  const inline = decodePresetFromUrl(plan.page.url.split('#preset=')[1]);
  assert.equal(inline.params.seed, 99);
  assert.equal(plan.preset.fingerprint, presetFingerprint(custom.params));
});

test('explicit preset that cannot be found is an error, never a fallback', () => {
  throwsConfig(() => resolveExportConfig({ preset: 'does-not-exist' }), /not found[\s\S]*Available presets: .*\bdefault\b.*\bfinal\b/);
  throwsConfig(() => resolveExportConfig({ 'preset-file': join(tmp, 'missing.json') }), /Preset file not found/);
  throwsConfig(() => resolveExportConfig({ preset: '../package' }), /not a valid preset name/);
  throwsConfig(() => resolveExportConfig({}), /No preset selected/);
  throwsConfig(() => resolveExportConfig({ preset: true }), /No preset selected/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', 'preset-file': 'x.json' }), /not both/);
});

test('invalid preset files are rejected with validation details', () => {
  throwsConfig(() => loadPreset({ file: writePreset('broken.json', '{ nope') }), /not valid JSON/);
  const bad = JSON.parse(serializePreset(createPreset('bad', defaultParams())));
  bad.params.tiltDeg = 500;
  bad.params.exportFps = 60;
  throwsConfig(() => loadPreset({ file: writePreset('bad.json', bad) }), /exportFps is an output setting[\s\S]*tiltDeg = 500 is outside/);
  const renamed = JSON.parse(serializePreset(createPreset('other-name', defaultParams())));
  writePreset('mismatch.json', renamed);
  throwsConfig(() => loadPreset({ name: 'mismatch', presetDir: tmp }), /file name and name must match/);
});

test('output validation: aspect, dimensions, fps, formats, renderer, range, unknown options', () => {
  throwsConfig(() => resolveExportConfig({ preset: 'default', width: '1080', height: '1920' }), /does not match the preset's aspect ratio 16:9/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', width: '1919', height: '1079', format: 'mp4' }), /even dimensions|aspect/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', fps: '29.97' }), /--fps must be a whole number/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', fps: '0' }), /--fps must be a whole number/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', format: 'mov' }), /--format must be/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', renderer: 'cpu' }), /--renderer must be/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', from: '5', to: '4' }), /from < to/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', to: '9' }), /to ≤ 8/);
  throwsConfig(() => resolveExportConfig({ preset: 'default', resolution: '4k' }), /Unknown option --resolution/);
});

test('square preset gets a square default resolution', () => {
  const sq = createPreset('square', { ...defaultParams(), aspect: '1:1' });
  const plan = resolveExportConfig({ 'preset-file': writePreset('square.json', serializePreset(sq)) });
  assert.deepEqual([plan.output.width, plan.output.height], [1080, 1080]);
});

test('time range selects a sub-sequence on the same frame grid', () => {
  const plan = resolveExportConfig({ preset: 'default', fps: '30', from: '4', to: '8' });
  assert.equal(plan.timeline.frameCount, 120);
  assert.equal(frameTimes(plan)[0], 4);
  assert.ok(Math.abs(frameTimes(plan)[119] - (4 + 119 / 30)) < 1e-12);
});
