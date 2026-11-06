import type { Params } from '../config/params';
import { DEG } from '../geometry/pieGeometry';
import type { PhaseSpan } from '../timeline/buildMasterTimeline';
import { valueNoise } from './vibration';

/**
 * The chakri emission model, shared by the timeline phases (spark visibility),
 * the deterministic particle fields (birth times, angles, per-spark character)
 * and the body shaders (hot nozzle, emitting rim region). Pure functions of
 * (params, schedule, time): nothing here holds state.
 *
 * A ground spinner throws its sparks from a nozzle on the rim, jetting backwards
 * against the spin (the reaction is what drives it). Here:
 *
 *   gold reached ─ ignition ─ showerStart ─ (expansion) ─ showerFull = tilt begins ─ fadeStart ─ gone
 *
 * - Ignition: one concentrated source. Sparks leave a narrow rim region trailing
 *   the nozzle (`igniteSpread`), are slower, short-lived and short-trailed, and a
 *   few escape much farther. As the nozzle sweeps round, the emission traces an
 *   uneven, comet-like arm rather than a halo.
 * - Expansion: the emitting region widens to `sparkCoverage`, the rate climbs to
 *   `showerDensity`, and speed, life and trail grow to their peak values. With the
 *   nozzle turning, the arms overlap into a dense, nearly circular fan.
 * - Fade: during the expand phase emission declines and the strands thin out, so
 *   they are gone when the frame fills with yellow.
 */

/**
 * Apparent rotation of the body's visible features (rev/s, clockwise): the hard
 * spin-accent arcs on the top chamfer (sideShader.ts). The true spin (6 rev/s)
 * would step a single source 72° per 30 fps frame; the body is drawn turning at
 * this apparent rate instead, and the nozzle rides it, so the emission visibly
 * rotates with the body and never strobes.
 */
export const ACCENT_REV_S = 2;
/** Clock-angle phase (turns) of accent arc 0's centre: the nozzle rides that arc. */
export const NOZZLE_PHASE = 0.74 / 3;
/** Max rotational jitter (rad) at vibration 1 (body, accents and nozzle share it). */
export const JITTER_RAD = 4 * DEG;
/** Fastest the flare-up at ignition takes (s). */
const FLARE_UP_S = 0.04;

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const quadOut = (x: number) => 1 - (1 - x) * (1 - x);

export interface SparkTimes {
  /** Disc fully gold: the nozzle ignites. */
  igniteStart: number;
  /** End of the concentrated ignition: the shower starts expanding. */
  showerStart: number;
  /** Full shower (normally the start of the tilt). */
  showerFull: number;
  /** Emission and spark visibility begin to fade. */
  fadeStart: number;
  /** Everything spark-related is gone (just before the frame is filled). */
  gone: number;
}

/** Ignition timing within the spinner phase. */
export function igniteTimes(params: Params, fwStart: number, fwDuration: number) {
  const igniteStart = fwStart + fwDuration * (params.goldAt as number);
  const showerStart = igniteStart + (params.igniteDur as number);
  const showerFull = Math.max(fwStart + fwDuration, showerStart + 0.1);
  return { igniteStart, showerStart, showerFull };
}

/** Fade timing within the expand phase (same "gone" moment as the other accents). */
export function fadeTimes(params: Params, zoomStart: number, zoomDuration: number) {
  const goneAt = (params.fillAt as number) - 0.02;
  const fadeAt = Math.min(params.sparkFadeAt as number, goneAt - 0.05);
  return { fadeStart: zoomStart + zoomDuration * fadeAt, gone: zoomStart + zoomDuration * goneAt };
}

export function sparkTimes(params: Params, schedule: PhaseSpan[]): SparkTimes {
  const fw = schedule.find((s) => s.id === 'firework')!;
  const zm = schedule.find((s) => s.id === 'zoom')!;
  return { ...igniteTimes(params, fw.start, fw.end - fw.start), ...fadeTimes(params, zm.start, zm.end - zm.start) };
}

/**
 * Share of the expansion window over which newly emitted sparks reach full-shower
 * character. Sparks take most of their life to reach full extent, so the emission
 * must be at peak well before `showerFull` for the shower to *look* full then.
 */
const STAGE_SHARE = 0.55;

/** Shower development by emission time: 0 = concentrated ignition, 1 = full shower. Fast at first. */
export function showerStage(T: SparkTimes, t: number): number {
  return quadOut(clamp01((t - T.showerStart) / (STAGE_SHARE * (T.showerFull - T.showerStart))));
}

/** Width (rad) of the emitting rim region, which trails the nozzle. */
export function emissionWidth(params: Params, T: SparkTimes, t: number): number {
  const a = (params.igniteSpread as number) * DEG;
  const b = Math.max(a, (params.sparkCoverage as number) * DEG);
  return a + (b - a) * showerStage(T, t);
}

/** Emission rate (sparks/s) at time t, before burst noise. */
export function emissionRate(params: Params, T: SparkTimes, t: number): number {
  if (t < T.igniteStart || t >= T.gone) return 0;
  const ignite = params.igniteRate as number;
  const peak = params.showerDensity as number;
  let rate = ignite + (peak - ignite) * showerStage(T, t);
  if (t > T.fadeStart) rate *= clamp01(1 - (t - T.fadeStart) / (T.gone - T.fadeStart));
  return rate * clamp01((t - T.igniteStart) / FLARE_UP_S);
}

/** A real spinner sputters: smooth, seeded rate fluctuation (pure function of time). */
export function emissionBurst(seed: number, t: number): number {
  return Math.max(0.2, 1 + 0.35 * valueNoise(seed * 31 + 5, t * 9));
}

/**
 * Nozzle clock angle (rad, clockwise +, in the rig's non-spinning frame) at time t.
 * `jitter` is the body's rotational jitter (same sign convention as the shaders' uJitter).
 */
export function nozzleAngle(t: number, jitter = 0): number {
  return TAU * (ACCENT_REV_S * t + NOZZLE_PHASE) - jitter;
}

/** Length (rad) of the hot source drawn behind the nozzle: longer than one 30 fps step (24°). */
export function sourceArc(T: SparkTimes, t: number): number {
  return (30 + 12 * showerStage(T, t)) * DEG;
}
