import type { PhaseModule } from './types';

/**
 * Stage A: the pie becomes a cel-shaded 3D spinner body.
 *
 * The spinning pie's motion smear (the exact analytic coverage over the
 * shutter window) is posterised into hard-edged tones and stretched to twice
 * the per-frame step, so the spin is drawn with overlapping graphic smear
 * shapes rather than a soft blur. At the same time the sectors morph,
 * seam-free, into concentric bands with the same proportions: the orange arc
 * widens symmetrically and closes into the outer ring, and each blue gap curls
 * round into a coil groove (see pieShader.ts). The morph is front-loaded
 * (power3.out), so the rotating asymmetric detail is gone within a few frames
 * and the fast spin is then carried by rotation-invariant bands plus the hard
 * spin accents on the bevel. The gaps close into grooves, the colours resolve to
 * the light-orange spinner, the body grows its thickness and real bevel, cel
 * shading comes in, and a gentle ignition tilt starts revealing the side wall.
 */
export const blurPhase: PhaseModule = {
  id: 'blur',
  label: 'Pie → spinner body',
  durationKey: 'durBlur',
  build({ tl, state, params, start, duration }) {
    const smoothAt = params.blurSmoothAt as number;
    const lead = Math.min(params.colourLead as number, smoothAt * 0.9);
    const at = (f: number) => start + duration * f;
    const d = (f: number) => duration * f;
    const opt = { immediateRender: false };

    tl.fromTo(state, { smear: 0 }, { smear: 1, duration: d(0.08), ease: 'power1.out', ...opt }, start);
    tl.fromTo(state, { morph: 0 }, { morph: 1, duration: d(smoothAt), ease: 'power3.out', ...opt }, start);
    tl.fromTo(state, { gapClose: 0 }, { gapClose: 1, duration: d(0.6), ease: 'sine.inOut', ...opt }, at(0.4));
    tl.fromTo(state, { discMix: 0 }, { discMix: 1, duration: d(1 - lead), ease: 'sine.inOut', ...opt }, at(lead));
    tl.fromTo(state, { body: 0 }, { body: 1, duration: d(0.75), ease: 'power2.out', ...opt }, at(0.25));
    tl.fromTo(state, { shade: 0 }, { shade: 1, duration: d(0.6), ease: 'sine.inOut', ...opt }, at(0.4));
    tl.fromTo(state, { preTilt: 0 }, { preTilt: 0.4, duration: d(0.65), ease: 'sine.in', ...opt }, at(0.35));
    tl.fromTo(state, { energy: 0 }, { energy: 0.45, duration: d(0.4), ease: 'sine.out', ...opt }, at(0.3));
  },
};
