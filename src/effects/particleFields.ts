import type { Params } from '../config/params';
import { DEG } from '../geometry/pieGeometry';
import { hash01 } from '../lib/random';
import type { PhaseSpan } from '../timeline/buildMasterTimeline';
import { rigAt, type RigTrack } from '../timeline/rigTrack';
import {
  JITTER_RAD,
  emissionBurst,
  emissionRate,
  emissionWidth,
  nozzleAngle,
  showerStage,
  sparkTimes,
  type SparkTimes,
} from './emission';
import { valueNoise, vibrationAt } from './vibration';

/**
 * Deterministic particle data. Each particle is a fixed set of attributes
 * (birth time, lifetime, angle, speed, …) generated from (seed, index); the
 * vertex shaders evaluate position as a closed-form function of timeline
 * time. No simulation state exists, so any timestamp renders identically
 * whether reached by playback, scrubbing or export.
 */

const TAU = Math.PI * 2;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Independent random stream per attribute. */
const rnd = (seed: number, stream: number, i: number) => hash01(seed * 97 + stream * 7919, i);

/** Trails must span ≥ this many seconds (2 frames at 30 fps), so strands overlap frame to frame. */
export const MIN_TRAIL_S = 2 / 30;
/** Trail of a split-off incandescent particle (a short dash, > 1 frame at 30 fps). */
export const EMBER_TRAIL_S = 0.045;
/** Share of sparks that throw off an incandescent particle. */
const EMBER_SHARE = 0.16;

/**
 * Emission times distributed by the emission rate (inverse CDF of the tabulated,
 * sputtering rate), stratified so there are no clumps or gaps beyond the designed
 * bursts. `scale` thins the stream (e.g. for the orbiting streaks).
 */
export function sampleBirths(params: Params, T: SparkTimes, seed: number, scale = 1, count?: number): number[] {
  const dt = 1 / 1000;
  const t0 = T.igniteStart;
  const n = Math.max(1, Math.ceil((T.gone - t0) / dt));
  const cum = new Float64Array(n + 1);
  // The sputter pattern belongs to the spinner (params.seed); `seed` only stratifies this stream.
  const rateAt = (t: number) => emissionRate(params, T, t) * emissionBurst(params.seed as number, t);
  let prev = rateAt(t0);
  for (let i = 1; i <= n; i++) {
    const r = rateAt(t0 + i * dt);
    cum[i] = cum[i - 1] + 0.5 * (prev + r) * dt;
    prev = r;
  }
  const total = cum[n];
  const N = count ?? Math.round(total * scale);
  const out: number[] = [];
  if (total <= 0 || N <= 0) return out;
  for (let k = 0; k < N; k++) {
    const target = ((k + rnd(seed, 1, k)) / N) * total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    out.push(t0 + (lo + (span > 0 ? (target - cum[lo]) / span : 0)) * dt);
  }
  return out;
}

export interface SparkField {
  count: number;
  /** birth (s), life (s), birth angle (rad, clock), launch speed (R/s) */
  a0: Float32Array;
  /** spread from the backward tangent (rad), width multiplier, lift (R/s), body tilt at birth (rad) */
  a1: Float32Array;
  /** trail (s), curvature (1/R), waver amplitude, waver frequency (Hz) */
  a2: Float32Array;
  /** waver phase (rad), split age (s; −1 = an ordinary spark), kick angle (rad), kick speed (R/s) */
  a3: Float32Array;
  /** Number of split-off incandescent particles among `count`. */
  embers: number;
}

/**
 * Chakri sparks. Each spark is born at the nozzle's rim position at its birth
 * time (anywhere in the emitting region that trails the nozzle), with a launch
 * direction mostly along the backward tangent (the jet), varied by stage and
 * irregularity. Ignition sparks are slower, shorter-lived and shorter-trailed;
 * a few escape far beyond the rest. Some sparks throw off a small incandescent
 * particle partway along their path. The body's tilt at birth is stored, so the
 * spark keeps its course while the body goes on tilting.
 */
