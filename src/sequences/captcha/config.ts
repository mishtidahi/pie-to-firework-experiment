/**
 * "Select Joy" CAPTCHA sequence: configuration schema, validation and
 * fingerprint. Deliberately separate from the spinner's preset format
 * (config/preset.ts) and self-contained (no imports), so the Node export
 * script can load it directly.
 *
 * Preset files live in presets/captcha/<name>.json:
 *   { "format": "captcha-preset", "version": 1, "name": "...", "description": "...", "params": { ... } }
 */

export const CAPTCHA_PRESET_FORMAT = 'captcha-preset';
export const CAPTCHA_PRESET_VERSION = 1;
export const DEFAULT_CAPTCHA_PRESET = 'captcha-4s-portrait';

interface NumberKey {
  label: string;
  default: number;
  min: number;
  max: number;
  integer?: boolean;
}

/** Every animation parameter of the sequence (times in seconds from the start). */
export const CAPTCHA_PARAM_DEFS = {
  duration: { label: 'Total duration', default: 4, min: 1, max: 20 },
  entranceEnd: { label: 'Panel settled', default: 0.45, min: 0.1, max: 2 },
  selectStart: { label: 'First tile selected', default: 0.5, min: 0, max: 5 },
  selectEnd: { label: 'Last tile selected', default: 1.26, min: 0, max: 10 },
  verifyAt: { label: 'VERIFY pressed', default: 1.4, min: 0, max: 10 },
  launchAt: { label: 'Rocket ignites (below the frame)', default: 1.45, min: 0, max: 10 },
  burstAt: { label: 'Rocket bursts', default: 2.5, min: 0, max: 15 },
  fillAt: { label: 'Yellow fills the frame', default: 3.78, min: 0, max: 19 },
  burstY: { label: 'Burst height (design px from the top, 1080-wide frame)', default: 760, min: 200, max: 1500 },
  sparkCount: { label: 'Burst sparks', default: 90, min: 0, max: 400, integer: true },
  seed: { label: 'Random seed', default: 2024, min: 1, max: 99999, integer: true },
} satisfies Record<string, NumberKey>;

export type CaptchaParamKey = keyof typeof CAPTCHA_PARAM_DEFS;
/** The sequence is composed natively for portrait; 9:16 is the only supported format. */
export type CaptchaParams = Record<CaptchaParamKey, number> & { aspect: '9:16' };
export const CAPTCHA_ASPECTS = ['9:16'] as const;
const KEYS = Object.keys(CAPTCHA_PARAM_DEFS) as CaptchaParamKey[];

export interface CaptchaPreset {
  format: typeof CAPTCHA_PRESET_FORMAT;
  version: number;
  name: string;
  description?: string;
  params: CaptchaParams;
}

export function defaultCaptchaParams(): CaptchaParams {
  const p = Object.fromEntries(KEYS.map((k) => [k, CAPTCHA_PARAM_DEFS[k].default])) as Record<CaptchaParamKey, number>;
  return { ...p, aspect: '9:16' };
}

export type CaptchaValidation = { ok: true; preset: CaptchaPreset } | { ok: false; errors: string[] };

/** Strict validation: unknown, missing or out-of-range keys and out-of-order beats are errors. */
export function validateCaptchaPreset(input: unknown): CaptchaValidation {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['A CAPTCHA preset must be a JSON object.'] };
  const raw = input as Record<string, unknown>;
  if (raw.format !== CAPTCHA_PRESET_FORMAT) errors.push(`"format" must be "${CAPTCHA_PRESET_FORMAT}".`);
  if (raw.version !== CAPTCHA_PRESET_VERSION) errors.push(`"version" must be ${CAPTCHA_PRESET_VERSION}.`);
  if (typeof raw.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(raw.name)) errors.push('"name" must be lower-case letters, digits and dashes.');
  for (const k of Object.keys(raw)) if (!['format', 'version', 'name', 'description', 'params'].includes(k)) errors.push(`Unknown top-level key "${k}".`);
  const params = raw.params as Record<string, unknown> | undefined;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, errors: [...errors, '"params" must be an object.'] };
  for (const k of Object.keys(params)) if (k !== 'aspect' && !(k in CAPTCHA_PARAM_DEFS)) errors.push(`Unknown parameter "${k}".`);
  if (!CAPTCHA_ASPECTS.includes(params.aspect as never)) errors.push(`params.aspect must be one of ${CAPTCHA_ASPECTS.join(', ')}.`);
  for (const k of KEYS) {
    const d: NumberKey = CAPTCHA_PARAM_DEFS[k];
    const v = params[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`params.${k} is missing or not a number.`);
    else if (v < d.min || v > d.max) errors.push(`params.${k} = ${v} is outside ${d.min}…${d.max}.`);
    else if (d.integer && !Number.isInteger(v)) errors.push(`params.${k} must be a whole number.`);
  }
  if (!errors.length) {
    const p = params as CaptchaParams;
    const order: CaptchaParamKey[] = ['entranceEnd', 'selectEnd', 'verifyAt', 'launchAt', 'burstAt', 'fillAt', 'duration'];
    for (let i = 1; i < order.length; i++) {
      if (p[order[i]] <= p[order[i - 1]]) errors.push(`params.${order[i]} must come after params.${order[i - 1]}.`);
    }
    if (p.selectStart >= p.selectEnd) errors.push('params.selectStart must come before params.selectEnd.');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, preset: raw as unknown as CaptchaPreset };
}

/** Stable short hash of the animation parameters (cyrb53), used to pin exports. */
export function captchaFingerprint(params: CaptchaParams): string {
  const canonical = JSON.stringify([...KEYS.map((k) => [k, params[k]]), ['aspect', params.aspect]]);
  let h1 = 0xdeadbeef ^ 0x5eed;
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

export function captchaAspectRatio(params: CaptchaParams): number {
  const [w, h] = params.aspect.split(':').map(Number);
  return w / h;
}
