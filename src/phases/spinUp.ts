import type { PhaseModule } from './types';

/** Each successive rev pulse is this fraction of the previous one's duration (revs quicken). */
const PULSE_TIME_RATIO = 0.8;
/** Share of a pulse spent on the clockwise jab (the rest is the slower pull-back). */
const JAB_SHARE = 0.4;

/**
 * Revving, then accelerating clockwise spin.
 *
 * From the recoil's anticlockwise turning point, the pie revs: N clockwise
 * jabs of growing amplitude, each followed by a pull-back that winds a little
 * deeper anticlockwise, which is the wind-up. From the deepest point it
 * launches clockwise on a power curve, ω(τ) = ωmax·(τ/T)^(k−1). That starts
 * from rest, so it joins the turning point with no velocity jump, and reaches
 * max speed exactly at the end of the phase. Afterwards the track cruises at
 * ωmax (later phases build on that).
 *
 * Every junction between segments is either velocity-matched or a genuine
 * direction reversal, so there are no unintended stops.
 */
export const spinUpPhase: PhaseModule = {
  id: 'spinUp',
  label: 'Rev + spin-up',
  durationKey: 'durSpinUp',
  build({ params, start, duration, motion }) {
    const end = start + duration;
    const pulses = Math.round(params.revPulses as number);
    const amp = params.revAmplitudeDeg as number;
    const windUp = params.windUpDeg as number;
    const hasRevs = pulses > 0 && amp > 0;

    if (hasRevs) {
      const revTime = duration * (params.revShare as number);
      const weights = Array.from({ length: pulses }, (_, i) => Math.pow(PULSE_TIME_RATIO, i));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const rest = motion.end.angle; // recoil turning point
      let t = motion.end.t;
      let trough = rest;
      for (let i = 0; i < pulses; i++) {
        const pulseTime = (revTime * weights[i]) / weightSum;
        const jab = amp * (0.6 + (0.4 * (i + 1)) / pulses); // revs build in strength
        const nextTrough = rest - (windUp * (i + 1)) / pulses;
        motion.hermiteTo(t + pulseTime * JAB_SHARE, trough + jab, 0, `rev ${i + 1} jab`);
        t += pulseTime;
        motion.hermiteTo(t, nextTrough, 0, `rev ${i + 1} pull-back`);
        trough = nextTrough;
      }
    } else if (windUp > 0) {
      motion.warnings.push('Wind-up depth has no effect without rev pulses');
    }

    const maxSpeed = (params.spinMaxSpeed as number) * 360; // deg/s
    motion.accelerateTo(end, maxSpeed, params.spinAccelPower as number, 'launch');
  },
};
