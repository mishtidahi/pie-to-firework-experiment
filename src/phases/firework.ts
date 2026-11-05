import type { PhaseModule } from './types';

/**
 * Stage B: ground-spinner ignition.
 *
 * The disc moves to golden #ffde59 while the firework comes alive:
 * vibration, perimeter instability, rim energy and glow ramp up, and the
 * spark/streak fields begin emitting. (Emission timing lives in the
 * deterministic particle fields; `fire` scales their visibility.)
 */
export const fireworkPhase: PhaseModule = {
  id: 'firework',
  label: 'Ground spinner',
  durationKey: 'durFirework',
  build({ tl, state, params, start, duration }) {
    const goldAt = params.goldAt as number;
    tl.fromTo(state, { goldMix: 0 }, { goldMix: 1, duration: duration * goldAt, ease: 'sine.inOut', immediateRender: false }, start);
    tl.fromTo(state, { fire: 0 }, { fire: 1, duration: duration * 0.3, ease: 'power2.out', immediateRender: false }, start);
    tl.fromTo(state, { energy: 0.45 }, { energy: 1, duration: duration * 0.3, ease: 'sine.out', immediateRender: false }, start);
    tl.fromTo(state, { vibration: 0 }, { vibration: 1, duration: duration * 0.35, ease: 'power2.in', immediateRender: false }, start);
    tl.fromTo(state, { wobble: 0 }, { wobble: 1, duration: duration * 0.45, ease: 'sine.inOut', immediateRender: false }, start);
  },
};
