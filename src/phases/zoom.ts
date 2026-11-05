import gsap from 'gsap';
import { aspectRatio } from '../config/params';
import { PIE_RADIUS_WORLD } from '../geometry/pieGeometry';
import { cameraZ, radiusToCoverCorners, tiltAngle, tiltAxis } from '../geometry/projection';
import type { PhaseModule } from './types';

const TILT_EASE = 'power2.inOut';
const CAMERA_EASE = 'power2.in';
/** Small safety factor over exact corner coverage (absorbs residual wobble/vibration). */
const COVER_SAFETY = 1.04;

/**
 * Stage C: 3D tilt, expansion and camera close-in until yellow fills the
 * frame.
 *
 * Expansion is solved, not guessed. At `fillAt` (a fraction of the phase)
 * the tilt and camera are known, so a ray–plane intersection
 * (geometry/projection.ts) gives the disc radius that exactly covers all
 * four frame corners. The scale curve exp(L·p^k) is then fitted to pass
 * through that radius at `fillAt`, which makes "the frame is full" a
 * deterministic, adjustable moment. Growth is exponential, so it reads as a rush
 * toward the viewer. Sparks, glow, wobble and energy fade out by `fillAt`;
 * the background crossfade starts only after full coverage and is never
 * visible (verified).
 */
export const zoomPhase: PhaseModule = {
  id: 'zoom',
  label: 'Expand + tilt',
  durationKey: 'durZoom',
  build({ tl, state, params, start, duration, warnings }) {
    const at = (f: number) => start + duration * f;
    const fillAt = params.fillAt as number;
    const k = params.expandCurve as number;
    const tiltE = gsap.parseEase(TILT_EASE);
    const camE = gsap.parseEase(CAMERA_EASE);

    const needScaleAt = (p: number) =>
      radiusToCoverCorners(
        aspectRatio(params),
        params.fov as number,
        cameraZ(params, camE(p)),
        tiltAxis(params),
        tiltAngle(params, tiltE(p)),
      ) / PIE_RADIUS_WORLD;

    let endLog: number;
    const need = needScaleAt(fillAt);
    if (!Number.isFinite(need)) {
      warnings.push('Tilt is too steep for this field of view: the disc cannot reach the top corners. The background crossfade will finish the fill.');
      endLog = Math.log(60);
    } else {
      endLog = Math.log(need * COVER_SAFETY) / Math.pow(fillAt, k);
      // Coverage must not be lost again after fillAt (tilt keeps increasing).
      for (let p = fillAt; p <= 1.0001; p += 0.01) {
        const scale = Math.exp(endLog * Math.pow(Math.min(p, 1), k));
        if (scale < needScaleAt(Math.min(p, 1))) {
          warnings.push(`Coverage is lost again at ${(p * 100).toFixed(0)}% of the expand phase; raise the expansion curve or lower the tilt.`);
          break;
        }
      }
    }

    tl.fromTo(state, { tilt: 0 }, { tilt: 1, duration, ease: TILT_EASE, immediateRender: false }, start);
    tl.fromTo(state, { camera: 0 }, { camera: 1, duration, ease: CAMERA_EASE, immediateRender: false }, start);
    tl.fromTo(
      state,
      { expandLog: 0 },
      // GSAP's named power eases are integer-only; a plain function allows any exponent.
      { expandLog: endLog, duration, ease: (p: number) => Math.pow(p, k), immediateRender: false },
      start,
    );

    // Everything that is not flat yellow is gone by the time the frame is full.
    const gone = fillAt - 0.02;
    tl.fromTo(state, { fire: 1 }, { fire: 0, duration: duration * (gone - 0.42), ease: 'sine.in', immediateRender: false }, at(0.42));
    tl.fromTo(state, { vibration: 1 }, { vibration: 0, duration: duration * (gone - 0.45), ease: 'sine.inOut', immediateRender: false }, at(0.45));
    tl.fromTo(state, { wobble: 1 }, { wobble: 0, duration: duration * (gone - 0.5), ease: 'sine.inOut', immediateRender: false }, at(0.5));
    tl.fromTo(state, { energy: 1 }, { energy: 0, duration: duration * (gone - 0.5), ease: 'sine.inOut', immediateRender: false }, at(0.5));
    // Safety net only: hidden behind the disc whenever coverage succeeds.
    const bgStart = Math.min(fillAt + 0.02, 0.99);
    tl.fromTo(state, { bgMix: 0 }, { bgMix: 1, duration: duration * (1 - bgStart), ease: 'none', immediateRender: false }, at(bgStart));
  },
};
