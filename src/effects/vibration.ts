import { hash01 } from '../lib/random';

/**
 * Smooth 1D value noise in [-1, 1]: hashed lattice values with quintic
 * interpolation. Pure function of (seed, x), so it is seek-safe.
 */
export function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * u;
}

export interface Vibration {
  /** Positional offset, roughly in [-1, 1]. */
  x: number;
  y: number;
  /** Rotational jitter, roughly in [-1, 1]. */
  rot: number;
  /** Tilt "precession" wobble, roughly in [-1, 1]. */
  tiltX: number;
  tiltY: number;
}

/**
 * Deterministic firework vibration. A fast octave (~38 Hz) gives buzz and a
 * slower one (~11 Hz) gives lurching instability. Sampled at 30 or 60 fps
 * this reads as energetic jitter, never as a regular pattern.
 */
export function vibrationAt(seed: number, t: number): Vibration {
  const n = (k: number, hz: number) => valueNoise(seed * 13 + k, t * hz);
  return {
    x: 0.65 * n(1, 38) + 0.35 * n(2, 11),
    y: 0.65 * n(3, 41) + 0.35 * n(4, 12),
    rot: 0.6 * n(5, 33) + 0.4 * n(6, 9),
    tiltX: 0.5 * n(7, 17) + 0.5 * n(8, 6),
    tiltY: 0.5 * n(9, 19) + 0.5 * n(10, 7),
  };
}
