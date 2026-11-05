import { blurPhase } from './blur';
import { fireworkPhase } from './firework';
import { holdPhase } from './hold';
import { introPhase } from './intro';
import { revealPhase } from './reveal';
import { settlePhase } from './settle';
import { spinUpPhase } from './spinUp';
import type { PhaseModule } from './types';
import { zoomPhase } from './zoom';

/** Phases in playback order. The master timeline lays them out back to back. */
export const PHASES: readonly PhaseModule[] = [
  introPhase,
  revealPhase,
  settlePhase,
  spinUpPhase,
  blurPhase,
  fireworkPhase,
  zoomPhase,
  holdPhase,
];

export type { PhaseId, PhaseModule, PhaseBuildContext } from './types';
