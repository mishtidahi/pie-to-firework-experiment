/**
 * Tunable parameters. The schema drives the debug panel automatically.
 *
 * `wiredIn` records which build phase connects a parameter to the visuals, so
 * the panel can mark controls that exist but have no effect yet.
 *
 * `scope` separates what is rendered from how it is delivered:
 *  - 'animation' (default): affects the rendered frames; saved in presets.
 *  - 'output': delivery/workbench settings (e.g. frame-step fps); never part of
 *    a preset. Export resolution, fps and format are CLI options (see README).
 *
 * This module is environment-neutral (no DOM, no Vite APIs) so Node-based
 * export tooling can import it directly.
 */

export type BuildPhase = 1 | 2 | 3 | 4;

interface BaseDef {
  label: string;
  group: ParamGroup;
  wiredIn: BuildPhase;
  hint?: string;
  scope?: 'animation' | 'output';
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
  'Body & shading',
  'Firework',
  'Sparks',
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
  blurSmoothAt: num('Motion blur', 'Sectors merged at', 0.45, 0.2, 1, 0.01, 3, '', 'Fraction of the blur phase at which the pie sectors have morphed into concentric coil bands (front-loaded)'),
  smearSteps: num('Motion blur', 'Smear tone steps', 3, 2, 6, 1, 3, '', 'From the blur phase on, the motion smear is posterised into this many hard-edged tones (cel style, no soft blur)'),

  // ── Colour transformation ─────────────────────────────────────────────────
  discOrange: num('Colour', 'Disc orange amount', 0.6, 0, 1, 0.01, 3, '', 'Light-orange disc = white mixed with this much orange'),
  colourLead: num('Colour', 'Colour shift start', 0.2, 0, 0.9, 0.01, 3, '', 'Fraction of the blur phase before sectors start tinting'),
  goldAt: num('Colour', 'Gold reached at', 0.215, 0.1, 1, 0.005, 3, '', 'Fraction of the spinner phase at which the disc is fully #ffde59. The spark sequence ignites at this moment'),

  // ── Body & cel shading (3D spinner form) ──────────────────────────────────
  thickness: num('Body & shading', 'Body thickness', 0.26, 0, 0.6, 0.01, 3, 'R', 'Spinner depth in pie radii; the body grows during the blur phase'),
  bevel: num('Body & shading', 'Bevel width', 0.06, 0, 0.15, 0.005, 3, 'R', 'Real 45° chamfer on the top and bottom edges of the body (outward from the pie edge)'),
  preTiltDeg: num('Body & shading', 'Ignition tilt', 18, 0, 30, 0.5, 3, '°', 'Gentle tilt during the blur and spinner phases so the thickness reads before the big tilt'),
  toonBands: num('Body & shading', 'Tone bands', 3, 2, 4, 1, 3, '', 'Hard light/shadow bands in the cel shading'),
  coilGrooves: num('Body & shading', 'Coil grooves', 1, 0, 1, 0.01, 3, '', 'Groove lines and alternating tones on the coil bands; the bands keep the pie sectors’ proportions'),
  lightAngleDeg: num('Body & shading', 'Key light angle', 125, 0, 360, 1, 3, '°', 'Direction of the key light in the screen plane (90 = from above, 180 = from the left)'),

  // ── Firework (deterministic, seeded) ──────────────────────────────────────
  seed: num('Firework', 'Random seed', 1337, 1, 99999, 1, 3),
  vibration: num('Firework', 'Vibration', 1, 0, 3, 0.01, 3, '×', 'Positional jitter and rotational instability'),
  wobble: num('Firework', 'Perimeter instability', 1, 0, 3, 0.01, 3, '×'),
  // Redefined in the cel-shaded revision (were "Rim energy" streaks and soft "Glow"):
  energy: num('Firework', 'Spin accents', 1, 0, 2, 0.01, 3, '×', 'Hard-edged highlight arcs on the bevel and stripes on the side wall, sweeping clockwise'),
  glow: num('Firework', 'Rim heat flashes', 0.5, 0, 1.5, 0.01, 3, '×', 'Intermittent hard-edged hot accents on the emitting part of the rim (no soft glow)'),

