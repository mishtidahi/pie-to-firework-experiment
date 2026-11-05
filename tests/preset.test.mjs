// Unit tests for the preset format: validation, serialisation, encoding, fingerprinting.
// Run: npm test   (Node's built-in test runner; imports the app's TypeScript directly)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ANIMATION_PARAM_KEYS, OUTPUT_PARAM_KEYS, PARAM_SCHEMA, animationDuration, defaultParams } from '../src/config/params.ts';
import {
  PRESET_FORMAT,
  PRESET_VERSION,
  createPreset,
  decodePresetFromUrl,
  encodePresetForUrl,
  paramsFromPreset,
  presetFingerprint,
  sameAnimationParams,
  serializePreset,
  validatePreset,
} from '../src/config/preset.ts';

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const valid = () => JSON.parse(serializePreset(createPreset('test', defaultParams())));
const errorsOf = (raw) => {
  const v = validatePreset(raw);
  assert.equal(v.ok, false, 'expected validation to fail');
  return v.errors.join('\n');
};

test('presets/default.json is valid and identical to the Phase 3 schema defaults', () => {
  const v = validatePreset(readJson('../presets/default.json'));
  assert.ok(v.ok, v.ok ? '' : v.errors.join('\n'));
  assert.equal(v.preset.name, 'default');
  for (const k of ANIMATION_PARAM_KEYS) assert.equal(v.preset.params[k], defaultParams()[k], `default.${k}`);
  assert.equal(presetFingerprint(v.preset.params), presetFingerprint(defaultParams()));
  assert.equal(animationDuration(v.preset.params), animationDuration(defaultParams()));
  assert.ok(Math.abs(animationDuration(v.preset.params) - 8) < 1e-9, 'default timeline is 8 s');
});

test('presets/final.json is valid', () => {
  const v = validatePreset(readJson('../presets/final.json'));
  assert.ok(v.ok, v.ok ? '' : v.errors.join('\n'));
  assert.equal(v.preset.name, 'final');
});

test('presets contain exactly the animation parameters (output settings excluded)', () => {
  assert.deepEqual(OUTPUT_PARAM_KEYS, ['exportFps']);
  assert.equal(ANIMATION_PARAM_KEYS.length + OUTPUT_PARAM_KEYS.length, Object.keys(PARAM_SCHEMA).length);
  const preset = createPreset('x', defaultParams());
  assert.deepEqual(Object.keys(preset.params), ANIMATION_PARAM_KEYS);
  assert.ok(!('exportFps' in preset.params));
});

test('export → import round trip is lossless and stable', () => {
  const params = { ...defaultParams(), seed: 4242, tiltDeg: 47, sparkCount: 2500, durZoom: 1.65, aspect: '1:1', discOrange: 0.73 };
  const preset = createPreset('round-trip', params, 'desc', '2026-11-05T00:00:00.000Z');
  const text = serializePreset(preset);
  const v = validatePreset(JSON.parse(text));
  assert.ok(v.ok);
  assert.ok(sameAnimationParams(v.preset.params, params));
  assert.equal(serializePreset(v.preset), text, 'serialisation is canonical');
  assert.ok(text.endsWith('\n'));
  assert.equal(presetFingerprint(v.preset.params), presetFingerprint(params));
});

test('URL encoding round trip (base64url, UTF-8 safe)', () => {
  const preset = createPreset('url', { ...defaultParams(), seed: 7 }, 'Ünïcødé ✓ — description');
  const enc = encodePresetForUrl(preset);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const v = validatePreset(decodePresetFromUrl(enc));
  assert.ok(v.ok);
  assert.equal(v.preset.description, 'Ünïcødé ✓ — description');
  assert.ok(sameAnimationParams(v.preset.params, preset.params));
  assert.throws(() => decodePresetFromUrl('not base64!'), /base64url/);
  assert.throws(() => decodePresetFromUrl('bm90IGpzb24'), /not valid JSON/);
});

test('fingerprint changes with any animation parameter and ignores output settings', () => {
  const base = presetFingerprint(defaultParams());
  assert.match(base, /^[0-9a-f]{14}$/);
  assert.notEqual(presetFingerprint({ ...defaultParams(), glow: 0.51 }), base);
  assert.notEqual(presetFingerprint({ ...defaultParams(), aspect: '1:1' }), base);
  assert.equal(presetFingerprint({ ...defaultParams(), exportFps: 60 }), base);
});

test('paramsFromPreset keeps output settings separate', () => {
  const preset = createPreset('p', { ...defaultParams(), seed: 9 });
  assert.equal(paramsFromPreset(preset).exportFps, PARAM_SCHEMA.exportFps.default);
  assert.equal(paramsFromPreset(preset, { exportFps: 60 }).exportFps, 60);
  assert.equal(paramsFromPreset(preset).seed, 9);
});

test('rejects wrong format, bad and future versions', () => {
  assert.match(errorsOf({ ...valid(), format: 'other' }), /"format" must be/);
  assert.match(errorsOf({ ...valid(), version: 0 }), /positive integer/);
  assert.match(errorsOf({ ...valid(), version: '1' }), /positive integer/);
  assert.match(errorsOf({ ...valid(), version: PRESET_VERSION + 1 }), /newer than this app supports/);
  assert.match(errorsOf(null), /JSON object/);
  assert.match(errorsOf([1, 2]), /JSON object/);
});

test('rejects bad names, unknown keys and output-scope keys', () => {
  assert.match(errorsOf({ ...valid(), name: 'Bad Name' }), /"name" must match/);
  assert.match(errorsOf({ ...valid(), name: '../evil' }), /"name" must match/);
  assert.match(errorsOf({ ...valid(), extra: 1 }), /Unknown top-level key "extra"/);
  const p = valid();
  p.params.notAParam = 1;
  assert.match(errorsOf(p), /params.notAParam is not a known parameter/);
  const q = valid();
  q.params.exportFps = 60;
  assert.match(errorsOf(q), /exportFps is an output setting/);
});

test('rejects missing, mistyped, out-of-range, non-integer and invalid select values, reporting every error', () => {
  const p = valid();
  delete p.params.seed;
  p.params.tiltDeg = 999;
  p.params.glow = 'bright';
  p.params.revPulses = 2.5;
  p.params.sparkCount = Number.NaN;
  p.params.aspect = '21:9';
  const msg = errorsOf(p);
  assert.match(msg, /params.seed is missing/);
  assert.match(msg, /params.tiltDeg = 999 is outside 0…75/);
  assert.match(msg, /params.glow must be a finite number/);
  assert.match(msg, /params.revPulses must be a whole number/);
  assert.match(msg, /params.sparkCount must be a finite number/);
  assert.match(msg, /params.aspect must be one of/);
  assert.equal(validatePreset(p).errors.length, 6);
});

test('format constants', () => {
  assert.equal(PRESET_FORMAT, 'pie-firework-preset');
  assert.equal(PRESET_VERSION, 1);
});
