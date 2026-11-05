import { useEffect, useState, type CSSProperties } from 'react';
import { aspectRatio, defaultParams, sanitizeParams, type Params } from './config/params';
import { DEFAULT_INSPECTION, InspectionOverlay, type InspectionSettings } from './debug/InspectionOverlay';
import { InspectionControls } from './debug/InspectionControls';
import { MotionReadout } from './debug/MotionReadout';
import { ParamPanel } from './debug/ParamPanel';
import { PhaseList } from './debug/PhaseList';
import { Transport } from './debug/Transport';
import { PHASES } from './phases';
import { StageCanvas } from './scene/StageCanvas';
import { AnimationEngine } from './timeline/engine';
import { EngineProvider, useEngine, useEngineBuild, useEngineSnapshot } from './timeline/EngineContext';

const STORAGE_KEY = 'pie-firework:params:v3'; // bump when defaults change meaningfully

/**
 * `?debug=0` → standalone player: stage only, default params, autoplay.
 * `&loop=1` loops it. Anything else → the debug workbench.
 */
const query = new URLSearchParams(window.location.search);
const PLAYER_MODE = query.get('debug') === '0';

function loadParams(): Params {
  if (PLAYER_MODE) return defaultParams();
  try {
    return sanitizeParams(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultParams();
  }
}

declare global {
  interface Window {
    /** Exposed for console inspection and (build phase 4) export automation. */
    __pieFirework?: AnimationEngine;
  }
}

export default function App() {
  const [engine] = useState(() => new AnimationEngine(loadParams()));

  useEffect(() => {
    window.__pieFirework = engine;
    if (PLAYER_MODE) {
      engine.setLoop(query.get('loop') === '1');
      engine.play();
    }
    // The engine lives for the whole app lifetime. No dispose here: StrictMode
    // runs effects twice in dev and would kill the timeline.
    return () => {
      delete window.__pieFirework;
    };
  }, [engine]);

  return (
    <EngineProvider engine={engine}>{PLAYER_MODE ? <Player /> : <Workbench />}</EngineProvider>
  );
}

function Stage({ inspection }: { inspection?: InspectionSettings }) {
  // Rebuild-only subscription: the stage must not re-render on every timeline tick.
  const { params } = useEngineBuild();
  const ar = aspectRatio(params);
  return (
    <div className="stage-host">
      <div className="stage" style={{ '--ar': ar } as CSSProperties}>
        <StageCanvas />
        {inspection && <InspectionOverlay settings={inspection} aspect={ar} />}
      </div>
    </div>
  );
}

function Player() {
  return (
    <div className="player">
      <Stage />
    </div>
  );
}

function Workbench() {
  const engine = useEngine();
  const { params } = useEngineSnapshot();
  const [inspection, setInspection] = useState<InspectionSettings>(DEFAULT_INSPECTION);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  }, [params]);

  useKeyboardShortcuts(engine);

  return (
    <div className="workbench">
      <main className="viewer">
        <Stage inspection={inspection} />
        <Transport />
      </main>
      <aside className="panel">
        <header>
          <h2>Pie → Firework</h2>
          <p className="dim">Build phase 3 · blur, ground spinner, 3D expansion &amp; final yellow</p>
        </header>
        <PhaseList />
        <MotionReadout />
        <InspectionControls value={inspection} onChange={setInspection} />
        <ParamPanel params={params} onChange={engine.setParams} onReset={() => engine.setParams(defaultParams())} />
        <section className="dim small">
          Keys: Space play/pause · ←/→ frame (Shift ×10) · Home restart · 1–{PHASES.length} jump to phase
        </section>
      </aside>
    </div>
  );
}

function useKeyboardShortcuts(engine: AnimationEngine) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea')) return;
      if (e.code === 'Space') engine.toggle();
      else if (e.key === 'ArrowLeft') engine.stepFrames(e.shiftKey ? -10 : -1);
      else if (e.key === 'ArrowRight') engine.stepFrames(e.shiftKey ? 10 : 1);
      else if (e.key === 'Home') engine.restart();
      else if (/^[1-9]$/.test(e.key) && PHASES[Number(e.key) - 1]) engine.jumpToPhase(PHASES[Number(e.key) - 1].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}
