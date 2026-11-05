/**
 * Analytic pie / spinner-disc renderer.
 *
 * Crisp path (Phases 1–2): each sector is the intersection of the disc and
 * two inward-offset half-planes (the same inset-wedge construction as
 * geometry/pieGeometry.ts), antialiased with the screen-space derivative of
 * the signed distance.
 *
 * Blur path (Phase 3): exact angular motion blur. At radius r an inset wedge
 * covers the angular interval [a0 + asin(d/r), a1 − asin(d/r)]. The colour a
 * pixel sees while the pie sweeps through a window of W radians is the
 * overlap of each interval with [φ − W/2, φ + W/2], divided by W. This is a
 * closed-form integral: no samples, no frame accumulation, no noise, and the
 * result depends only on the current rotation and window, so it is identical
 * under scrubbing and at any frame rate. As W → 2π the sectors merge into
 * their radial average. The two paths blend by the blur length in pixels,
 * so zero blur reproduces the Phase 2 output exactly.
 *
 * `vPie` is in pie-radius units (the rig scales the mesh). Flipping y gives
 * "clock space", where angles increase clockwise from 3 o'clock.
 */
export const SECTOR_COUNT = 5;

/** Plane half-size in pie radii: room for perimeter wobble and the outer glow. */
export const DISC_PLANE_HALF = 1.7;

