import type { InspectionSettings, ReferenceMode } from './InspectionOverlay';

export function InspectionControls({
  value,
  onChange,
}: {
  value: InspectionSettings;
  onChange: (v: InspectionSettings) => void;
}) {
  return (
    <section>
      <h3>Inspection</h3>
      <label className="param">
        <span className="param-label">Reference image</span>
        <select value={value.reference} onChange={(e) => onChange({ ...value, reference: e.target.value as ReferenceMode })}>
          <option value="off">Off</option>
          <option value="overlay">Overlay</option>
          <option value="difference">Difference (black = match)</option>
        </select>
      </label>
      {value.reference === 'overlay' && (
        <label className="param">
          <span className="param-label">Reference opacity</span>
          <span className="param-input">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value.referenceOpacity}
              onChange={(e) => onChange({ ...value, referenceOpacity: Number(e.target.value) })}
            />
            <span className="param-value">{value.referenceOpacity.toFixed(2)}</span>
          </span>
        </label>
      )}
      <label className="param checkbox">
        <input type="checkbox" checked={value.outline} onChange={(e) => onChange({ ...value, outline: e.target.checked })} />
        <span className="param-label">SVG geometry outline</span>
      </label>
    </section>
  );
}
