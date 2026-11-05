import type { Params } from '../config/params';
import { PALETTE, hexToRgb01 } from '../config/palette';

export type RGB = [number, number, number];

export const BLUE = hexToRgb01(PALETTE.blue);
export const WHITE = hexToRgb01(PALETTE.white);
export const ORANGE = hexToRgb01(PALETTE.orange);
export const YELLOW = hexToRgb01(PALETTE.yellow);

export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Hot highlight for sparks, rim and energy streaks: palette yellow lifted toward palette white. */
export const HOT: RGB = mixRgb(YELLOW, [1, 1, 1], 0.55);

/**
 * The deliberate colour path for the disc. Averaging the mostly white sectors
 * would give a pale, slightly bluish grey, so the sectors are instead recoloured
 * toward a palette-derived light orange while the blur hides them, and that
 * disc colour then moves to golden #ffde59 during ignition.
 */
export function lightOrange(params: Params): RGB {
  return mixRgb(WHITE, ORANGE, params.discOrange as number);
}

export function discColour(params: Params, goldMix: number): RGB {
  return mixRgb(lightOrange(params), YELLOW, goldMix);
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