export const pieVertexShader = /* glsl */ `
  varying vec2 vPie;
  void main() {
    vPie = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const pieFragmentShader = /* glsl */ `
  #define SECTORS ${SECTOR_COUNT}
  uniform float uStart[SECTORS];   // radians, clock angle
  uniform float uEnd[SECTORS];
  uniform vec3 uColor[SECTORS];    // raw sRGB 0..1
  uniform float uHalfGap;          // radius units
  uniform float uReveal;           // 0..1 radial wipe, clockwise from 3 o'clock
  uniform float uBlur;             // angular blur window W (radians); 0 = crisp
  uniform vec3 uDiscColor;         // light orange → gold
  uniform float uDiscMix;          // sector colours → disc colour
  uniform float uRotation;         // body rotation (rad, clock), wrapped to [0, 2π)
  uniform float uJitter;           // rotational instability (rad)
  uniform float uTime;             // timeline seconds
  uniform float uEnergy;           // clockwise rim light streaks
  uniform float uWobble;           // perimeter instability amplitude (radius units)
  uniform float uGlow;             // rim highlight + outer glow
  uniform vec3 uHot;               // highlight colour
  uniform vec3 uDeep;              // deeper tone for swirl bands
  varying vec2 vPie;

  const float TAU = 6.28318530718;

  float wedgeSdf(vec2 q, float r, float a0, float a1, float d, float edge) {
    vec2 n0 = vec2(-sin(a0), cos(a0));   // inward normal of start edge
    vec2 n1 = vec2(sin(a1), -cos(a1));   // inward normal of end edge
    float edges = max(d - dot(q, n0), d - dot(q, n1));
    return max(r - edge, edges);
  }

  float overlap(float a0, float a1, float w0, float w1) {
    return max(0.0, min(a1, w1) - max(a0, w0));
  }

  // Clockwise wipe coverage; angular distance converted to arc length (~1px edge).
  float wipeMask(float phi, float r, float px) {
    if (uReveal >= 1.0) return 1.0;
    if (uReveal <= 0.0) return 0.0;
    return clamp((uReveal * TAU - phi) * r / px + 0.5, 0.0, 1.0);
  }

  // Irregular, fast-flickering perimeter displacement in [-1, 1] (screen frame).
  // High angular frequencies keep the overall silhouette circular.
  float wobbleAt(float a, float t) {
    return 0.45 * sin(13.0 * a + 29.0 * t + 1.3)
         + 0.35 * sin(23.0 * a - 41.0 * t + 0.4)
         + 0.2 * sin(37.0 * a + 61.0 * t + 2.1);
  }

  // A comet arm moving clockwise: bright leading head, fading trailing tail.
  // Apparent speeds stay low enough (≤ 2 rev/s) that arms move well under half
  // their spacing per 30 fps frame, so the direction never aliases.
  float comet(float a, float t, float arms, float speed, float phase) {
    float s = fract(arms * (a / TAU - speed * t) + phase);
    return pow(s, 5.0) * (1.0 - smoothstep(0.9, 1.0, s));
  }

  // Softer variant for broad bands (no hard wedge edges).
  float softComet(float a, float t, float arms, float speed, float phase) {
    float s = fract(arms * (a / TAU - speed * t) + phase);
    return pow(s, 2.2) * (1.0 - smoothstep(0.75, 1.0, s));
  }

  float energyAt(float a, float r, float t, float edge) {
    float rr = r / edge;
    float outer = smoothstep(0.55, 0.88, rr) * (1.0 - smoothstep(0.96, 1.0, rr));
    float rim = smoothstep(0.78, 0.95, rr) * (1.0 - smoothstep(0.985, 1.0, rr));
    float inner = smoothstep(0.3, 0.65, rr) * (1.0 - smoothstep(0.85, 0.97, rr));
    float e = comet(a - 1.6 * rr, t, 3.0, 1.45, 0.0) * outer;
    e += 0.85 * comet(a + 0.5 * sin(t * 3.1), t, 4.0, 1.9, 0.37) * rim;
    e += 0.45 * comet(a - 2.4 * rr, t, 2.0, 1.15, 0.71) * inner;
    return e * (0.75 + 0.25 * sin(t * 37.0 + a * 5.0));
  }

  // Darker pinwheel bands trailing the highlights. The spiral twist (angle offset
  // grows with radius) reads as a spinning firework, never as pie sectors.
  float swirlAt(float a, float r, float t, float edge) {
    float rr = r / edge;
    float band = smoothstep(0.15, 0.6, rr) * (1.0 - smoothstep(0.86, 0.99, rr));
    float s = softComet(a + 0.9 - 2.8 * rr, t, 4.0, 1.3, 0.13) + 0.5 * softComet(a - 1.7 * rr, t, 3.0, 1.05, 0.52);
    return s * band;
  }

  void main() {
    vec2 q = vec2(vPie.x, -vPie.y);
    float r = length(q);
    float phi = atan(q.y, q.x);
    if (phi < 0.0) phi += TAU;
    float px = max(length(fwidth(q)), 1e-6);
    float phiS = phi + uRotation;            // screen-frame angle (does not spin)

    float edge = 1.0 + uWobble * wobbleAt(phiS + uJitter, uTime);

    // ── Sector coverage: crisp SDF ↔ analytic angular blur ──────────────────
    float k = smoothstep(0.5, 2.0, uBlur * r / px);
    float W = clamp(max(uBlur, px / max(r, 1e-5)), 1e-5, TAU);
    float radial = clamp(0.5 - (r - edge) / px, 0.0, 1.0);
    float sh = r > uHalfGap ? asin(min(uHalfGap / max(r, 1e-6), 1.0)) : 100.0;
    float w0 = phi - 0.5 * W;
    float w1 = phi + 0.5 * W;

    vec3 col = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < SECTORS; i++) {
      vec3 ci = mix(uColor[i], uDiscColor, uDiscMix);
      float s = wedgeSdf(q, r, uStart[i], uEnd[i], uHalfGap, edge);
      float cs = clamp(0.5 - s / max(fwidth(s), 1e-6), 0.0, 1.0);
      float a0 = uStart[i] + sh;
      float a1 = uEnd[i] - sh;
      float cb = 0.0;
      if (a1 > a0) {
        cb = (overlap(a0, a1, w0, w1) + overlap(a0 - TAU, a1 - TAU, w0, w1) + overlap(a0 + TAU, a1 + TAU, w0, w1)) / W;
      }
      float c = mix(cs, cb * radial, k);
      col += ci * c;
      cover += c;
    }

    float aDisc = min(cover, 1.0) * wipeMask(phi, r, px);
    vec3 cDisc = cover > 0.0 ? col / cover : uDiscColor;

    // ── Firework surface: rim brightness variation + clockwise energy ───────
    float rimLight = smoothstep(edge - 0.16, edge - 0.01, r) * (0.65 + 0.35 * sin(uTime * 29.0 + phiS * 9.0));
    float lift = uGlow * 0.4 * rimLight + uEnergy * 0.75 * energyAt(phiS + uJitter, r, uTime, edge);
    cDisc = mix(cDisc, uDeep, clamp(uEnergy * 0.3 * swirlAt(phiS + uJitter, r, uTime, edge), 0.0, 1.0));
    cDisc = mix(cDisc, uHot, clamp(lift, 0.0, 1.0));

    // ── Restrained outer glow, composited under the disc ────────────────────
    float gA = 0.0;
    if (uGlow > 0.0) {
      float dOut = max(r - edge, 0.0);
      gA = uGlow * 0.42 * exp(-dOut / 0.07) * (0.8 + 0.2 * sin(uTime * 23.0 + phiS * 6.0))
         * (1.0 - smoothstep(1.4, 1.65, r));
    }
    float a = aDisc + gA * (1.0 - aDisc);
    if (a < 0.002) discard;
    vec3 rgb = (cDisc * aDisc + uDiscColor * gA * (1.0 - aDisc)) / a;
    gl_FragColor = vec4(rgb, a);
  }
`;
