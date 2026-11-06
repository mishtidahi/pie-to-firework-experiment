/**
 * Shared GLSL for the cel-shaded spinner (top face, side wall, particles).
 *
 * Visual language: hard tonal bands instead of gradients. Every band edge is
 * antialiased over ~1 px using screen-space derivatives, so edges stay crisp
 * but never stair-step.
 *
 * Tones are derived per pixel from the palette:
 *   light  = base mixed toward #f1f1f1     shadow = base mixed toward #fc6e07
 *   deep   = shadow mixed toward #1a00d9   hot    = #ffde59 lifted toward white
 * Light/shadow are measured *relative to the flat top plane*: the top face
 * keeps the true base colour, while bevel, dome and side wall swing into light or
 * shadow bands. As the object tilts, the side wall and bevel respond to the key
 * light, which is what makes the top and side read as separate planes.
 */
/** Vertex-safe helpers (no derivatives). */
export const celCommonGlsl = /* glsl */ `
  const float TAU = 6.28318530718;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Irregular, fast-flickering perimeter displacement in [-1, 1] (screen-frame angle).
  // Integer harmonics, so it is periodic in the angle and needs no wrapping.
  float wobbleAt(float a, float t) {
    return 0.45 * sin(13.0 * a + 29.0 * t + 1.3)
         + 0.35 * sin(23.0 * a - 41.0 * t + 0.4)
         + 0.2 * sin(37.0 * a + 61.0 * t + 2.1);
  }
`;

/** Fragment-only antialiased hard steps (use screen-space derivatives). */
export const aaGlsl = /* glsl */ `
  // Antialiased hard step with an explicit filter width.
  float aastepW(float edge, float x, float w) {
    w = max(w, 1e-5) * 0.7;
    return smoothstep(edge - w, edge + w, x);
  }
  float aastep(float edge, float x) { return aastepW(edge, x, fwidth(x)); }

  // Hard-edged band x ∈ [a, b] with an explicit filter width.
  float bandW(float x, float a, float b, float w) { return aastepW(a, x, w) * (1.0 - aastepW(b, x, w)); }
`;

/** Fragment-only cel helpers: common + AA steps + key light, palette and tone ramp. */
export const celGlsl = /* glsl */ `
  ${celCommonGlsl}
  ${aaGlsl}

  uniform vec3 uLight;          // key light direction, view space (unit)
  uniform float uBands;         // 2..4 tone bands
  uniform vec3 uPalWhite;
  uniform vec3 uPalOrange;
  uniform vec3 uPalBlue;

  // Cel ramp around a base colour. rel = N·L relative to the top plane's N·L.
  vec3 celRamp(vec3 base, float rel) {
    vec3 light = mix(base, uPalWhite, 0.5);
    vec3 shadow = mix(base, uPalOrange, 0.55);
    vec3 deep = mix(shadow, uPalBlue, 0.22);
    vec3 c = base;
    if (uBands >= 2.5) c = mix(c, light, aastep(0.1, rel));
    c = mix(c, shadow, 1.0 - aastep(-0.12, rel));
    if (uBands >= 3.5) c = mix(c, deep, 1.0 - aastep(-0.42, rel));
    return c;
  }
`;
