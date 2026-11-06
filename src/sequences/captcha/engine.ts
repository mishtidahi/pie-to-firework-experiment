import gsap from 'gsap';
import type { CaptchaParams } from './config';

/**
 * Timeline for the CAPTCHA sequence. A paused GSAP master timeline tweens the
 * interface state (panel entrance, nine tile selections, VERIFY press); the
 * rocket, burst and particles are closed-form functions of the timeline time
 * (draw/*.ts). Seeking renders the same frame regardless of history, so preview
 * and export match exactly.
 *
 * Same automation surface as the spinner's AnimationEngine: play / pause /
 * seek(t) / setLoop, exposed as window.__pieFirework for the exporter.
 */
export interface CaptchaState {
  panelAlpha: number;
  panelY: number;
  panelScale: number;
  /** Per-tile selection progress 0..1 (row-major). */
  sel: number[];
  verify: number;
}

/** Selection length of one tile (press, switch, spring back). */
export const SELECT_DUR = 0.26;

/** Start time of each tile's selection: row-major, the rhythm quickening (each gap 0.9 × the last). */
export function selectionTimes(p: CaptchaParams): number[] {
  const ratio = 0.9;
  const span = p.selectEnd - p.selectStart;
  const g0 = (span * (1 - ratio)) / (1 - Math.pow(ratio, 8));
  const out = [p.selectStart];
  for (let i = 1; i < 9; i++) out.push(out[i - 1] + g0 * Math.pow(ratio, i - 1));
  return out;
}

export class CaptchaEngine {
  readonly state: CaptchaState = { panelAlpha: 0, panelY: 80, panelScale: 0.95, sel: Array(9).fill(0), verify: 0 };
  readonly duration: number;
  private readonly tl: gsap.core.Timeline;
  /** GSAP tweens plain objects; the per-tile values are mirrored into state.sel on every render. */
  private readonly selTargets = Array.from({ length: 9 }, () => ({ v: 0 }));
  private readonly listeners = new Set<() => void>();
  private loop = false;

  constructor(readonly params: CaptchaParams) {
    this.duration = params.duration;
    const s = this.state;
    const tl = gsap.timeline({ paused: true, onUpdate: () => this.emit(), onComplete: () => this.onComplete() });
    const opt = { immediateRender: false };
    const enter = params.entranceEnd - 0.02;
    tl.fromTo(s, { panelAlpha: 0 }, { panelAlpha: 1, duration: 0.14, ease: 'power1.out', ...opt }, 0.02);
    tl.fromTo(s, { panelY: 80 }, { panelY: 0, duration: enter, ease: 'back.out(1.5)', ...opt }, 0.02);
    tl.fromTo(s, { panelScale: 0.95 }, { panelScale: 1, duration: enter, ease: 'back.out(1.5)', ...opt }, 0.02);
    selectionTimes(params).forEach((at, i) => {
      tl.fromTo(this.selTargets[i], { v: 0 }, { v: 1, duration: SELECT_DUR, ease: 'none', ...opt }, at);
    });
    tl.fromTo(s, { verify: 0 }, { verify: 1, duration: 0.22, ease: 'none', ...opt }, params.verifyAt);
    tl.set({}, {}, this.duration); // the timeline spans exactly the full duration
    this.tl = tl;
  }

  get time() {
    return this.tl.time();
  }

  get playing() {
    return !this.tl.paused() && this.tl.isActive();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.selTargets.forEach((o, i) => (this.state.sel[i] = o.v));
    for (const fn of this.listeners) fn();
  }

  private onComplete() {
    if (this.loop) this.tl.time(0, true).play();
  }

  play = () => {
    if (this.tl.time() >= this.duration) this.tl.time(0, true);
    this.tl.play();
    this.emit();
  };

  pause = () => {
    this.tl.pause();
    this.emit();
  };

  toggle = () => (this.playing ? this.pause() : this.play());

  /** Jump to an absolute time (seconds), keeping the play/pause state. */
  seek = (time: number) => {
    this.tl.time(Math.min(this.duration, Math.max(0, time)), true);
    this.emit();
  };

  setLoop = (loop: boolean) => {
    this.loop = loop;
  };

  dispose() {
    this.tl.kill();
    this.listeners.clear();
  }
}
