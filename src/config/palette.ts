/**
 * Exact brand palette. These hex values are rendered verbatim: the Canvas is
 * configured with `legacy linear flat` so no colour management, sRGB encoding
 * or tone mapping alters them (see scene/StageCanvas.tsx).
 */
export const PALETTE = {
  blue: '#1a00d9',
  white: '#f1f1f1',
  orange: '#fc6e07',
  yellow: '#ffde59',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** '#rrggbb' → [r, g, b] in 0..1, with no colour-space conversion. */
export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
