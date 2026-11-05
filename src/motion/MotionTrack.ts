/**
 * A C¹-continuous (position + velocity) angle curve built from segments that
 * each start exactly where the previous one ended. Pure: angleAt(t) depends
 * only on t, so it is safe for scrubbing and deterministic export.
 *
 * The track describes the "sweep angle" in clock degrees (clockwise +):
 *   0°→360° is the radial wipe's leading edge; after the wipe completes the
 *   excess (sweep − 360°) becomes the pie's rotation. Because it is one curve,
 *   the wipe's finishing speed carries straight into the overshoot.
 */

interface HermiteSeg {
  kind: 'hermite';
  t0: number;
  t1: number;
  a0: number;
  a1: number;
  v0: number;
  v1: number;
  label: string;
}

interface PowerSeg {
  kind: 'power';
  t0: number;
  t1: number;
  a0: number;
  v0: number;
  v1: number;
  /** Exponent k > 1: velocity = v0 + (v1 − v0)·(τ/T)^(k−1). */
  k: number;
  label: string;
}

export type MotionSegment = HermiteSeg | PowerSeg;

export interface MotionPoint {
  t: number;
  angle: number;
  velocity: number;
}

export class MotionTrack {
  readonly segments: MotionSegment[] = [];
  readonly warnings: string[] = [];
  /** Time at which the wipe completes (mask → rotation hand-off). */
  revealEnd = Infinity;
  private origin: MotionPoint | null = null;

  /** Anchor the track. Before `t` the angle holds at `angle` (velocity 0). */
  begin(t: number, angle: number, velocity: number) {
    this.origin = { t, angle, velocity };
  }

  get end(): MotionPoint {
    const last = this.segments[this.segments.length - 1];
    if (!last) {
      if (!this.origin) throw new Error('MotionTrack: begin() must be called first');
      return this.origin;
    }
    return { t: last.t1, angle: evalSeg(last, last.t1).angle, velocity: last.v1 };
  }

  /** Cubic Hermite from the current end to (t1, a1), arriving with velocity v1 (deg/s). */
  hermiteTo(t1: number, a1: number, v1: number, label: string) {
    const e = this.end;
    if (t1 <= e.t) {
      this.warnings.push(`${label}: zero-length segment skipped`);
      return;
    }
    this.segments.push({ kind: 'hermite', t0: e.t, t1, a0: e.angle, a1, v0: e.velocity, v1, label });
  }

  /** Accelerate from the current velocity to v1 by t1 along a power curve. */
  accelerateTo(t1: number, v1: number, k: number, label: string) {
    const e = this.end;
    if (t1 <= e.t) {
      this.warnings.push(`${label}: zero-length segment skipped`);
      return;
    }
    this.segments.push({ kind: 'power', t0: e.t, t1, a0: e.angle, v0: e.velocity, v1, k, label });
  }

  /** Angle and velocity at time t. Holds before the start, cruises at constant velocity after the end. */
  sample(t: number): MotionPoint {
    if (!this.origin) return { t, angle: 0, velocity: 0 };
    if (t < this.origin.t) return { t, angle: this.origin.angle, velocity: 0 };
    // Few segments (<20): a linear scan is fastest and simplest.
    for (const s of this.segments) if (t <= s.t1) return evalSeg(s, t);
    const e = this.end;
    return { t, angle: e.angle + e.velocity * (t - e.t), velocity: e.velocity };
  }

  /** Segment boundary times, for graph ticks and continuity tests. */
  knots(): number[] {
    return this.segments.length ? [this.segments[0].t0, ...this.segments.map((s) => s.t1)] : [];
  }
}

function evalSeg(s: MotionSegment, t: number): MotionPoint {
  const T = s.t1 - s.t0;
  const p = Math.min(1, Math.max(0, (t - s.t0) / T));
  if (s.kind === 'hermite') {
    const p2 = p * p;
    const p3 = p2 * p;
    const h00 = 2 * p3 - 3 * p2 + 1;
    const h10 = p3 - 2 * p2 + p;
    const h01 = -2 * p3 + 3 * p2;
    const h11 = p3 - p2;
    const angle = h00 * s.a0 + h10 * T * s.v0 + h01 * s.a1 + h11 * T * s.v1;
    const d00 = 6 * p2 - 6 * p;
    const d10 = 3 * p2 - 4 * p + 1;
    const d01 = -6 * p2 + 6 * p;
    const d11 = 3 * p2 - 2 * p;
    const velocity = (d00 * s.a0 + d01 * s.a1) / T + d10 * s.v0 + d11 * s.v1;
    return { t, angle, velocity };
  }
  // Power segment: θ = a0 + v0·τ + (v1 − v0)·(T/k)·(τ/T)^k
  const tau = p * T;
  const angle = s.a0 + s.v0 * tau + ((s.v1 - s.v0) * T * Math.pow(p, s.k)) / s.k;
  const velocity = s.v0 + (s.v1 - s.v0) * Math.pow(p, s.k - 1);
  return { t, angle, velocity };
}
