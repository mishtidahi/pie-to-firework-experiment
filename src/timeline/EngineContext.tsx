import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AnimationEngine, BuildInfo, EngineSnapshot } from './engine';

const EngineContext = createContext<AnimationEngine | null>(null);

export function EngineProvider({ engine, children }: { engine: AnimationEngine; children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): AnimationEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside <EngineProvider>');
  return engine;
}

/** Re-renders only when the timeline is rebuilt (params change). Safe inside the 3D scene. */
export function useEngineBuild(): BuildInfo {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getBuild);
}

/** Re-renders on every timeline update. Use in UI only, never in the 3D scene. */
export function useEngineSnapshot(): EngineSnapshot {
  const engine = useEngine();
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
