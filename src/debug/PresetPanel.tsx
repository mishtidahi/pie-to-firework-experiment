import { useMemo, useRef, useState } from 'react';
import type { Params } from '../config/params';
import {
  PRESET_NAME_PATTERN,
  PROTECTED_PRESETS,
  createPreset,
  presetFingerprint,
  sameAnimationParams,
  serializePreset,
  validatePreset,
} from '../config/preset';
import { BUNDLED_PRESETS, urlForPreset, type ResolvedPreset } from '../config/presetRegistry';
import { clearDraft, type Draft } from './drafts';

type Resolved = Extract<ResolvedPreset, { ok: true }>;

interface Props {
  resolved: Resolved;
  params: Params;
  onApply: (params: Params) => void;
  pendingDraft: Draft | null;
  onDraftDecision: (restore: boolean) => void;
}

/** Navigate so the URL (the source of truth) selects the configuration. Reloads even for hash-only changes. */
function navigate(relative: string) {
  const next = new URL(relative, window.location.href);
  const sameDoc = next.origin + next.pathname + next.search === window.location.origin + window.location.pathname + window.location.search;
  window.location.assign(next.href);
  if (sameDoc) window.location.reload();
}

function download(filename: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function PresetPanel({ resolved, params, onApply, pendingDraft, onDraftDecision }: Props) {
  const base = resolved.preset;
  const bundledName = resolved.source.kind === 'bundled' ? resolved.source.name : undefined;
  const modified = !sameAnimationParams(base.params, params);
  const currentFp = useMemo(() => presetFingerprint(params), [params]);
  const [name, setName] = useState(bundledName === 'default' ? 'custom' : base.name);
  const [selected, setSelected] = useState(bundledName ?? 'default');
  const [overwrite, setOverwrite] = useState(false);
  const [messages, setMessages] = useState<{ kind: 'error' | 'ok'; lines: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const nameValid = PRESET_NAME_PATTERN.test(name);
  const currentPreset = () => createPreset(name, params, base.description, new Date().toISOString());
  const playerTarget = () => (modified || !bundledName ? { preset: currentPreset() } : { preset: base, bundledName });

  const onImport = async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessages({ kind: 'error', lines: [`${file.name}: not valid JSON.`] });
      return;
    }
    const v = validatePreset(json);
    if (!v.ok) {
      setMessages({ kind: 'error', lines: [`${file.name} was rejected:`, ...v.errors] });
      return;
    }
    navigate(urlForPreset({ preset: v.preset }, 'workbench'));
  };

  const onSaveToProject = async () => {
    const res = await fetch('/__presets/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: currentPreset(), overwrite }),
    });
    const body = await res.json().catch(() => ({ errors: [`HTTP ${res.status}`] }));
    if (!res.ok) {
      setMessages({ kind: 'error', lines: body.errors ?? [`Save failed (HTTP ${res.status}).`] });
      return;
    }
    clearDraft();
    navigate(urlForPreset({ preset: currentPreset(), bundledName: name }, 'workbench'));
  };

  const sourceLabel =
    resolved.source.kind === 'inline'
      ? 'inline (#preset= link or imported file)'
      : `${resolved.source.file}${resolved.source.explicit ? '' : ' (no preset in URL)'}`;

  return (
    <section className="preset-panel">
      <h3>Preset</h3>
      <dl className="readout">
        <div>
          <dt>Active</dt>
          <dd data-testid="preset-name">
            {base.name}
            {modified && <span className="tag modified">modified</span>}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd className="small">{sourceLabel}</dd>
        </div>
        <div>
          <dt>Fingerprint</dt>
          <dd data-testid="preset-fingerprint">{modified ? `${currentFp} (base ${resolved.fingerprint})` : resolved.fingerprint}</dd>
        </div>
      </dl>

      {pendingDraft && (
        <div className="draft-banner">
          <span>Unsaved edits to “{pendingDraft.baseName}” from {new Date(pendingDraft.savedAt).toLocaleString()}.</span>
          <span>
            <button onClick={() => onDraftDecision(true)}>Restore</button>
            <button onClick={() => onDraftDecision(false)}>Discard</button>
          </span>
        </div>
      )}

      <div className="preset-row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Repository presets">
          {[...BUNDLED_PRESETS.values()].map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.validation.ok ? '' : ' (invalid)'}
            </option>
          ))}
        </select>
        <button onClick={() => navigate(urlForPreset({ preset: base, bundledName: selected }, 'workbench'))}>Load</button>
        <button onClick={() => onApply({ ...params, ...base.params })} disabled={!modified} title="Discard edits">
          Revert
        </button>
      </div>

      <label className="param">
        <span className="param-label">Name for export / save</span>
        <input
          className={`text ${nameValid ? '' : 'invalid'}`}
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          spellCheck={false}
        />
      </label>
      <div className="preset-row">
        <button disabled={!nameValid} onClick={() => download(`${name}.json`, serializePreset(currentPreset()))}>Export JSON</button>
        <button onClick={() => fileInput.current?.click()}>Import JSON…</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="preset-import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onImport(f);
          }}
        />
      </div>
      {import.meta.env.DEV && (
        <div className="preset-row">
          <button
            disabled={!nameValid || (PROTECTED_PRESETS as readonly string[]).includes(name)}
            onClick={() => void onSaveToProject()}
            title={`Writes presets/${name}.json in the repository (dev server only)`}
          >
            Save to project
          </button>
          <label className="inline small">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            overwrite existing
          </label>
        </div>
      )}
      <div className="preset-row">
        <button onClick={() => window.open(urlForPreset(playerTarget(), 'player'), '_blank')}>Open in player</button>
        <button
          onClick={() => {
            const link = new URL(urlForPreset(playerTarget(), 'player'), window.location.href).href;
            void navigator.clipboard?.writeText(link).then(
              () => setMessages({ kind: 'ok', lines: ['Player link copied.'] }),
              () => setMessages({ kind: 'ok', lines: [link] }),
            );
          }}
        >
          Copy player link
        </button>
      </div>
      {messages && (
        <div className={messages.kind === 'error' ? 'preset-errors' : 'preset-ok'} data-testid="preset-messages">
          {messages.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
    </section>
  );
}
