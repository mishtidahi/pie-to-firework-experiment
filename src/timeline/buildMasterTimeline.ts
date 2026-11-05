import gsap from 'gsap';
import type { Params } from '../config/params';
import { MotionTrack } from '../motion/MotionTrack';
import { PHASES, type PhaseId } from '../phases';
import type { AnimState } from './animState';

export interface PhaseSpan {
  id: PhaseId;
  label: string;
  start: number;
  end: number;
}

export interface MasterTimeline {
  tl: gsap.core.Timeline;
  schedule: PhaseSpan[];
  duration: number;
  /** The finished sweep/rotation curve (pure; also used by the motion graph and tests). */
  motion: MotionTrack;
  /** Warnings from the motion track and phase builders. */
  warnings: string[];
}

/**
 * Assemble the single, paused, seekable master timeline. Phases are laid out
 * back to back from their duration params; each gets a label (for jumping)
 * and a linear progress driver in `state.phase[id]`.
 */
export function buildMasterTimeline(params: Params, state: AnimState): MasterTimeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  const schedule: PhaseSpan[] = [];
  const motion = new MotionTrack();
  const warnings: string[] = [];
  let at = 0;

  for (const phase of PHASES) {
    const duration = params[phase.durationKey] as number;
    tl.addLabel(phase.id, at);
    tl.fromTo(
      state.phase,
      { [phase.id]: 0 },
      { [phase.id]: 1, duration, immediateRender: false },
      at,
    );
    phase.build({ tl, state, params, start: at, duration, motion, warnings });
    schedule.push({ id: phase.id, label: phase.label, start: at, end: at + duration });
    at += duration;
  }

  addMotionDriver(tl, state, motion, at);

  // Pin the total length even if the last phases add no tweens of their own.
  tl.set({}, {}, at);

  // Prime: render every tween once, in order, so start values are recorded
  // deterministically before any out-of-order seek happens.
  tl.progress(1, true).progress(0, true);

  return { tl, schedule, duration: at, motion, warnings: [...motion.warnings, ...warnings] };
}

/**
 * Drives the motion track from the timeline with one linear tween over the
 * whole sequence. The tweened property is a getter/setter function (a
 * standard GSAP feature): GSAP calls it on every render, including seeks with
 * suppressed events, so the derived values below always match the playhead.
 */
function addMotionDriver(tl: gsap.core.Timeline, state: AnimState, motion: MotionTrack, duration: number) {
  let current = 0;
  const apply = (t: number) => {
    const s = motion.sample(t);
    state.time = t;
    state.sweepDeg = s.angle;
    state.sweepVelocity = s.velocity;
    if (t < motion.revealEnd) {
      // The wipe: the mask edge is the sweep; the body does not rotate.
      state.reveal = Math.min(1, Math.max(0, s.angle / 360));
      state.rotationDeg = 0;
      state.angularVelocity = 0;
    } else {
      // The hand-off: the full pie carries the sweep beyond 360° as rotation.
      state.reveal = 1;
      state.rotationDeg = s.angle - 360;
      state.angularVelocity = s.velocity / 360;
    }
  };
  const clock = {
    seconds(value?: number) {
      if (value === undefined) return current;
      current = value;
      apply(value);
      return current;
    },
  };
  tl.fromTo(clock, { seconds: 0 }, { seconds: duration, duration, immediateRender: false }, 0);
}
