import { useMemo } from 'react';
import type { MotionTrack } from '../motion/MotionTrack';

const SAMPLES = 600;

/**
 * Sweep velocity over the whole timeline, drawn behind the scrubber so it
 * shares the scrubber's time axis. Uses a signed square-root scale so the
 * small recoil and rev wiggles stay visible next to full spin speed.
 * Above the centre line = clockwise, below = anticlockwise.
 */
export function MotionGraph({ motion, duration }: { motion: MotionTrack; duration: number }) {
  const { path, knots, handoff, peak } = useMemo(() => {
    const pts: [number, number][] = [];
    let peak = 1e-6;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * duration;
      const v = motion.sample(t).velocity / 360; // rev/s
      peak = Math.max(peak, Math.abs(v));
      pts.push([t, v]);
    }
    const y = (v: number) => 50 - 44 * Math.sign(v) * Math.sqrt(Math.abs(v) / peak);
    const path = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${((t / duration) * 1000).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
    return {
      path,
      peak,
      knots: motion.knots().map((t) => (t / duration) * 1000),
      handoff: Number.isFinite(motion.revealEnd) ? (motion.revealEnd / duration) * 1000 : null,
    };
  }, [motion, duration]);

  return (
    <svg className="motion-graph" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
      <line x1={0} x2={1000} y1={50} y2={50} className="mg-zero" />
      {knots.map((x, i) => (
        <line key={i} x1={x} x2={x} y1={44} y2={56} className="mg-knot" />
      ))}
      {handoff !== null && <line x1={handoff} x2={handoff} y1={0} y2={100} className="mg-handoff" />}
      <path d={path} className="mg-velocity" />
      <text x={996} y={97} className="mg-label" textAnchor="end">
        sweep velocity · √ scale · peak {peak.toFixed(1)} rev/s
      </text>
    </svg>
  );
}
