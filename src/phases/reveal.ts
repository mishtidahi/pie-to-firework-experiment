import type { PhaseModule } from './types';

/**
 * Clockwise radial wipe from 3 o'clock. The orange sector (270°→360°) is the
 * last one the leading edge reaches, so it appears last by construction.
 *
 * The edge follows a cubic Hermite from 0° to 360° whose start/end speeds are
 * multiples of the average speed. Ending fast (finish speed > 1) is what gives
 * the overshoot its momentum: the settle phase continues from this velocity.
 */
export const revealPhase: PhaseModule = {
  id: 'reveal',
  label: 'Radial wipe',
  durationKey: 'durReveal',
  build({ params, start, duration, motion }) {
    const avg = 360 / duration; // deg/s
    motion.begin(start, 0, (params.wipeStartSpeed as number) * avg);
    motion.hermiteTo(start + duration, 360, (params.wipeFinishSpeed as number) * avg, 'wipe');
    motion.revealEnd = start + duration;
  },
};
