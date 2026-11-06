import type { Params } from '../config/params';
import { tiltAngle } from '../geometry/projection';
import type { AnimState } from './animState';
import type { MasterTimeline } from './buildMasterTimeline';

/**
 * The firework rig's orientation over time, sampled from the master timeline
 * when it is built. Sparks need the body's orientation *at their birth*: a spark
 * leaves the physical rim in the direction the body faced then, and keeps that
 * course while the body tilts on (it does not swing round with the object).
 *
 * Sampling the real timeline (rather than re-deriving the eases) keeps this
 * exact under any parameter change. It is a pure function of the params, so it
 * is as deterministic as the timeline itself.
 */
export interface RigTrack {
  /** Samples per second. */
  hz: number;
  /** Time of sample 0 (s). */
  t0: number;
  /** Signed tilt angle (rad) about tiltAxis(params), as applied by FireworkRig. */
  tilt: Float64Array;
  /** Vibration envelope (state.vibration, 0..1). */
  vibration: Float64Array;
}

const HZ = 120;

/** Sample [from, to] of a freshly built (primed) master timeline, then return it to time 0. */
export function sampleRigTrack(master: MasterTimeline, params: Params, state: AnimState, from: number, to: number): RigTrack {
  const t0 = Math.max(0, from);
  const n = Math.max(2, Math.ceil((Math.min(to, master.duration) - t0) * HZ) + 1);
  const tilt = new Float64Array(n);
  const vibration = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    master.tl.time(Math.min(t0 + i / HZ, master.duration), true);
    tilt[i] = tiltAngle(params, state.tilt, state.preTilt);
    vibration[i] = state.vibration;
  }
  master.tl.time(0, true);
  return { hz: HZ, t0, tilt, vibration };
}

/** Linear interpolation into the track (clamped at both ends). */
export function rigAt(track: RigTrack, t: number): { tilt: number; vibration: number } {
  const x = Math.min(Math.max((t - track.t0) * track.hz, 0), track.tilt.length - 1);
  const i = Math.min(Math.floor(x), track.tilt.length - 2);
  const f = x - i;
  return {
    tilt: track.tilt[i] + (track.tilt[i + 1] - track.tilt[i]) * f,
    vibration: track.vibration[i] + (track.vibration[i + 1] - track.vibration[i]) * f,
  };
}
