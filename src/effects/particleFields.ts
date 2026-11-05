import type { Params } from '../config/params';
import { hash01 } from '../lib/random';
import type { PhaseSpan } from '../timeline/buildMasterTimeline';

/**
 * Deterministic particle data. Each particle is a fixed set of attributes
 * (birth time, lifetime, angle, speed, …) generated from (seed, index); the
 * vertex shaders evaluate position as a closed-form function of timeline
 * time. No simulation state exists, so any timestamp renders identically
 * whether reached by playback, scrubbing or export.
 */

/** Trapezoidal emission envelope: 0 at e0, ramps to 1 by e1, holds to e2, back to 0 by e3. */
export interface Envelope {
  e0: number;
  e1: number;
  e2: number;
  e3: number;
}

export function emissionEnvelope(schedule: PhaseSpan[]): Envelope {
  const fw = schedule.find((s) => s.id === 'firework')!;
  const zm = schedule.find((s) => s.id === 'zoom')!;
  const fd = fw.end - fw.start;
  const zd = zm.end - zm.start;
  return {
    e0: fw.start + 0.02 * fd,
    e1: fw.start + 0.3 * fd,
    e2: zm.start + 0.3 * zd,
    e3: zm.start + 0.62 * zd,
  };
}

/** Map a uniform u ∈ [0,1) to an emission time distributed by the envelope (inverse CDF). */
function sampleEnvelope(env: Envelope, u: number): number {
  const { e0, e1, e2, e3 } = env;
  const aUp = (e1 - e0) / 2;
  const aFlat = e2 - e1;
  const aDown = (e3 - e2) / 2;
  const total = aUp + aFlat + aDown;
  let a = u * total;
  if (a < aUp) return e0 + Math.sqrt((2 * a * (e1 - e0)));
  a -= aUp;
  if (a < aFlat) return e1 + a;
  a -= aFlat;
  // Falling ramp: area from e2 to x is (x−e2) − (x−e2)²/(2(e3−e2)).
  const L = e3 - e2;
  return e2 + L - Math.sqrt(Math.max(0, L * L - 2 * L * a));
}

/** Independent random stream per attribute. */
const rnd = (seed: number, stream: number, i: number) => hash01(seed * 97 + stream * 7919, i);

export interface SparkField {
  count: number;
  /** birth, life, rim angle (rad, clock), speed multiplier */
  a0: Float32Array;
  /** outward spread (rad), width multiplier, seed, brightness */
  a1: Float32Array;
}

export function buildSparkField(params: Params, schedule: PhaseSpan[]): SparkField {
  const count = Math.round(params.sparkCount as number);
  const seed = params.seed as number;
  const life = params.sparkLife as number;
  const env = emissionEnvelope(schedule);
  const a0 = new Float32Array(count * 4);
  const a1 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // Stratified emission times avoid clumps and gaps at any count.
    const birth = sampleEnvelope(env, (i + rnd(seed, 1, i)) / Math.max(count, 1));
    a0.set(
      [
        birth,
        life * (0.55 + 0.9 * rnd(seed, 2, i)),
        rnd(seed, 3, i) * Math.PI * 2,
        0.55 + 0.95 * Math.pow(rnd(seed, 4, i), 1.4),
      ],
      i * 4,
    );
    a1.set(
      [
        (8 + 42 * rnd(seed, 5, i)) * (Math.PI / 180), // mostly tangential: centrifugal, not radial
        0.6 + 0.8 * rnd(seed, 6, i),
        rnd(seed, 7, i),
        0.6 + 0.4 * rnd(seed, 8, i),
      ],
      i * 4,
    );
  }
  return { count, a0, a1 };
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

export function buildStreakField(params: Params, schedule: PhaseSpan[]): StreakField {
  const count = Math.round(params.streakCount as number);
  const seed = (params.seed as number) + 101;
  const env = emissionEnvelope(schedule);
  const a0 = new Float32Array(count * 4);
  const a1 = new Float32Array(count * 4);
  const a2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const birth = sampleEnvelope(env, (i + rnd(seed, 1, i)) / Math.max(count, 1));
    const life = 0.35 + 0.6 * rnd(seed, 2, i);
    const omega = (1.3 + 1.6 * rnd(seed, 4, i)) * Math.PI * 2; // apparent orbit speed, rev/s → rad/s
    const arc = 0.45 + 0.9 * rnd(seed, 5, i); // radians of trail
    const trail = Math.max(arc / omega, MIN_TRAIL_FRAMES_30 / 30);
    const breaks = rnd(seed, 6, i) < 0.4;
    a0.set([birth, life, rnd(seed, 3, i) * Math.PI * 2, omega], i * 4);
    a1.set(
      [
        0.97 + 0.2 * Math.pow(rnd(seed, 7, i), 1.5),
        trail,
        0.7 + 0.7 * rnd(seed, 8, i),
        breaks ? life * (0.25 + 0.45 * rnd(seed, 9, i)) : -1,
      ],
      i * 4,
    );
    a2.set(
      [2 + 5 * rnd(seed, 10, i), 0.01 + 0.025 * rnd(seed, 11, i), 14 + 26 * rnd(seed, 12, i), rnd(seed, 13, i)],
      i * 4,
    );
  }
  return { count, a0, a1, a2 };
}
