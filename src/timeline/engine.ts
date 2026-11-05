import type { Params } from '../config/params';
import type { MotionTrack } from '../motion/MotionTrack';
import type { PhaseId } from '../phases';
import { createAnimState, type AnimState } from './animState';
import { buildMasterTimeline, type MasterTimeline, type PhaseSpan } from './buildMasterTimeline';

export interface EngineSnapshot {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  phaseIndex: number;
  schedule: PhaseSpan[];
  params: Params;
  /** Pure sweep/rotation curve for the current params (changes only on rebuild). */
  motion: MotionTrack;
  warnings: string[];
}

/** Changes only when the timeline is rebuilt: safe for 3D components to subscribe to. */
export interface BuildInfo {
  params: Params;
  schedule: PhaseSpan[];
  duration: number;
}

/**
 * Owns the master timeline and playback state. React subscribes through
 * `subscribe`/`getSnapshot` (useSyncExternalStore); the renderer reads
 * `engine.state` directly every frame.
 *
 * Preview playback uses GSAP's own ticker. Deterministic export (build phase
 * 4) instead pauses and calls `seek(frame / fps)` before each captured frame.
 */
export class AnimationEngine {
  readonly state: AnimState = createAnimState();
  private master: MasterTimeline;
  private params: Params;
  private speed = 1;
  private loop = false;
  private listeners = new Set<() => void>();
  private snapshot!: EngineSnapshot;
  private buildInfo!: BuildInfo;

  constructor(params: Params) {
    this.params = params;
    this.master = this.build();
    this.refresh();
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  play = () => {
    const { tl } = this.master;
    if (tl.time() >= this.master.duration) tl.time(0, true);
    tl.play();
    this.refresh();
  };

  pause = () => {
    this.master.tl.pause();
    this.refresh();
  };

  // Uses the snapshot so a finished (unpaused but inactive) timeline counts as stopped.
  toggle = () => (this.snapshot.playing ? this.pause() : this.play());

  restart = () => {
    this.master.tl.restart();
    this.refresh();
  };

  /** Jump to an absolute time; keeps the current play/pause state. */
  seek = (time: number) => {
    const t = Math.min(this.master.duration, Math.max(0, time));
    this.master.tl.time(t, true);
    this.refresh();
  };

  stepFrames = (frames: number) => {
    this.pause();
    const fps = this.params.exportFps as number;
    // Snap to the frame grid so stepping always lands on exportable frames.
    const frame = Math.round(this.master.tl.time() * fps) + frames;
    this.seek(frame / fps);
  };

  jumpToPhase = (id: PhaseId) => {
    const span = this.master.schedule.find((s) => s.id === id);
    if (span) this.seek(span.start);
  };

  setSpeed = (speed: number) => {
    this.speed = speed;
    this.master.tl.timeScale(speed);
    this.refresh();
  };

  setLoop = (loop: boolean) => {
    this.loop = loop;
    this.refresh();
  };

  // ── Parameters ────────────────────────────────────────────────────────────
  /** Rebuild the timeline with new params, preserving time and play state. */
  setParams = (params: Params) => {
    const { tl } = this.master;
    const time = tl.time();
    const wasPlaying = !tl.paused();
    tl.kill();
    this.params = params;
    this.master = this.build();
    this.master.tl.time(Math.min(time, this.master.duration), true);
    if (wasPlaying) this.master.tl.play();
    this.refresh();
  };

  getParams = () => this.params;

  // ── Subscription ──────────────────────────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  getBuild = () => this.buildInfo;

  dispose() {
    this.master.tl.kill();
    this.listeners.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────────
  private build(): MasterTimeline {
    const master = buildMasterTimeline(this.params, this.state);
    this.buildInfo = { params: this.params, schedule: master.schedule, duration: master.duration };
    master.tl.timeScale(this.speed);
    master.tl.eventCallback('onUpdate', () => this.refresh());
    master.tl.eventCallback('onComplete', () => {
      // Pause explicitly: a completed-but-unpaused GSAP timeline would start
      // playing again as soon as the user seeks backwards.
      if (this.loop) master.tl.play(0);
      else master.tl.pause();
      this.refresh();
    });
    return master;
  }

  private refresh() {
    const { tl, schedule, duration, motion, warnings } = this.master;
    const time = tl.time();
    let phaseIndex = schedule.findIndex((s) => time < s.end);
    if (phaseIndex === -1) phaseIndex = schedule.length - 1;
    this.snapshot = {
      time,
      duration,
      playing: !tl.paused() && tl.isActive(),
      speed: this.speed,
      loop: this.loop,
      phaseIndex,
      schedule,
      params: this.params,
      motion,
      warnings,
    };
    for (const fn of this.listeners) fn();
  }
}
