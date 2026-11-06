/**
 * Animation presets: a portable, versioned JSON description of every
 * parameter that affects the rendered animation.
 *
 * File format (presets/<name>.json):
 *   {
 *     "format": "pie-firework-preset",
 *     "version": 3,
 *     "name": "final",
 *     "description": "optional free text",
 *     "createdAt": "optional ISO timestamp",
 *     "params": { …every animation-scope parameter, no others… }
 *   }
 *
 * Validation is strict, because a preset is a reproducibility contract:
 * every animation parameter must be present, in range and of the right type;
 * unknown keys and output-scope keys (e.g. exportFps) are rejected. Older
 * versions are upgraded through `migrate`; newer versions are refused.
 *
 * Environment-neutral (no DOM, no Vite): imported by the app, the Vite dev
 * server and Node export tooling. The `.ts` import extension lets Node 24
 * load this file directly.
 */
import {
  ANIMATION_PARAM_KEYS,
  OUTPUT_PARAM_KEYS,
  PARAM_SCHEMA,
  defaultParams,
  type ParamDef,
  type ParamKey,
  type Params,
} from './params.ts';

export const PRESET_FORMAT = 'pie-firework-preset';
export const PRESET_VERSION = 3;

/**
 * Parameters introduced by each format version, with the values a preset from
 * the previous version is upgraded to (the schema defaults at that time).
 * v2: cel-shaded 3D spinner revision.
 */
const ADDED_IN_V2: Record<string, number> = {
  smearSteps: 3,
  thickness: 0.26,
  bevel: 0.06,
  preTiltDeg: 18,
  toonBands: 3,
  coilGrooves: 1,
  lightAngleDeg: 125,
  sparkLift: 0.9,
};

/** v3: chakri spark emission (nozzle on the rim, ignition → shower → fade). */
const ADDED_IN_V3: Record<string, number> = {
  igniteDur: 0.35,
  igniteSpread: 40,
  sparkCoverage: 330,
  igniteRate: 700,
  sparkWidth: 0.045,
  sparkTrail: 0.15,
  sparkWaver: 1,
  sparkFadeAt: 0.35,
};

/**
 * v3 spark parameters whose scale changed with the new emission model. They are
 * converted proportionally, so a v2 preset at the old default lands exactly on the
 * new default, and one tuned to e.g. 1.5× the old default gets 1.5× the new one.
 * `sparkCount` (total sparks) became `showerDensity` (sparks per second at peak).
 */
const RESCALED_IN_V3: { from: string; to: string; oldDefault: number; newDefault: number }[] = [
  { from: 'sparkCount', to: 'showerDensity', oldDefault: 1800, newDefault: 900 },
  { from: 'sparkSpeed', to: 'sparkSpeed', oldDefault: 2.3, newDefault: 5.5 },
  { from: 'sparkLife', to: 'sparkLife', oldDefault: 0.6, newDefault: 0.8 },
];

/** Proportional conversion, clamped to the new range and snapped to the parameter's step. */
function rescale(value: unknown, oldDefault: number, newDefault: number, key: string): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value; // left for validation to report
  const def = PARAM_SCHEMA[key as ParamKey] as ParamDef;
  if (def.kind !== 'number') return value;
  const scaled = Math.min(def.max, Math.max(def.min, (value * newDefault) / oldDefault));
  return Number((Math.round(scaled / def.step) * def.step).toFixed(6));
}
/** Lower-case file-system- and URL-safe names. */
export const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Presets that ship with the project and may not be overwritten by the save endpoint. */
export const PROTECTED_PRESETS = ['default'] as const;

type AnimationKey = Exclude<ParamKey, (typeof OUTPUT_PARAM_KEYS)[number]>;
export type AnimationParams = Pick<Params, AnimationKey>;

export interface Preset {
  format: typeof PRESET_FORMAT;
  version: typeof PRESET_VERSION;
  name: string;
  description?: string;
  createdAt?: string;
  params: AnimationParams;
}

export type PresetValidation = { ok: true; preset: Preset } | { ok: false; errors: string[] };

const TOP_LEVEL_KEYS = new Set(['format', 'version', 'name', 'description', 'createdAt', 'params']);

