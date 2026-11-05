import { useEffect, useState, type CSSProperties } from 'react';
import { aspectRatio, defaultParams, type Params } from './config/params';
import { paramsFromPreset, sameAnimationParams, type Preset } from './config/preset';
import { resolvePresetFromUrl, type ResolvedPreset } from './config/presetRegistry';
import { migrateLegacyParams, readDraft, writeDraft, type Draft } from './debug/drafts';
import { DEFAULT_INSPECTION, InspectionOverlay, type InspectionSettings } from './debug/InspectionOverlay';
import { InspectionControls } from './debug/InspectionControls';
import { MotionReadout } from './debug/MotionReadout';
import { ParamPanel } from './debug/ParamPanel';
import { PhaseList } from './debug/PhaseList';
import { PresetPanel } from './debug/PresetPanel';
import { Transport } from './debug/Transport';
import { PHASES } from './phases';
import { StageCanvas } from './scene/StageCanvas';
import { AnimationEngine } from './timeline/engine';
import { EngineProvider, useEngine, useEngineBuild, useEngineSnapshot } from './timeline/EngineContext';

/**
 * URL contract (identical for the workbench, the player and Phase 4 export):
 *   ?debug=0           standalone player (stage only); otherwise the workbench
 *   ?preset=<name>     presets/<name>.json     #preset=<base64url>  inline preset
 *   &fp=<fingerprint>  pin the configuration    &autoplay=0  player starts paused
 *   &loop=1            player loops
 * The animation configuration comes only from the URL (see config/presetRegistry.ts).
 */
const query = new URLSearchParams(window.location.search);
const PLAYER_MODE = query.get('debug') === '0';
const AUTOPLAY = query.get('autoplay') !== '0';
const RESOLVED = resolvePresetFromUrl(window.location.href);

type Resolved = Extract<ResolvedPreset, { ok: true }>;

declare global {
  interface Window {
    /** Exposed for console inspection and export automation. */
    __pieFirework?: AnimationEngine;
    /** The resolved preset this page was started with (for automation to assert against). */
    __pieFireworkPreset?: { name: string; source: Resolved['source']; fingerprint: string; version: number; preset: Preset };
    /** Set when the URL's preset could not be resolved. */
    __pieFireworkPresetError?: { title: string; errors: string[] };
  }
}

export default function App() {
  if (!RESOLVED.ok) return <PresetError title={RESOLVED.title} errors={RESOLVED.errors} />;
  return <ResolvedApp resolved={RESOLVED} />;
}

function ResolvedApp({ resolved }: { resolved: Resolved }) {
  const [engine] = useState(() => new AnimationEngine(paramsFromPreset(resolved.preset)));

  useEffect(() => {
    window.__pieFirework = engine;
    window.__pieFireworkPreset = {
      name: resolved.preset.name,
      source: resolved.source,
      fingerprint: resolved.fingerprint,
      version: resolved.preset.version,
      preset: resolved.preset,
    };
    if (PLAYER_MODE) {
      engine.setLoop(query.get('loop') === '1');
      if (AUTOPLAY) engine.play();
    }
    // The engine lives for the whole app lifetime. No dispose here: StrictMode
    // runs effects twice in dev and would kill the timeline.
    return () => {
      delete window.__pieFirework;
      delete window.__pieFireworkPreset;
    };
  }, [engine, resolved]);

  return (
    <EngineProvider engine={engine}>{PLAYER_MODE ? <Player /> : <Workbench resolved={resolved} />}</EngineProvider>
  );
}

/** Explicit failure: a requested preset is never silently replaced by the default. */
function PresetError({ title, errors }: { title: string; errors: string[] }) {
  useEffect(() => {
    window.__pieFireworkPresetError = { title, errors };
  }, [title, errors]);
  return (
    <div className="preset-error-screen" role="alert">
      <h1>{title}</h1>
      <ul>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="dim">
        Nothing was rendered. <a href={PLAYER_MODE ? './?debug=0' : './'}>Open the default preset</a> instead.
      </p>
    </div>
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

function Workbench({ resolved }: { resolved: Resolved }) {
  const engine = useEngine();
  const { params } = useEngineSnapshot();
  const [inspection, setInspection] = useState<InspectionSettings>(DEFAULT_INSPECTION);
  const [base] = useState(() => ({
    fingerprint: resolved.fingerprint,
    name: resolved.preset.name,
    params: paramsFromPreset(resolved.preset),
  }));

  // Drafts: unsaved edits survive a reload, but are applied only when the user restores them.
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(() => {
    if (resolved.source.kind === 'bundled' && resolved.source.name === 'default') migrateLegacyParams(base);
    const d = readDraft();
    const differs = d !== null && (!sameAnimationParams(d.params, base.params) || d.params.exportFps !== base.params.exportFps);
    return d !== null && differs && d.baseFingerprint === resolved.fingerprint && d.baseName === resolved.preset.name ? d : null;
  });
  useEffect(() => {
    if (!pendingDraft) writeDraft(base, params);
  }, [base, params, pendingDraft]);
  const onDraftDecision = (restore: boolean) => {
    if (restore && pendingDraft) engine.setParams(pendingDraft.params);
    setPendingDraft(null);
  };

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
        <PresetPanel
          resolved={resolved}
          params={params}
          onApply={engine.setParams}
          pendingDraft={pendingDraft}
          onDraftDecision={onDraftDecision}
        />
        <PhaseList />
        <MotionReadout />
        <InspectionControls value={inspection} onChange={setInspection} />
        <ParamPanel
          params={params}
          onChange={engine.setParams}
          onReset={() => engine.setParams({ ...defaultParams(), exportFps: params.exportFps } as Params)}
        />
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
