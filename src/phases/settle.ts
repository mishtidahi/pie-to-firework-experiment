import type { PhaseModule } from './types';

/** Longest share of the settle phase the overshoot may take before it is clamped. */
const MAX_OVERSHOOT_SHARE = 0.7;

/**
 * Sharp completion overshoot, then a small anticlockwise recoil.
 *
 * A full 360° mask cannot overshoot, so the momentum transfers to the whole
 * pie: it keeps turning clockwise at the wipe's finishing speed, brakes to a
 * stop `overshootDeg` past rest, then swings back anticlockwise to
 * `recoilDeg` before rest.
 *
 * Overshoot duration is derived, not set: h = m·O / v, where v is the
 * inherited velocity and m (1.2–3, from sharpness) is the Hermite start
 * tangent. m = 2 is constant deceleration, m → 3 a soft cubic ease-out, and
 * m → 1.2 carries nearly full speed and then brakes hard.
 */
export const settlePhase: PhaseModule = {
  id: 'settle',
  label: 'Overshoot + recoil',
  durationKey: 'durSettle',
  build({ params, start, duration, motion }) {
    const { t, angle, velocity } = motion.end;
    if (Math.abs(t - start) > 1e-9) motion.warnings.push('settle: motion track not continuous with phase start');

    const overshoot = params.overshootDeg as number;
    const recoil = params.recoilDeg as number;
    const m = 3 - 1.8 * (params.overshootSharpness as number);

    let h = (m * overshoot) / Math.max(velocity, 1e-6);
    const hMax = duration * MAX_OVERSHOOT_SHARE;
    if (h > hMax) {
      const mEff = (velocity * hMax) / overshoot;
      motion.warnings.push(
        `Overshoot wants ${(h * 1000).toFixed(0)} ms but is clamped to ${(hMax * 1000).toFixed(0)} ms` +
          (mEff < 1 ? ' (the pie speeds up before braking)' : ''),
      );
      h = hMax;
    }

    motion.hermiteTo(t + h, angle + overshoot, 0, 'overshoot');
    motion.hermiteTo(start + duration, angle - recoil, 0, 'recoil');
  },
};