/**
 * Upgrade older preset versions to the current shape, one version at a time.
 * Note for v1 → v2: the renderer changed (cel-shaded 3D body), so a v1 preset
 * keeps its timing, motion, colours and particles but renders in the new style.
 * The original flat look is recoverable from git tag `phase3-complete`.
 * v2 → v3: the spark model changed. Timing (including `goldAt`, so ignition still
 * starts when that preset's disc turns gold), seed, lift and streaks are kept; the
 * new emission controls start at their defaults; rescaled keys are converted.
 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let out = raw;
  const paramsOf = (o: Record<string, unknown>) =>
    o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : null;
  if (out.version === 1) {
    const params = paramsOf(out);
    out = { ...out, version: 2, params: params ? { ...ADDED_IN_V2, ...params } : out.params };
  }
  if (out.version === 2) {
    const params = paramsOf(out);
    if (params) {
      const next: Record<string, unknown> = { ...ADDED_IN_V3, ...params };
      for (const { from, to, oldDefault, newDefault } of RESCALED_IN_V3) {
        if (!(from in params)) continue; // a missing key is reported by validation (as the new key)
        const value = params[from];
        delete next[from];
        next[to] = rescale(value, oldDefault, newDefault, to);
      }
      out = { ...out, version: 3, params: next };
    } else {
      out = { ...out, version: 3 };
    }
  }
  return out;
}

export function validatePreset(input: unknown): PresetValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Preset must be a JSON object.'] };
  }
  let raw = input as Record<string, unknown>;

  if (raw.format !== PRESET_FORMAT) {
    errors.push(`"format" must be "${PRESET_FORMAT}" (got ${JSON.stringify(raw.format)}).`);
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    errors.push(`"version" must be a positive integer (got ${JSON.stringify(raw.version)}).`);
  } else if (raw.version > PRESET_VERSION) {
    errors.push(`Preset version ${raw.version} is newer than this app supports (${PRESET_VERSION}). Update the app.`);
  }
  if (errors.length) return { ok: false, errors };
  raw = migrate(raw);

  for (const k of Object.keys(raw)) if (!TOP_LEVEL_KEYS.has(k)) errors.push(`Unknown top-level key "${k}".`);
  if (typeof raw.name !== 'string' || !PRESET_NAME_PATTERN.test(raw.name)) {
    errors.push(`"name" must match ${PRESET_NAME_PATTERN} (lower-case letters, digits, "-" or "_"); got ${JSON.stringify(raw.name)}.`);
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') errors.push('"description" must be a string.');
  if (raw.createdAt !== undefined && typeof raw.createdAt !== 'string') errors.push('"createdAt" must be a string.');

  const params = raw.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    errors.push('"params" must be an object.');
    return { ok: false, errors };
  }
  const p = params as Record<string, unknown>;
  const animationKeys = new Set<string>(ANIMATION_PARAM_KEYS);
  const outputKeys = new Set<string>(OUTPUT_PARAM_KEYS);
  for (const k of Object.keys(p)) {
    if (outputKeys.has(k)) errors.push(`params.${k} is an output setting, not an animation parameter; remove it from the preset.`);
    else if (!animationKeys.has(k)) errors.push(`params.${k} is not a known parameter.`);
  }
  for (const k of ANIMATION_PARAM_KEYS) {
    const def = PARAM_SCHEMA[k] as ParamDef;
    const v = p[k];
    if (v === undefined) {
      errors.push(`params.${k} is missing.`);
    } else if (def.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`params.${k} must be a finite number (got ${JSON.stringify(v)}).`);
      else if (v < def.min || v > def.max) errors.push(`params.${k} = ${v} is outside ${def.min}…${def.max}.`);
      else if (Number.isInteger(def.step) && !Number.isInteger(v)) errors.push(`params.${k} must be a whole number (got ${v}).`);
    } else if (typeof v !== 'string' || !def.options.includes(v)) {
      errors.push(`params.${k} must be one of ${def.options.map((o) => JSON.stringify(o)).join(', ')} (got ${JSON.stringify(v)}).`);
    }
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    preset: {
      format: PRESET_FORMAT,
      version: PRESET_VERSION,
      name: raw.name as string,
      ...(raw.description !== undefined ? { description: raw.description as string } : {}),
      ...(raw.createdAt !== undefined ? { createdAt: raw.createdAt as string } : {}),
      params: pickAnimationParams(p as Params),
    },
  };
}

/** The animation-scope subset of a full parameter set, in schema order. */
export function pickAnimationParams(params: Params): AnimationParams {
  const out: Record<string, number | string> = {};
  for (const k of ANIMATION_PARAM_KEYS) out[k] = params[k];
  return out as AnimationParams;
}

/** Full runtime params: preset animation values plus output settings (from `output` or defaults). */
export function paramsFromPreset(preset: Preset, output?: Partial<Params>): Params {
  const base = defaultParams() as Record<string, number | string>;
  for (const k of OUTPUT_PARAM_KEYS) if (output?.[k] !== undefined) base[k] = output[k] as number | string;
  return { ...(base as Params), ...preset.params };
}

export function createPreset(name: string, params: Params | AnimationParams, description?: string, createdAt?: string): Preset {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    name,
    ...(description ? { description } : {}),
    ...(createdAt ? { createdAt } : {}),
    params: pickAnimationParams(params as Params),
  };
}

/** Stable, human-diffable JSON (fixed key order, 2-space indent, trailing newline). */
export function serializePreset(preset: Preset): string {
  const ordered = {
    format: preset.format,
    version: preset.version,
    name: preset.name,
    ...(preset.description !== undefined ? { description: preset.description } : {}),
    ...(preset.createdAt !== undefined ? { createdAt: preset.createdAt } : {}),
    params: pickAnimationParams(preset.params as Params),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function sameAnimationParams(a: Params | AnimationParams, b: Params | AnimationParams): boolean {
  return ANIMATION_PARAM_KEYS.every((k) => (a as Params)[k] === (b as Params)[k]);
}

/**
 * Short, stable identity of the rendered configuration (animation params
 * only, schema order). Identical in browser and Node; used to pin a preset
 * (`&fp=`) and to prove that preview and export use the same configuration.
 */
export function presetFingerprint(params: Params | AnimationParams): string {
  const canonical = JSON.stringify(ANIMATION_PARAM_KEYS.map((k) => [k, (params as Params)[k]]));
  // cyrb53: fast 53-bit string hash.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ── URL encoding (inline presets in `#preset=…`) ─────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (no padding) of the compact preset JSON. */
export function encodePresetForUrl(preset: Preset): string {
  const bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(serializePreset(preset))));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

/** Inverse of encodePresetForUrl. Throws on malformed input; validate the result separately. */
export function decodePresetFromUrl(encoded: string): unknown {
  const clean = encoded.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(clean) || clean.length % 4 === 1) throw new Error('Inline preset is not valid base64url.');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((j) => (i + j < clean.length ? B64.indexOf(clean[i + j]) : 0));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    bytes.push((n >> 16) & 255);
    if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (i + 3 < clean.length) bytes.push(n & 255);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Inline preset is not valid JSON.');
  }
}
