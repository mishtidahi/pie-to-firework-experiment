import { igniteTimes } from '../effects/emission';
import type { PhaseModule } from './types';

/**
 * Stage B: ground-spinner ignition.
 *
 * First the cel-shaded body completes its move to golden #ffde59 (by `goldAt`,
 * 5.1 s by default) while vibration, perimeter instability and the hard spin
 * accents build up and the ignition tilt finishes, so the side wall reads.
 * Only then does the nozzle ignite: `fire` switches the hot source, the rim heat
 * flashes and the spark/streak strands on. The emission itself (concentrated
 * ignition, then a shower that is full when the tilt begins) is scheduled in
 * the deterministic particle fields (src/effects/emission.ts).
 */
export const fireworkPhase: PhaseModule = {
  id: 'firework',
  label: 'Ground spinner',
  durationKey: 'durFirework',
  build({ tl, state, params, start, duration }) {
    const goldAt = params.goldAt as number;
    const { igniteStart } = igniteTimes(params, start, duration);
    const opt = { immediateRender: false };
    tl.fromTo(state, { goldMix: 0 }, { goldMix: 1, duration: duration * goldAt, ease: 'sine.inOut', ...opt }, start);
    tl.fromTo(state, { fire: 0 }, { fire: 1, duration: 0.08, ease: 'power2.out', ...opt }, igniteStart);
    tl.fromTo(state, { energy: 0.45 }, { energy: 1, duration: duration * 0.3, ease: 'sine.out', ...opt }, start);
    tl.fromTo(state, { vibration: 0 }, { vibration: 1, duration: duration * 0.35, ease: 'power2.in', ...opt }, start);
    tl.fromTo(state, { wobble: 0 }, { wobble: 1, duration: duration * 0.45, ease: 'sine.inOut', ...opt }, start);
    tl.fromTo(state, { preTilt: 0.4 }, { preTilt: 1, duration: duration * 0.55, ease: 'sine.inOut', ...opt }, start);
  },
};
