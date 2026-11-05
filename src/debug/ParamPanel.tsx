import { PARAM_GROUPS, PARAM_SCHEMA, type ParamDef, type ParamKey, type Params } from '../config/params';

const CURRENT_BUILD_PHASE = 3;

interface Props {
  params: Params;
  onChange: (params: Params) => void;
  onReset: () => void;
}

/** Controls generated from PARAM_SCHEMA, grouped, with "not wired yet" tags. */
export function ParamPanel({ params, onChange, onReset }: Props) {
  const entries = Object.entries(PARAM_SCHEMA) as [ParamKey, ParamDef][];
  const total = entries
    .filter(([, d]) => d.group === 'Timing')
    .reduce((sum, [k]) => sum + (params[k] as number), 0);

  const set = (key: ParamKey, value: number | string) => onChange({ ...params, [key]: value } as Params);

  return (
    <section>
      <div className="section-head">
        <h3>Parameters</h3>
        <button onClick={onReset}>Reset</button>
      </div>
      {PARAM_GROUPS.map((group) => (
        <details key={group} open={group === 'Timing'}>
          <summary>
            {group}
            {group === 'Timing' && <span className="dim"> · total {total.toFixed(2)}s</span>}
          </summary>
          {entries
            .filter(([, d]) => d.group === group)
            .map(([key, def]) => (
              <ParamRow key={key} def={def} value={params[key]} onChange={(v) => set(key, v)} />
            ))}
        </details>
      ))}
    </section>
  );
}

function ParamRow({ def, value, onChange }: { def: ParamDef; value: number | string; onChange: (v: number | string) => void }) {
  const pending = def.wiredIn > CURRENT_BUILD_PHASE;
  return (
    <label className={`param ${pending ? 'pending' : ''}`} title={def.hint}>
      <span className="param-label">
        {def.label}
        {pending && <span className="tag">phase {def.wiredIn}</span>}
      </span>
      {def.kind === 'number' ? (
        <span className="param-input">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="param-value">
            {Number(value).toFixed(decimals(def.step))}
            {def.unit ?? ''}
          </span>
        </span>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
    </label>
  );
}

function decimals(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}
