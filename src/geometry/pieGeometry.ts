import { PALETTE } from '../config/palette';

/**
 * Pie chart geometry reconstructed from references/piechart-for-diwali-gif.png
 * (1920×1080). Values were measured from the pixels and then validated by
 * rasterising this exact model and diffing it against the reference:
 * 1 mismatching pixel out of ~174k solid pixels.
 *
 * Angle convention used throughout the project ("clock angle"):
 *   0° = 3 o'clock, angles increase CLOCKWISE on screen, 270° = 12 o'clock.
 *
 * Each sector is an "inset wedge": the true wedge [start, end] shrunk by
 * gap/2 on both straight edges, which yields constant-width gaps and the
 * pushed-out apexes visible in the reference (most obvious on the thin slice).
 */
export const PIE_REFERENCE = {
  frameWidth: 1920,
  frameHeight: 1080,
  cx: 960,
  cy: 540,
  radius: 195,
  gap: 13,
} as const;

export interface PieSector {
  /** Index in clockwise order starting at 3 o'clock. Also the reveal order. */
  index: number;
  startDeg: number;
  endDeg: number;
  color: string;
}

/** Boundary angles (clock degrees). Five sectors; orange (270°→360°) is last. */
const BOUNDARIES_DEG = [0, 112, 133.9, 201.3, 270, 360] as const;
const SECTOR_COLORS = [PALETTE.white, PALETTE.white, PALETTE.white, PALETTE.white, PALETTE.orange];

export const PIE_SECTORS: readonly PieSector[] = SECTOR_COLORS.map((color, index) => ({
  index,
  startDeg: BOUNDARIES_DEG[index],
  endDeg: BOUNDARIES_DEG[index + 1],
  color,
}));

/** Gap width as a fraction of the radius (resolution independent). */
export const PIE_GAP_RATIO = PIE_REFERENCE.gap / PIE_REFERENCE.radius;

/**
 * Pie radius in world units. The scene is set up so the full frame height
 * spans 2 world units at z = 0 (see scene/StageCanvas.tsx), so the pie keeps
 * the same proportion of frame height as in the reference at any resolution.
 */
export const PIE_RADIUS_WORLD = PIE_REFERENCE.radius / (PIE_REFERENCE.frameHeight / 2);

export const DEG = Math.PI / 180;

export interface WedgeOutline {
  apex: [number, number];
  arcStart: [number, number];
  arcEnd: [number, number];
  largeArc: boolean;
}

/**
 * Exact outline of an inset wedge in a y-down coordinate system centred on
 * (cx, cy). Shared by the SVG overlay; the GLSL shader evaluates the same
 * half-plane construction per pixel.
 */
export function insetWedge(
  sector: PieSector,
  cx: number,
  cy: number,
  r: number,
  gap: number,
): WedgeOutline {
  const a0 = sector.startDeg * DEG;
  const a1 = sector.endDeg * DEG;
  const d = gap / 2;
  const half = (a1 - a0) / 2;
  // Apex: intersection of the two edge lines offset inward by d.
  const apexDist = d / Math.sin(half);
  const bis = a0 + half;
  // Where each offset edge meets the circle.
  const edgeShift = Math.asin(d / r);
  const s = a0 + edgeShift;
  const e = a1 - edgeShift;
  return {
    apex: [cx + apexDist * Math.cos(bis), cy + apexDist * Math.sin(bis)],
    arcStart: [cx + r * Math.cos(s), cy + r * Math.sin(s)],
    arcEnd: [cx + r * Math.cos(e), cy + r * Math.sin(e)],
    largeArc: e - s > Math.PI,
  };
}

/** SVG path `d` for one sector (sweep-flag 1 = clockwise in y-down SVG space). */
export function sectorSvgPath(
  sector: PieSector,
  cx = PIE_REFERENCE.cx,
  cy = PIE_REFERENCE.cy,
  r = PIE_REFERENCE.radius,
  gap = PIE_REFERENCE.gap,
): string {
  const w = insetWedge(sector, cx, cy, r, gap);
  const f = (n: number) => n.toFixed(3);
  return [
    `M ${f(w.apex[0])} ${f(w.apex[1])}`,
    `L ${f(w.arcStart[0])} ${f(w.arcStart[1])}`,
    `A ${r} ${r} 0 ${w.largeArc ? 1 : 0} 1 ${f(w.arcEnd[0])} ${f(w.arcEnd[1])}`,
    'Z',
  ].join(' ');
}
