import type { PhaseModule } from './types';

/**
 * Stage A: angular motion blur and colour transformation.
 *
 * The pie keeps spinning at full speed (the motion track cruises). The
 * shader's analytic blur window widens from the physical shutter to a full
 * 360° average, so the sectors merge into a smooth disc without any frame
 * accumulation. While they are smeared, the blue gaps close and the mostly
 * white sectors are deliberately recoloured toward the light-orange disc
 * colour (averaging alone would give a pale grey-white). Rim energy starts
 * to rise, so the merged disc still reads as spinning.
 */
export const blurPhase: PhaseModule = {
  id: 'blur',
  label: 'Blur to disc',
  durationKey: 'durBlur',
  build({ tl, state, params, start, duration }) {
    const smoothAt = params.blurSmoothAt as number;
    const lead = Math.min(params.colourLead as number, smoothAt * 0.9);
    const at = (f: number) => start + duration * f;

    tl.fromTo(state, { blurMix: 0 }, { blurMix: 1, duration: duration * smoothAt, ease: 'sine.inOut', immediateRender: false }, start);
    tl.fromTo(
      state,
      { gapClose: 0 },
      { gapClose: 1, duration: duration * smoothAt * 0.75, ease: 'sine.inOut', immediateRender: false },
      at(smoothAt * 0.25),
    );
    tl.fromTo(
      state,
      { discMix: 0 },
      { discMix: 1, duration: duration * (1 - lead), ease: 'sine.inOut', immediateRender: false },
      at(lead),
    );
    tl.fromTo(state, { energy: 0 }, { energy: 0.45, duration: duration * 0.5, ease: 'sine.in', immediateRender: false }, at(0.5));
  },
};