  // ── Sparks: chakri emission from a nozzle riding the rim (deterministic, seeded) ──
  // Sequence: ignition when the disc is fully gold → concentrated emission → expanding
  // shower, full when the tilt begins → fade as the frame fills (src/effects/emission.ts).
  igniteDur: num('Sparks', 'Ignition length', 0.35, 0.05, 1, 0.01, 3, 's', 'Concentrated single-source emission after the spinner turns yellow; the shower then expands until the tilt begins'),
  igniteSpread: num('Sparks', 'Ignition spread', 40, 5, 180, 1, 3, '°', 'Width of the emitting rim region at ignition (it rotates with the body, trailing the nozzle)'),
  sparkCoverage: num('Sparks', 'Max angular coverage', 330, 30, 360, 1, 3, '°', 'Width of the emitting rim region in the full shower'),
  igniteRate: num('Sparks', 'Emission rate', 700, 0, 2000, 10, 3, '/s', 'Sparks per second during the concentrated ignition'),
  showerDensity: num('Sparks', 'Peak shower density', 900, 0, 5000, 10, 3, '/s', 'Sparks per second in the full shower'),
  sparkWidth: num('Sparks', 'Spark thickness', 0.045, 0.005, 0.08, 0.001, 3, 'R', 'Stroke width at its belly in pie radii; 0.045 ≈ the inner ring pair just outside the centre circle (two groove rings and the band between them)'),
  sparkSpeed: num('Sparks', 'Particle speed', 5.5, 0.5, 12, 0.05, 3, 'R/s', 'Mean launch speed in the full shower (ignition sparks leave at about half this)'),
  sparkLife: num('Sparks', 'Spark life', 0.8, 0.15, 2, 0.01, 3, 's', 'Mean life in the full shower (ignition sparks are short-lived)'),
  sparkTrail: num('Sparks', 'Trail length', 0.15, 0.03, 0.8, 0.01, 3, 's', 'Each strand is the last this-many seconds of its trajectory (persistence); at least 2 frames at 30 fps'),
  sparkWaver: num('Sparks', 'Trajectory irregularity', 1, 0, 2.5, 0.01, 3, '×', 'Bend, sway, spread and speed variation of the trajectories (0 = straight, regular)'),
  sparkLift: num('Sparks', 'Spark lift', 0.9, 0, 3, 0.05, 3, 'R/s', 'Upward launch speed: sparks arc up off the spinner in 3D'),
  sparkFadeAt: num('Sparks', 'Spark fade start', 0.35, 0.05, 0.85, 0.01, 3, '', 'Fraction of the expand phase at which emission and spark visibility start fading; all gone when the frame fills'),
  streakCount: num('Sparks', 'Orbiting streaks', 32, 0, 300, 1, 3, '', 'Short streaks swirling around the rim, born in the emitting region'),

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
  exportFps: {
    ...num('Output', 'Frame-step FPS', 30, 12, 60, 1, 1, 'fps', 'Workbench frame-step and frame counter only. Not part of presets; export picks its own fps.'),
    scope: 'output',
  },
} as const satisfies Record<string, ParamDef>;

export type ParamKey = keyof typeof PARAM_SCHEMA;
export type Params = {
  [K in ParamKey]: (typeof PARAM_SCHEMA)[K] extends SelectDef ? string : number;
};

/** Keys that affect the rendered animation (preset contents), in schema order. */
export const ANIMATION_PARAM_KEYS = (Object.keys(PARAM_SCHEMA) as ParamKey[]).filter(
  (k) => (PARAM_SCHEMA[k] as ParamDef).scope !== 'output',
);
/** Delivery / workbench-only keys, never stored in presets. */
export const OUTPUT_PARAM_KEYS = (Object.keys(PARAM_SCHEMA) as ParamKey[]).filter(
  (k) => (PARAM_SCHEMA[k] as ParamDef).scope === 'output',
);

/**
 * Phase duration keys in playback order. Must match the order of PHASES in
 * src/phases/index.ts (verified by scripts/verify-presets.mjs, which compares
 * animationDuration() with the engine's timeline duration).
 */
export const PHASE_DURATION_KEYS = [
  'durIntro',
  'durReveal',
  'durSettle',
  'durSpinUp',
  'durBlur',
  'durFirework',
  'durZoom',
  'durHold',
] as const satisfies readonly ParamKey[];

/** Total timeline length, summed in the same order the master timeline uses. */
export function animationDuration(p: Pick<Params, (typeof PHASE_DURATION_KEYS)[number]>): number {
  let t = 0;
  for (const k of PHASE_DURATION_KEYS) t += p[k];
  return t;
}

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
