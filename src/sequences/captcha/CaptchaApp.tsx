import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_CAPTCHA_PRESET, captchaAspectRatio, captchaFingerprint, validateCaptchaPreset, type CaptchaPreset } from './config';
import { drawFrame } from './draw/frame';
import { CaptchaEngine } from './engine';

/**
 * Entry for the "Select Joy" CAPTCHA sequence (?scene=captcha). Same URL
 * contract as the spinner where it applies:
 *   ?scene=captcha&preset=<name>   presets/captcha/<name>.json (default captcha-4s-portrait)
 *   &fp=<fingerprint>  pin   &debug=0  stage only   &autoplay=0  start paused   &loop=1
 */
const files = import.meta.glob('../../../presets/captcha/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const query = new URLSearchParams(window.location.search);
const PLAYER_MODE = query.get('debug') === '0';

type Resolved = { ok: true; preset: CaptchaPreset; fingerprint: string } | { ok: false; title: string; errors: string[] };

function resolve(): Resolved {
  const name = query.get('preset') ?? DEFAULT_CAPTCHA_PRESET;
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`));
  if (!entry) return { ok: false, title: `CAPTCHA preset "${name}" not found`, errors: [`Looked for presets/captcha/${name}.json.`] };
  const v = validateCaptchaPreset(entry[1]);
  if (!v.ok) return { ok: false, title: `CAPTCHA preset "${name}" is invalid`, errors: v.errors };
  const fingerprint = captchaFingerprint(v.preset.params);
  const pin = query.get('fp');
  if (pin !== null && pin !== fingerprint) return { ok: false, title: 'Preset fingerprint mismatch', errors: [`The URL pins ${pin}, but "${name}" has ${fingerprint}.`] };
  return { ok: true, preset: v.preset, fingerprint };
}

const RESOLVED = resolve();

/** The automation globals the exporter reads (same names as the spinner's, different engine). */
type AutomationGlobals = {
  __pieFirework?: CaptchaEngine;
  __pieFireworkPreset?: { name: string; scene: 'captcha'; fingerprint: string; version: number; preset: CaptchaPreset };
  __pieFireworkPresetError?: { title: string; errors: string[] };
};
const w = window as unknown as AutomationGlobals;

export function CaptchaApp() {
  if (!RESOLVED.ok) {
    w.__pieFireworkPresetError = { title: RESOLVED.title, errors: RESOLVED.errors };
    return (
      <div className="preset-error-screen" role="alert">
        <h1>{RESOLVED.title}</h1>
        <ul>{RESOLVED.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      </div>
    );
  }
  return <CaptchaPlayer preset={RESOLVED.preset} fingerprint={RESOLVED.fingerprint} />;
}

function CaptchaPlayer({ preset, fingerprint }: { preset: CaptchaPreset; fingerprint: string }) {
  const [engine] = useState(() => new CaptchaEngine(preset.params));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const render = () => drawFrame(ctx, canvas.width, canvas.height, preset.params, engine.state, engine.time);
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      render();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    fit();
    const off = engine.subscribe(() => {
      render();
      if (!PLAYER_MODE) setTick((n) => n + 1);
    });
    w.__pieFirework = engine;
    w.__pieFireworkPreset = { name: preset.name, scene: 'captcha', fingerprint, version: preset.version, preset };
    if (PLAYER_MODE) {
      engine.setLoop(query.get('loop') === '1');
      if (query.get('autoplay') !== '0') engine.play();
    }
    return () => {
      off();
      ro.disconnect();
      delete w.__pieFirework;
      delete w.__pieFireworkPreset;
    };
  }, [engine, preset, fingerprint]);

  const stage = (
    <div className="stage-host">
      <div className="stage" style={{ '--ar': captchaAspectRatio(preset.params) } as CSSProperties}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
  if (PLAYER_MODE) return <div className="player">{stage}</div>;
  return (
    <div className="player" style={{ flexDirection: 'column' }}>
      {stage}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 16px', color: '#ddd', font: '13px system-ui' }}>
        <button onClick={engine.toggle} style={{ minWidth: 70 }}>{engine.playing ? 'Pause' : 'Play'}</button>
        <input
          type="range"
          min={0}
          max={engine.duration}
          step={1 / 60}
          value={engine.time}
          onChange={(e) => {
            engine.pause();
            engine.seek(Number(e.target.value));
          }}
          style={{ flex: 1 }}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {engine.time.toFixed(2)} s · frame {Math.round(engine.time * 60)} / {Math.round(engine.duration * 60)} @ 60 fps
        </span>
        <span>{preset.name}</span>
      </div>
    </div>
  );
}