export function buildSparkField(params: Params, schedule: PhaseSpan[], rig: RigTrack): SparkField {
  const seed = params.seed as number;
  const T = sparkTimes(params, schedule);
  const births = sampleBirths(params, T, seed);
  const speed = params.sparkSpeed as number;
  const lifeMean = params.sparkLife as number;
  const trailMean = params.sparkTrail as number;
  const irr = params.sparkWaver as number;
  const lift = params.sparkLift as number;
  const vibParam = params.vibration as number;
  // Lobes over the rim angle give the shower an organic, uneven silhouette.
  const lobePhase = [rnd(seed, 40, 0), rnd(seed, 41, 0), rnd(seed, 42, 0)].map((x) => x * TAU);

  const rows: number[][] = [];
  births.forEach((tb, i) => {
    const r = (s: number) => rnd(seed, s, i);
    const q = showerStage(T, tb);
    const rigNow = rigAt(rig, tb);
    const jitter = vibrationAt(seed, tb).rot * JITTER_RAD * rigNow.vibration * vibParam;
    // Birth position: inside the emitting region, concentrated just behind the nozzle.
    const phi = nozzleAngle(tb, jitter) - emissionWidth(params, T, tb) * Math.pow(r(3), 1.7);
    const lobe = 0.5 * Math.sin(3 * phi + lobePhase[0]) + 0.3 * Math.sin(5 * phi + lobePhase[1]) + 0.2 * Math.sin(7 * phi + lobePhase[2]);
    const surge = valueNoise(seed * 17 + 3, tb * 6);
    const escape = r(4) < mix(0.08, 0.045, q);
    const v0 =
      speed * mix(0.55, 1, q) * (0.5 + 0.9 * Math.pow(r(5), 1.3)) * (1 + 0.16 * irr * lobe) * (1 + 0.12 * irr * surge) * (escape ? 1.8 + 0.6 * r(6) : 1);
    const life = lifeMean * mix(0.32, 1, q) * (0.55 + 0.9 * r(7)) * (1 + 0.1 * irr * lobe) * (escape ? 1.5 : 1);
    const trail = Math.max(trailMean * mix(0.4, 1, q) * (0.6 + 0.8 * r(8)), MIN_TRAIL_S);
    // Ignition: predominantly one tangential direction. Shower: a wider fan.
    // (Steep enough that the spray visibly leaves the source instead of sliding along the rim.)
    const spreadLo = mix(12, 10, q);
    const spreadHi = mix(48, 64, q) * (0.75 + 0.25 * Math.min(irr, 2));
    const spread = (spreadLo + (spreadHi - spreadLo) * Math.pow(r(9), 1.2)) * DEG;
    const width = (0.8 + 0.4 * r(10)) * mix(1.15, 1, q);
    const vz = lift * (0.15 + 0.85 * r(11)) * mix(0.6, 1, q);
    // Simplified for the graphic stroke look: a gentle bend and one slow sway, not a wire's jitter.
    const curvature = irr * 0.03 * (2 * r(12) - 1);
    const waverAmp = irr * (0.002 + 0.008 * r(13));
    const waverHz = 1 + 2 * r(14);
    const waverPhase = TAU * r(15);
    const base = [tb, life, phi, v0, spread, width, vz, rigNow.tilt, trail, curvature, waverAmp, waverHz, waverPhase, -1, 0, 0];
    rows.push(base);
    if (r(16) < EMBER_SHARE) {
      // An incandescent particle splits off partway, kicked sideways, and outlives its parent.
      const split = life * (0.25 + 0.5 * r(17));
      const kick = (r(18) < 0.5 ? -1 : 1) * (35 + 75 * r(19)) * DEG;
      const kickV = 0.4 + 1.2 * r(20);
      const emberLife = split + 0.25 + 0.5 * r(21);
      rows.push([tb, emberLife, phi, v0, spread, 0.75 + 0.2 * r(22), vz, rigNow.tilt, EMBER_TRAIL_S, curvature, waverAmp, waverHz, waverPhase, split, kick, kickV]);
    }
  });

  const count = rows.length;
  const a0 = new Float32Array(count * 4);
  const a1 = new Float32Array(count * 4);
  const a2 = new Float32Array(count * 4);
  const a3 = new Float32Array(count * 4);
  rows.forEach((row, i) => {
    a0.set(row.slice(0, 4), i * 4);
    a1.set(row.slice(4, 8), i * 4);
    a2.set(row.slice(8, 12), i * 4);
    a3.set(row.slice(12, 16), i * 4);
  });
  return { count, a0, a1, a2, a3, embers: rows.filter((row) => row[13] >= 0).length };
}

export interface StreakField {
  count: number;
  /** birth, life, start angle (rad), angular speed (rad/s, clockwise +) */
  a0: Float32Array;
  /** orbit radius, trail time (s), width, break-away time (s after birth; −1 = none) */
  a1: Float32Array;
  /** break-away acceleration, radial wobble amplitude, wobble frequency, seed */
  a2: Float32Array;
}

/** Trail must span ≥ this many 30 fps frames so the streak never strobes. */
const MIN_TRAIL_FRAMES_30 = 1.4;

/**
 * Short streaks swirling just outside the wall, born where the rim is emitting
 * (so they start at the nozzle during ignition and all round in the shower), on
 * the same sputtering emission schedule as the sparks.
 */
export function buildStreakField(params: Params, schedule: PhaseSpan[]): StreakField {
  const count = Math.round(params.streakCount as number);
  const seed = (params.seed as number) + 101;
  const T = sparkTimes(params, schedule);
  const births = sampleBirths(params, T, seed, 1, count);
  const n = births.length;
  const a0 = new Float32Array(n * 4);
  const a1 = new Float32Array(n * 4);
  const a2 = new Float32Array(n * 4);
  births.forEach((birth, i) => {
    const life = 0.3 + 0.5 * rnd(seed, 2, i);
    const omega = (1.3 + 1.6 * rnd(seed, 4, i)) * Math.PI * 2; // apparent orbit speed, rev/s → rad/s
    const arc = 0.45 + 0.9 * rnd(seed, 5, i); // radians of trail
    const trail = Math.max(arc / omega, MIN_TRAIL_FRAMES_30 / 30);
    const breaks = rnd(seed, 6, i) < 0.5;
    const start = nozzleAngle(birth) - emissionWidth(params, T, birth) * Math.pow(rnd(seed, 3, i), 1.5);
    a0.set([birth, life, start, omega], i * 4);
    a1.set(
      [
        1.04 + 0.16 * Math.pow(rnd(seed, 7, i), 1.5), // just outside the body wall
        trail,
        0.6 + 0.6 * rnd(seed, 8, i),
        breaks ? life * (0.25 + 0.45 * rnd(seed, 9, i)) : -1,
      ],
      i * 4,
    );
    a2.set(
      [2 + 5 * rnd(seed, 10, i), 0.01 + 0.025 * rnd(seed, 11, i), 14 + 26 * rnd(seed, 12, i), rnd(seed, 13, i)],
      i * 4,
    );
  });
  return { count: n, a0, a1, a2 };
}
