/**
 * Export configuration for Phase 4 (configuration only: no rendering here).
 *
 * Turns CLI options into a fully validated ExportPlan:
 *   - which preset (animation parameters), loaded from disk, never localStorage
 *   - which output (resolution, fps, formats, renderer, time range, directory)
 *   - the exact player URL the exporter must load, pinned by fingerprint so the
 *     page refuses to render anything but this configuration
 *   - the frame schedule (frame i is sampled at t = from + i / fps)
 *
 * Animation parameters come only from the preset; output options come only
 * from the CLI. A requested preset that is missing or invalid throws
 * ExportConfigError; there is no fallback to defaults.
 *
 * Uses the app's own TypeScript modules (Node ≥ 22.18 / 24 strips types), so
 * validation and the duration calculation are the same code the browser runs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspectRatio, animationDuration } from '../../src/config/params.ts';
import { PRESET_NAME_PATTERN, encodePresetForUrl, presetFingerprint, validatePreset } from '../../src/config/preset.ts';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRESET_DIR = resolve(PROJECT_ROOT, 'presets');
export const OUTPUT_FORMATS = ['png', 'mp4', 'gif'];
export const RENDERERS = ['swiftshader', 'gpu'];
const ASPECT_TOLERANCE = 0.002; // relative
const MAX_DIMENSION = 7680;

export class ExportConfigError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ExportConfigError';
    this.details = details;
  }
}

/** Presets available in presets/ (by file name). */
export function listPresets(dir = PRESET_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/**
 * Load and strictly validate a preset by repository name (presets/<name>.json)
 * or by file path. Exactly one of `name` / `file` must be given.
 */
export function loadPreset({ name, file, presetDir = PRESET_DIR } = {}) {
  if (name && file) throw new ExportConfigError('Give either --preset <name> or --preset-file <path>, not both.');
  if (!name && !file) {
    throw new ExportConfigError('No preset selected. Export needs an explicit --preset <name> or --preset-file <path>.', [
      `Available presets: ${listPresets(presetDir).join(', ') || '(none)'}`,
    ]);
  }
  let path;
  if (name) {
    if (!PRESET_NAME_PATTERN.test(name)) throw new ExportConfigError(`"${name}" is not a valid preset name.`);
    path = resolve(presetDir, `${name}.json`);
    if (!existsSync(path)) {
      throw new ExportConfigError(`Preset "${name}" not found (looked for presets/${name}.json).`, [
        `Available presets: ${listPresets(presetDir).join(', ') || '(none)'}`,
      ]);
    }
  } else {
    path = resolve(file);
    if (!existsSync(path)) throw new ExportConfigError(`Preset file not found: ${path}`);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ExportConfigError(`Preset ${path} is not valid JSON.`, [e.message]);
  }
  const v = validatePreset(json);
  if (!v.ok) throw new ExportConfigError(`Preset ${path} is invalid.`, v.errors);
  if (name && v.preset.name !== name) {
    throw new ExportConfigError(`presets/${name}.json declares "name": "${v.preset.name}"; the file name and name must match.`);
  }
  return { preset: v.preset, path, bundled: Boolean(name), fingerprint: presetFingerprint(v.preset.params) };
}

/** Minimal `--key value` / `--flag` parser. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new ExportConfigError(`Unexpected argument "${a}".`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const KNOWN_OPTIONS = new Set(['preset', 'preset-file', 'width', 'height', 'fps', 'format', 'renderer', 'from', 'to', 'out', 'json']);

function intOption(opts, key, fallback, min, max) {
  if (opts[key] === undefined) return fallback;
  const n = Number(opts[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw new ExportConfigError(`--${key} must be a whole number between ${min} and ${max} (got "${opts[key]}").`);
  return n;
}

function secondsOption(opts, key, fallback) {
  if (opts[key] === undefined) return fallback;
  const n = Number(opts[key]);
  if (!Number.isFinite(n)) throw new ExportConfigError(`--${key} must be a number of seconds (got "${opts[key]}").`);
  return n;
}

/**
 * Build the ExportPlan Phase 4 will execute.
 * @param {Record<string, string|boolean>} opts parsed CLI options
 */
export function resolveExportConfig(opts, { presetDir = PRESET_DIR } = {}) {
  for (const k of Object.keys(opts)) if (!KNOWN_OPTIONS.has(k)) throw new ExportConfigError(`Unknown option --${k}.`, [`Known: ${[...KNOWN_OPTIONS].map((o) => `--${o}`).join(' ')}`]);

  const loaded = loadPreset({
    name: typeof opts.preset === 'string' ? opts.preset : opts.preset === true ? '' : undefined,
    file: typeof opts['preset-file'] === 'string' ? opts['preset-file'] : undefined,
    presetDir,
  });
  const { preset } = loaded;
  const ar = aspectRatio(preset.params);
  const duration = animationDuration(preset.params);

  // Output: defaults to a 1080-px short side at the preset's aspect ratio.
  const defaultHeight = ar >= 1 ? 1080 : Math.round(1080 / ar);
  const defaultWidth = ar >= 1 ? Math.round(1080 * ar) : 1080;
  const width = intOption(opts, 'width', defaultWidth, 16, MAX_DIMENSION);
  const height = intOption(opts, 'height', defaultHeight, 16, MAX_DIMENSION);
  const fps = intOption(opts, 'fps', 30, 1, 120);
  const formats = String(opts.format ?? 'png').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);
  const badFormats = formats.filter((f) => !OUTPUT_FORMATS.includes(f));
  if (!formats.length || badFormats.length) throw new ExportConfigError(`--format must be a comma list of ${OUTPUT_FORMATS.join(', ')} (got "${opts.format}").`);
  const renderer = String(opts.renderer ?? 'swiftshader');
  if (!RENDERERS.includes(renderer)) throw new ExportConfigError(`--renderer must be one of ${RENDERERS.join(', ')} (got "${renderer}").`);
  if (formats.includes('mp4') && (width % 2 || height % 2)) throw new ExportConfigError(`MP4 needs even dimensions (got ${width}x${height}).`);

  const outAr = width / height;
  if (Math.abs(outAr - ar) / ar > ASPECT_TOLERANCE) {
    throw new ExportConfigError(
      `Resolution ${width}x${height} (${outAr.toFixed(4)}:1) does not match the preset's aspect ratio ${preset.params.aspect}.`,
      ['Aspect ratio is part of the animation (it shapes the expansion and framing). Use a matching resolution or a preset with a different aspect.'],
    );
  }

  const from = secondsOption(opts, 'from', 0);
  const to = secondsOption(opts, 'to', duration);
  if (from < 0 || to > duration + 1e-9 || from >= to) {
    throw new ExportConfigError(`--from/--to must satisfy 0 ≤ from < to ≤ ${duration} (got ${from}…${to}).`);
  }
  const frameCount = Math.round((to - from) * fps);
  if (frameCount < 1) throw new ExportConfigError('The requested range contains no frames.');

  // The exporter loads the standalone player with exactly this configuration.
  // `fp` makes the page refuse to render anything else (e.g. a stale build).
  const query = new URLSearchParams({ debug: '0', autoplay: '0' });
  if (loaded.bundled) query.set('preset', preset.name);
  query.set('fp', loaded.fingerprint);
  const pageUrl = `/?${query.toString()}${loaded.bundled ? '' : `#preset=${encodePresetForUrl(preset)}`}`;

  const outDir = typeof opts.out === 'string' ? resolve(opts.out) : resolve(PROJECT_ROOT, 'export', `${preset.name}-${width}x${height}-${fps}fps`);

  return {
    preset: {
      name: preset.name,
      path: loaded.path,
      source: loaded.bundled ? 'repository' : 'file',
      version: preset.version,
      fingerprint: loaded.fingerprint,
      description: preset.description ?? null,
    },
    output: { width, height, fps, formats, renderer, outDir },
    timeline: {
      duration,
      from,
      to,
      frameCount,
      firstFrameTime: from,
      lastFrameTime: from + (frameCount - 1) / fps,
      sampling: 'frame i is rendered at t = from + i / fps (frame-start sampling; video length = frameCount / fps)',
    },
    page: { url: pageUrl, viewport: { width, height }, deviceScaleFactor: 1 },
  };
}

/** Frame timestamps for a plan (kept out of the JSON plan to keep it small). */
export function frameTimes(plan) {
  const { from, frameCount } = plan.timeline;
  return Array.from({ length: frameCount }, (_, i) => from + i / plan.output.fps);
}

