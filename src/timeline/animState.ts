import type { PhaseId } from '../phases/types';

/**
 * Plain mutable object written by the GSAP master timeline and read by the
 * renderer each frame. Every value is a pure function of timeline time, so
 * seeking to t always produces the same picture.
 *
 * Note: GSAP attaches a non-serialisable `_gsap` cache to tweened objects;
 * skip that key when serialising.
 */
export interface AnimState {
  /** Linear 0→1 progress of each phase (0 before it starts, 1 after it ends). */
  phase: Record<PhaseId, number>;
  /** Timeline time in seconds (drives shader clocks for particles and noise). */
  time: number;

  // ── Phase 2: sweep / rotation ─────────────────────────────────────────────
  /** Sweep angle in clock degrees: 0→360 = wipe edge, beyond = 360 + rotation. */
  sweepDeg: number;
  /** d(sweep)/dt in deg/s: continuous across the wipe → rotation hand-off. */
  sweepVelocity: number;
  /** Radial wipe progress 0..1 (fraction of 360° revealed clockwise from 3 o'clock). */
  reveal: number;
  /** Pie body rotation, clock degrees (clockwise +). 0 = reference orientation. */
  rotationDeg: number;
  /** Pie body angular velocity in rev/s (clockwise +). 0 while the wipe runs. */
  angularVelocity: number;

  // ── Phase 3A: blur + colour (0..1 drivers) ────────────────────────────────
  /** Blur window: 0 = physical shutter only, 1 = full 360° average. */
  blurMix: number;
  /** Gap between sectors: 0 = reference gap, 1 = closed. */
  gapClose: number;
  /** Sector colours → disc colour. */
  discMix: number;

  // ── Phase 3B: ignition ────────────────────────────────────────────────────
  /** Light-orange disc → #ffde59. */
  goldMix: number;
  /** Clockwise light streaks across the disc. */
  energy: number;
  /** Sparks, orbiting streaks and glow intensity. */
  fire: number;
  /** Positional jitter and rotational instability envelope. */
  vibration: number;
  /** Perimeter instability envelope. */
  wobble: number;

  // ── Phase 3C/D: 3D expansion and final fill ───────────────────────────────
  /** 0 = face-on, 1 = full tilt. */
  tilt: number;
  /** 0 = start distance, 1 = fully closed in. */
  camera: number;
  /** ln(disc scale): exponential growth reads as a steady "rush" toward the viewer. */
  expandLog: number;
  /** Background blue → yellow (only ever visible if the disc fails to cover). */
  bgMix: number;
  /** 1 from the hold phase on: solid #ffde59, the firework rig is hidden. */
  finalFill: number;
}

export function createAnimState(): AnimState {
  return {
    phase: {
      intro: 0,
      reveal: 0,
      settle: 0,
      spinUp: 0,
      blur: 0,
      firework: 0,
      zoom: 0,
      hold: 0,
    },
    time: 0,
    sweepDeg: 0,
    sweepVelocity: 0,
    reveal: 0,
    rotationDeg: 0,
    angularVelocity: 0,
    blurMix: 0,
    gapClose: 0,
    discMix: 0,
    goldMix: 0,
    energy: 0,
    fire: 0,
    vibration: 0,
    wobble: 0,
    tilt: 0,
    camera: 0,
    expandLog: 0,
    bgMix: 0,
    finalFill: 0,
  };
}
