import { emissionRate, emissionWidth, showerStage, sparkTimes } from '../effects/emission';
import { discColour, rgbToHex } from '../effects/look';
import { coverageRatio, tiltAngle } from '../geometry/projection';
import { useEngine, useEngineSnapshot } from '../timeline/EngineContext';

/** Live motion values plus any warnings raised while building the motion track. */
export function MotionReadout() {
  const engine = useEngine();
  const snap = useEngineSnapshot();
  const s = engine.state;
  const segment = snap.motion.segments.find((seg) => snap.time >= seg.t0 && snap.time <= seg.t1);
  const T = sparkTimes(snap.params, snap.schedule);
  const sparkStage =
    snap.time < T.igniteStart ? 'not lit' : snap.time < T.showerStart ? 'ignition' : snap.time < T.showerFull ? 'expanding' : snap.time < T.fadeStart ? 'full shower' : snap.time < T.gone ? 'fading' : 'out';
  const rows: [string, string][] = [
    ['Wipe', `${(s.reveal * 100).toFixed(1)}%`],
    ['Rotation', `${s.rotationDeg.toFixed(2)}°`],
    ['Angular velocity', `${s.angularVelocity.toFixed(3)} rev/s`],
    ['Sweep velocity', `${(s.sweepVelocity / 360).toFixed(3)} rev/s`],
    ['Segment', segment?.label ?? (snap.time < (snap.motion.knots()[0] ?? 0) ? 'before wipe' : 'cruise')],
    ['Smear / morph', `${(s.smear * 100).toFixed(0)}% / ${(s.morph * 100).toFixed(0)}%`],
    ['Body / cel shade', `${(s.body * 100).toFixed(0)}% / ${(s.shade * 100).toFixed(0)}%`],
    ['Disc colour', `${rgbToHex(discColour(snap.params, s.goldMix))} (mix ${(s.discMix * 100).toFixed(0)}%)`],
    ['Fire / accents', `${s.fire.toFixed(2)} / ${s.energy.toFixed(2)}`],
    [
      'Sparks',
      sparkStage === 'not lit' || sparkStage === 'out'
        ? sparkStage
        : `${sparkStage} · ${emissionRate(snap.params, T, snap.time).toFixed(0)}/s · ${((emissionWidth(snap.params, T, snap.time) * 180) / Math.PI).toFixed(0)}° rim · stage ${(showerStage(T, snap.time) * 100).toFixed(0)}%`,
    ],
    ['Tilt', `${(-tiltAngle(snap.params, s.tilt, s.preTilt) * 180 / Math.PI).toFixed(1)}°`],
    ['Scale', `${Math.exp(s.expandLog).toFixed(2)}×`],
    ['Corner coverage', s.finalFill >= 0.5 ? 'final fill' : `${(coverageRatio(snap.params, s.tilt, s.camera, Math.exp(s.expandLog), s.preTilt) * 100).toFixed(0)}%`],
  ];
  return (
    <section>
      <h3>Motion</h3>
      <dl className="readout">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {snap.warnings.map((w) => (
        <p key={w} className="warning">
          ⚠ {w}
        </p>
      ))}
    </section>
  );
}
