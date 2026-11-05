import type { ParamKey, Params } from '../config/params';
import type { MotionTrack } from '../motion/MotionTrack';
import type { AnimState } from '../timeline/animState';

export type PhaseId =
  | 'intro'
  | 'reveal'
  | 'settle'
  | 'spinUp'
  | 'blur'
  | 'firework'
  | 'zoom'
  | 'hold';

// `gsap` below is GSAP's global type namespace (no import needed).
export interface PhaseBuildContext {
  /** The single master timeline. Add tweens at absolute positions ≥ `start`. */
  tl: gsap.core.Timeline;
  /** Mutable state object read by the renderer every frame. */
  state: AnimState;
  params: Params;
  /** Absolute start time of this phase on the master timeline (seconds). */
  start: number;
  /** Duration of this phase (seconds). */
  duration: number;
  /**
   * Shared sweep/rotation curve. Phases append segments in order; each new
   * segment starts from `motion.end`, which keeps angle and velocity
   * continuous across phase boundaries. The master timeline drives it.
   */
  motion: MotionTrack;
  /** Build-time warnings shown in the debug panel (e.g. impossible parameter combinations). */
  warnings: string[];
}

/**
 * One animation phase. Rules for implementations (they keep scrubbing exact):
 *  - Only use `fromTo` / `set` with explicit values; never rely on values
 *    captured from the current state at build time.
 *  - Never integrate over frames. Anything physical (spin angle, particle
 *    positions) must be a pure function of time, typically by tweening a
 *    linear 0→1 driver and evaluating a closed-form curve from it.
 *  - Randomness comes only from the seeded PRNG in lib/random.ts.
 */
export interface PhaseModule {
  id: PhaseId;
  label: string;
  /** Parameter holding this phase's duration. */
  durationKey: ParamKey;
  build(ctx: PhaseBuildContext): void;
}
