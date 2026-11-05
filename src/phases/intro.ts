import type { PhaseModule } from './types';

/**
 * Empty blue screen before anything appears. Nothing to tween: the pie is
 * hidden because the reveal phase starts its wipe at 0 (build phase 2).
 */
export const introPhase: PhaseModule = {
  id: 'intro',
  label: 'Intro',
  durationKey: 'durIntro',
  build() {},
};
