/**
 * Tunable parameters. The schema drives the debug panel automatically.
 *
 * `wiredIn` records which build phase connects a parameter to the visuals, so
 * the panel can mark controls that exist but have no effect yet.
 */

export type BuildPhase = 1 | 2 | 3 | 4;

interface BaseDef {
  label: string;
  group: ParamGroup;
  wiredIn: BuildPhase;
  hint?: string;
}

export interface NumberDef extends BaseDef {
  kind: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface SelectDef extends BaseDef {
  kind: 'select';
  default: string;
  options: readonly string[];
}

export type ParamDef = NumberDef | SelectDef;

export const PARAM_GROUPS = [
  'Timing',
  'Wipe',
  'Overshoot & recoil',
  'Spin',
  'Motion blur',
  'Colour',
  'Firework',
  'Camera',
  'Output',
] as const;
export type ParamGroup = (typeof PARAM_GROUPS)[number];

const num = (
  group: ParamGroup,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  wiredIn: BuildPhase,
  unit?: string,
  hint?: string,
): NumberDef => ({ kind: 'number', group, label, default: def, min, max, step, wiredIn, unit, hint });

export const PARAM_SCHEMA = {
  // ── Timing: one duration per animation phase (sum ≈ total length) ──────────
  durIntro: num('Timing', 'Intro (empty blue)', 0.4, 0, 2, 0.05, 1, 's'),
  durReveal: num('Timing', 'Radial wipe reveal', 1.2, 0.2, 3, 0.05, 1, 's'),
  durSettle: num('Timing', 'Overshoot + recoil', 0.45, 0.1, 2, 0.05, 1, 's'),
  durSpinUp: num('Timing', 'Rev + spin-up', 1.95, 0.3, 4, 0.05, 1, 's'),
  durBlur: num('Timing', 'Blur to disc', 0.8, 0.1, 3, 0.05, 1, 's'),
  durFirework: num('Timing', 'Ground spinner', 1.4, 0.2, 4, 0.05, 1, 's'),
  durZoom: num('Timing', 'Expand, tilt, close-in', 1.4, 0.2, 4, 0.05, 1, 's'),
  durHold: num('Timing', 'Hold on yellow', 0.4, 0, 2, 0.05, 1, 's'),

  // ── Wipe: speed of the leading edge, as multiples of the average speed ─────
  wipeStartSpeed: num('Wipe', 'Start speed', 0.3, 0, 3, 0.05, 2, '×', 'Leading-edge speed at 3 o’clock (× average)'),
  wipeFinishSpeed: num('Wipe', 'Finish speed', 1.6, 0.5, 3, 0.05, 2, '×', 'Speed when the wipe closes; carries into the overshoot'),

  // ── Overshoot & recoil ─────────────────────────────────────────────────────
  overshootDeg: num('Overshoot & recoil', 'Overshoot', 22, 1, 60, 0.5, 2, '°', 'Clockwise rotation past completion, driven by wipe momentum'),
  overshootSharpness: num('Overshoot & recoil', 'Overshoot sharpness', 0.5, 0, 1, 0.01, 2, '', '0 = soft ease-out, 1 = hard brake'),
  recoilDeg: num('Overshoot & recoil', 'Recoil', 6, 0, 30, 0.5, 2, '°', 'How far it swings anticlockwise past the original orientation'),

  // ── Spin ───────────────────────────────────────────────────────────────────
  revPulses: num('Spin', 'Rev pulses', 2, 0, 5, 1, 2, '', 'Clockwise jabs before launch (0 = launch straight from recoil)'),
  revAmplitudeDeg: num('Spin', 'Rev amplitude', 10, 0, 40, 0.5, 2, '°'),
  windUpDeg: num('Spin', 'Wind-up depth', 10, 0, 45, 0.5, 2, '°', 'Extra anticlockwise pull-back across the revs (needs ≥1 rev pulse)'),
  revShare: num('Spin', 'Rev time share', 0.45, 0.1, 0.8, 0.01, 2, '', 'Fraction of the spin-up phase spent revving'),
  spinMaxSpeed: num('Spin', 'Max speed', 6, 0.5, 20, 0.1, 2, 'rev/s'),
  spinAccelPower: num('Spin', 'Acceleration curve', 2.6, 1.2, 6, 0.1, 2, '', 'Higher = slower start, harder kick'),

  // ── Motion blur (analytic angular blur in the pie shader) ────────────────
  blurStrength: num('Motion blur', 'Blur strength', 1, 0, 3, 0.01, 3, '×', 'Physical shutter = strength × 1/30 s of rotation'),
  blurStartSpeed: num('Motion blur', 'Blur onset speed', 1.5, 0, 10, 0.1, 3, 'rev/s', 'Physical blur ramps in from ½× this speed and is full at this speed (spin-up onward)'),
  blurSmoothAt: num('Motion blur', 'Fully smooth at', 0.7, 0.2, 1, 0.01, 3, '', 'Fraction of the blur phase at which the sectors have fully merged'),

  // ── Colour transformation ─────────────────────────────────────────────────
  discOrange: num('Colour', 'Disc orange amount', 0.6, 0, 1, 0.01, 3, '', 'Light-orange disc = white mixed with this much orange'),
  colourLead: num('Colour', 'Colour shift start', 0.2, 0, 0.9, 0.01, 3, '', 'Fraction of the blur phase before sectors start tinting'),
  goldAt: num('Colour', 'Gold reached at', 0.55, 0.1, 1, 0.01, 3, '', 'Fraction of the spinner phase at which the disc is fully #ffde59'),

  // ── Firework (deterministic, seeded) ──────────────────────────────────────
  seed: num('Firework', 'Random seed', 1337, 1, 99999, 1, 3),
  sparkCount: num('Firework', 'Spark density', 1800, 0, 6000, 10, 3, '', 'Total sparks emitted over the firework'),
  sparkSpeed: num('Firework', 'Spark speed', 2.3, 0.3, 6, 0.05, 3, 'R/s', 'Launch speed in pie radii per second'),
  sparkLife: num('Firework', 'Spark life', 0.6, 0.15, 1.5, 0.01, 3, 's'),
  streakCount: num('Firework', 'Orbiting streaks', 56, 0, 300, 1, 3),
  vibration: num('Firework', 'Vibration', 1, 0, 3, 0.01, 3, '×', 'Positional jitter and rotational instability'),
  wobble: num('Firework', 'Perimeter instability', 1, 0, 3, 0.01, 3, '×'),
  energy: num('Firework', 'Rim energy', 1, 0, 2, 0.01, 3, '×', 'Clockwise light streaks across the disc'),
  glow: num('Firework', 'Glow', 0.5, 0, 1.5, 0.01, 3, '×'),

  // ── Camera & expansion ────────────────────────────────────────────────────
  fov: num('Camera', 'Field of view', 30, 15, 70, 1, 1, '°', 'Framing is preserved at any FOV'),
  tiltDeg: num('Camera', 'Disc tilt', 58, 0, 75, 1, 3, '°', 'Top edge tilts away from the camera'),
  tiltAxisDeg: num('Camera', 'Tilt axis', -18, -60, 60, 1, 3, '°', '0 = pure X-axis tilt; ± adds Y-axis tilt'),
  closeIn: num('Camera', 'Camera close-in', 0.55, 0, 0.9, 0.01, 3, '', 'Fraction of the camera distance travelled toward the disc'),
  fillAt: num('Camera', 'Frame filled at', 0.9, 0.6, 0.98, 0.01, 3, '', 'Fraction of the expand phase at which yellow covers every corner (solved exactly)'),
  expandCurve: num('Camera', 'Expansion curve', 2.2, 1, 5, 0.1, 3, '', 'Higher = slower start, faster engulf'),

  // ── Output ─────────────────────────────────────────────────────────────────
  aspect: {
    kind: 'select',
    group: 'Output',
    label: 'Aspect ratio',
    default: '16:9',
    options: ['16:9', '1:1', '4:5', '9:16'],
    wiredIn: 1,
  } satisfies SelectDef,
  exportFps: num('Output', 'Export FPS', 30, 12, 60, 1, 1, 'fps', 'Also the frame-step size'),
} as const satisfies Record<string, ParamDef>;

export type ParamKey = keyof typeof PARAM_SCHEMA;
export type Params = {
  [K in ParamKey]: (typeof PARAM_SCHEMA)[K] extends SelectDef ? string : number;
};

export function defaultParams(): Params {
  const out: Record<string, number | string> = {};
  for (const [k, def] of Object.entries(PARAM_SCHEMA)) out[k] = def.default;
  return out as Params;
}

export function aspectRatio(p: Params): number {
  const [w, h] = p.aspect.split(':').map(Number);
  return w / h;
}

/** Load persisted params, ignoring unknown keys and clamping out-of-range values. */
export function sanitizeParams(raw: unknown): Params {
  const base = defaultParams();
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Record<string, unknown>;
  const out = base as Record<string, number | string>;
  for (const [k, def] of Object.entries(PARAM_SCHEMA) as [string, ParamDef][]) {
    const v = rec[k];
    if (def.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.min(def.max, Math.max(def.min, v));
    } else if (def.kind === 'select' && typeof v === 'string' && def.options.includes(v)) {
      out[k] = v;
    }
  }
  return base;
}
