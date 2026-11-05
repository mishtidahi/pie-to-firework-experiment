import type { PhaseModule } from './types';

/**
 * Stage D: solid #ffde59. From the first frame of this phase the firework rig
 * is hidden and the background is pure yellow, so the result is exact by
 * construction: no particles, gradients or residual geometry. The disc
 * already covers the frame in flat yellow before this point (verified), so
 * the switch is invisible.
 */
export const holdPhase: PhaseModule = {
  id: 'hold',
  label: 'Final yellow',
  durationKey: 'durHold',
  build({ tl, state, start }) {
    tl.set(state, { finalFill: 1, bgMix: 1 }, start);
  },
};
