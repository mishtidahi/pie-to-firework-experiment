import { useRef } from 'react';
import { useEngine, useEngineSnapshot } from '../timeline/EngineContext';
import { MotionGraph } from './MotionGraph';

const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];

/** Play/Pause/Restart, frame stepping, speed, loop and the phase-segmented scrubber. */
export function Transport() {
  const engine = useEngine();
  const snap = useEngineSnapshot();
  const fps = snap.params.exportFps as number;
  const frame = Math.round(snap.time * fps);
  const totalFrames = Math.round(snap.duration * fps);

  return (
    <div className="transport">
      <div className="transport-row">
        <button onClick={engine.toggle} className="primary" title="Space">
          {snap.playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={engine.restart} title="Home">Restart</button>
        <button onClick={() => engine.stepFrames(-1)} title="← (Shift = 10 frames)">◀ Frame</button>
        <button onClick={() => engine.stepFrames(1)} title="→ (Shift = 10 frames)">Frame ▶</button>
        <span className="timecode">
          {snap.time.toFixed(3)}s / {snap.duration.toFixed(3)}s
          <span className="dim">
            {' '}· frame {frame}/{totalFrames} @{fps}
          </span>
        </span>
        <span className="spacer" />
        <label className="inline">
          Speed
          <select value={snap.speed} onChange={(e) => engine.setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={snap.loop} onChange={(e) => engine.setLoop(e.target.checked)} />
          Loop
        </label>
      </div>
      <Scrubber />
    </div>
  );
}

function Scrubber() {
  const engine = useEngine();
  const snap = useEngineSnapshot();
  const trackRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef(false);
  const pct = (t: number) => `${(t / snap.duration) * 100}%`;

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * snap.duration;
  };

  return (
    <div
      className="scrubber"
      ref={trackRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        resumeRef.current = snap.playing;
        engine.pause();
        engine.seek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) engine.seek(timeAt(e.clientX));
      }}
      onPointerUp={() => {
        if (resumeRef.current) engine.play();
      }}
    >
      <MotionGraph motion={snap.motion} duration={snap.duration} />
      {snap.schedule.map((s, i) => (
        <div
          key={s.id}
          className={`segment ${i === snap.phaseIndex ? 'active' : ''}`}
          style={{ left: pct(s.start), width: pct(s.end - s.start) }}
          title={`${i + 1}. ${s.label} (${s.start.toFixed(2)}–${s.end.toFixed(2)}s)`}
        >
          <span>{i + 1}</span>
        </div>
      ))}
      <div className="playhead" style={{ left: pct(snap.time) }} />
    </div>
  );
}
