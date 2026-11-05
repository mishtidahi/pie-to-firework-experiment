import { discColour, rgbToHex } from '../effects/look';
import { coverageRatio, tiltAngle } from '../geometry/projection';
import { useEngine, useEngineSnapshot } from '../timeline/EngineContext';

/** Live motion values plus any warnings raised while building the motion track. */
export function MotionReadout() {
  const engine = useEngine();
  const snap = useEngineSnapshot();
  const s = engine.state;
  const segment = snap.motion.segments.find((seg) => snap.time >= seg.t0 && snap.time <= seg.t1);
  const rows: [string, string][] = [
    ['Wipe', `${(s.reveal * 100).toFixed(1)}%`],
    ['Rotation', `${s.rotationDeg.toFixed(2)}°`],
    ['Angular velocity', `${s.angularVelocity.toFixed(3)} rev/s`],
    ['Sweep velocity', `${(s.sweepVelocity / 360).toFixed(3)} rev/s`],
    ['Segment', segment?.label ?? (snap.time < (snap.motion.knots()[0] ?? 0) ? 'before wipe' : 'cruise')],
    ['Blur → smooth', `${(s.blurMix * 100).toFixed(0)}%`],
    ['Disc colour', `${rgbToHex(discColour(snap.params, s.goldMix))} (mix ${(s.discMix * 100).toFixed(0)}%)`],
    ['Fire / energy', `${s.fire.toFixed(2)} / ${s.energy.toFixed(2)}`],
    ['Tilt', `${(-tiltAngle(snap.params, s.tilt) * 180 / Math.PI).toFixed(1)}°`],
    ['Scale', `${Math.exp(s.expandLog).toFixed(2)}×`],
    ['Corner coverage', s.finalFill >= 0.5 ? 'final fill' : `${(coverageRatio(snap.params, s.tilt, s.camera, Math.exp(s.expandLog)) * 100).toFixed(0)}%`],
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
