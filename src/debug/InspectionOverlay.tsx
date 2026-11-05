import referenceUrl from '../../references/piechart-for-diwali-gif.png';
import { PIE_REFERENCE, PIE_SECTORS, sectorSvgPath } from '../geometry/pieGeometry';

export type ReferenceMode = 'off' | 'overlay' | 'difference';

export interface InspectionSettings {
  reference: ReferenceMode;
  referenceOpacity: number;
  outline: boolean;
}

export const DEFAULT_INSPECTION: InspectionSettings = {
  reference: 'off',
  referenceOpacity: 0.5,
  outline: false,
};

/**
 * Layers drawn over the WebGL canvas for checking geometry accuracy:
 *  - the reference PNG (plain overlay, or `difference` blend: pixels that
 *    match turn black, so any misalignment shows up as bright fringes)
 *  - an exact SVG outline built from the same geometry module.
 * Both are positioned in reference-pixel space, centred and scaled to frame
 * height, so they also line up at non-16:9 aspect ratios.
 */
export function InspectionOverlay({ settings, aspect }: { settings: InspectionSettings; aspect: number }) {
  const { frameHeight, cx, cy, radius } = PIE_REFERENCE;
  const viewW = frameHeight * aspect;
  const viewBox = `${cx - viewW / 2} 0 ${viewW} ${frameHeight}`;

  return (
    <div className="inspection" aria-hidden>
      {settings.reference !== 'off' && (
        <img
          className="inspection-ref"
          src={referenceUrl}
          alt=""
          style={{
            opacity: settings.reference === 'difference' ? 1 : settings.referenceOpacity,
            mixBlendMode: settings.reference === 'difference' ? 'difference' : 'normal',
          }}
        />
      )}
      {settings.outline && (
        <svg className="inspection-svg" viewBox={viewBox} preserveAspectRatio="none">
          <g fill="none" stroke="#00ff9c" strokeWidth={1} vectorEffect="non-scaling-stroke">
            {PIE_SECTORS.map((s) => (
              <path key={s.index} d={sectorSvgPath(s)} vectorEffect="non-scaling-stroke" />
            ))}
            <circle cx={cx} cy={cy} r={radius} strokeDasharray="4 4" opacity={0.5} vectorEffect="non-scaling-stroke" />
            <path d={`M ${cx - 12} ${cy} H ${cx + 12} M ${cx} ${cy - 12} V ${cy + 12}`} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
      )}
    </div>
  );
}
