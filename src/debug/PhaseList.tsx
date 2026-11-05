import { useEngine, useEngineSnapshot } from '../timeline/EngineContext';

/** Phase-jump buttons with live per-phase progress read from the anim state. */
export function PhaseList() {
  const engine = useEngine();
  const snap = useEngineSnapshot();
  return (
    <section>
      <h3>Phases</h3>
      <ol className="phase-list">
        {snap.schedule.map((s, i) => (
          <li key={s.id}>
            <button
              className={i === snap.phaseIndex ? 'active' : ''}
              onClick={() => engine.jumpToPhase(s.id)}
              title={`Jump (key ${i + 1})`}
            >
              <span className="phase-name">
                {i + 1}. {s.label}
              </span>
              <span className="dim">{s.start.toFixed(2)}s</span>
              <span className="bar">
                <span style={{ width: `${engine.state.phase[s.id] * 100}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
