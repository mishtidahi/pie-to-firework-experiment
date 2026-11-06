import { celGlsl } from './celShading';

/**
 * Top face of the spinner: the precise pie chart that becomes the cel-shaded
 * top of a 3D ground spinner.
 *
 * Pie (Phases 1–2), unchanged and bit-identical: each sector is the
 * intersection of the disc and two inward-offset half-planes
 * (geometry/pieGeometry.ts), antialiased with the derivative of the signed
 * distance. Spinning is drawn with the exact analytic angular smear: at radius
 * r an inset wedge covers [a0 + asin(d/r), a1 − asin(d/r)], and the pixel's
 * coverage is its overlap with the shutter window [φ − W/2, φ + W/2] divided by
 * W. That is closed-form, noise-free and seek-safe.
 *
 * Cel revision (Stage A on):
 *  - the smear is posterised into hard-edged tones (graphic smear shapes, no
 *    soft blur);
 *  - the sectors morph seam-free into concentric coil bands of the same
 *    proportions (see the coverage block below);
 *  - the face is shaded as a slightly domed plane with coil grooves, a centre
 *    hub and a hard specular shape lit by the key light. The bevel is real
 *    geometry on the side mesh (sideShader.ts), which also carries the spin
 *    accents and rim heat flashes.
 *
 * `vPie` is in pie-radius units (the rig scales the mesh). Flipping y gives
 * "clock space", where angles increase clockwise from 3 o'clock.
 */
export const SECTOR_COUNT = 5;

/**
 * Plane half-size in pie radii. Kept at the Phase 1–3 value (1.7) so the pie's
 * interpolated coordinates, and therefore its pixels, stay bit-identical.
 */
export const DISC_PLANE_HALF = 1.7;

export const pieVertexShader = /* glsl */ `
  varying vec2 vPie;
  varying vec3 vViewPos;
  varying vec3 vBx;
  varying vec3 vBy;
  varying vec3 vBz;
  void main() {
    vPie = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vBx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
    vBy = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
    vBz = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

export const pieFragmentShader = /* glsl */ `
  #define SECTORS ${SECTOR_COUNT}
  ${celGlsl}
  uniform float uStart[SECTORS];   // radians, clock angle
  uniform float uEnd[SECTORS];
  uniform vec3 uColor[SECTORS];    // raw sRGB 0..1 (white ×4, orange last)
  uniform float uHalfGap;          // radius units
  uniform float uReveal;           // 0..1 radial wipe, clockwise from 3 o'clock
  uniform float uBlur;             // angular smear window W (radians); 0 = crisp
  uniform float uSmear;            // 0 = soft smear, 1 = posterised cel smear
  uniform float uSmearSteps;       // tone steps of the posterised smear
  uniform float uMorph;            // 0 = pie sectors, 1 = concentric coil bands (same proportions)
  uniform vec3 uDiscColor;         // light orange → gold
  uniform float uDiscMix;          // sector colours → disc colour
  uniform float uRotation;         // body rotation (rad, clock), wrapped to [0, 2π)
  uniform float uJitter;           // rotational instability (rad)
  uniform float uTime;             // timeline seconds
  uniform float uWobble;           // perimeter instability amplitude (radius units)
  uniform float uShade;            // cel shading strength (0 = flat colour)
  uniform float uCoils;            // coil groove / alternating tone strength
  uniform vec3 uHot;               // highlight colour
  varying vec2 vPie;
  varying vec3 vViewPos;
  varying vec3 vBx;
  varying vec3 vBy;
  varying vec3 vBz;

  const float PI = 3.14159265359;
  const float DOME = 0.13;         // slight convexity so highlights have shape
  const float HUB = 0.16;          // centre cap radius (fraction of the edge)

  float wedgeSdf(vec2 q, float r, float a0, float a1, float d, float edge) {
    vec2 n0 = vec2(-sin(a0), cos(a0));   // inward normal of start edge
    vec2 n1 = vec2(sin(a1), -cos(a1));   // inward normal of end edge
    float edges = max(d - dot(q, n0), d - dot(q, n1));
    return max(r - edge, edges);
  }

  float overlap(float a0, float a1, float w0, float w1) {
    return max(0.0, min(a1, w1) - max(a0, w0));
  }

  // Overlap of the window [w0, w1] (≤ 2π wide) with the arc centred c, half-width h.
  float arcOverlap(float c, float h, float w0, float w1) {
    if (h <= 0.0) return 0.0;
    if (h >= PI) return w1 - w0;
    float a0 = c - h;
    float a1 = c + h;
    return overlap(a0, a1, w0, w1) + overlap(a0 - TAU, a1 - TAU, w0, w1) + overlap(a0 + TAU, a1 + TAU, w0, w1);
  }

  // Overlap of the window with (arc g ∩ arc a): a gap arc counted only inside the white arc.
  float arcInArcOverlap(float cg, float hg, float ca, float ha, float w0, float w1) {
    if (hg <= 0.0 || ha <= 0.0) return 0.0;
    if (ha >= PI) return arcOverlap(cg, hg, w0, w1);
    float cgn = ca + (mod(cg - ca + PI, TAU) - PI);              // gap centre nearest the arc
    float lo = max(ca - ha, cgn - min(hg, PI));
    float hi = min(ca + ha, cgn + min(hg, PI));
    if (hi <= lo) return 0.0;
    return overlap(lo, hi, w0, w1) + overlap(lo - TAU, hi - TAU, w0, w1) + overlap(lo + TAU, hi + TAU, w0, w1);
  }

  // Clockwise wipe coverage; angular distance converted to arc length (~1px edge).
  float wipeMask(float phi, float r, float px) {
    if (uReveal >= 1.0) return 1.0;
    if (uReveal <= 0.0) return 0.0;
    return clamp((uReveal * TAU - phi) * r / px + 0.5, 0.0, 1.0);
  }

  // Antialiased posterisation of x ∈ [0,1] into steps+1 hard levels.
  float posterize(float x, float steps) {
    float y = x * steps;
    float f = floor(y);
    float w = max(fwidth(y), 1e-4) * 0.75;
    return (f + smoothstep(0.5 - w, 0.5 + w, y - f)) / steps;
  }

  void main() {
    vec2 q = vec2(vPie.x, -vPie.y);
    float r = length(q);
    float phi = atan(q.y, q.x);
    if (phi < 0.0) phi += TAU;
    float px = max(length(fwidth(q)), 1e-6);
    float phiS = phi + uRotation;            // screen-frame angle (does not spin)

    float edge = 1.0 + uWobble * wobbleAt(phiS + uJitter, uTime);

    // ── Coverage ─────────────────────────────────────────────────────────────
    // m = 0: the Phase 1–3 pie (crisp inset-wedge SDF ↔ exact angular smear), bit-identical.
    // m > 0: seam-free sector → coil-band morph. At every radius each region is one
    //   angular arc, so the exact angular smear still applies and nothing ever wraps:
    //   · white is an arc centred on 135° (the middle of the white run), orange an arc
    //     centred on 315° (its own middle). In the folded coordinate s = (1 − m)·u + m·r,
    //     with u = angular distance from 135° / π, orange is s > 0.75: it widens
    //     symmetrically and closes into the outer ring (a C becoming an O);
    //   · each white–white gap is the lens (1 − m)·u_j + m·|r − b_j| < w around its own
    //     boundary angle: it contracts toward its target radius b_j and spreads round
    //     into a coil groove, its tips meeting smoothly opposite where they started.
    //   Every field is symmetric and continuous on the circle, so there is no seam.
    //   At m → 0 these arcs equal the inset wedges exactly (continuous hand-over).
    float m = uMorph;
    float k = m > 0.0 ? 1.0 : smoothstep(0.5, 2.0, uBlur * r / px);
    float radial = clamp(0.5 - (r - edge) / px, 0.0, 1.0);
    float W = clamp(max(uBlur, px / max(r, 1e-5)), 1e-5, TAU);
    float sh = r > uHalfGap ? asin(min(uHalfGap / max(r, 1e-6), 1.0)) : 100.0;
    float w0 = phi - 0.5 * W;
    float w1 = phi + 0.5 * W;

    vec3 col = vec3(0.0);
    float cover = 0.0;
    float orangeCover = 0.0;
    if (m <= 0.0) {
      for (int i = 0; i < SECTORS; i++) {
        vec3 ci = mix(uColor[i], uDiscColor, uDiscMix);
        float s = wedgeSdf(q, r, uStart[i], uEnd[i], uHalfGap, edge);
        float cs = clamp(0.5 - s / max(fwidth(s), 1e-6), 0.0, 1.0);
        float cb = 0.0;
        float a0 = uStart[i] + sh;
        float a1 = uEnd[i] - sh;
        if (a1 > a0) {
          cb = (overlap(a0, a1, w0, w1) + overlap(a0 - TAU, a1 - TAU, w0, w1) + overlap(a0 + TAU, a1 + TAU, w0, w1)) / W;
        }
        float c = mix(cs, cb * radial, k);
        col += ci * c;
        cover += c;
        if (i == SECTORS - 1) orangeCover = c;
      }
    } else {
      // Bands use the unwobbled radius: only the silhouette is unstable, the coils stay true.
      float rB = min(r, 0.9999);
      float om = max(1.0 - m, 1e-4);
      float d = uHalfGap;
      float wU = r > d ? asin(min(d / max(r, 1e-6), 1.0)) / PI : 1.0;   // wedge inset, π units
      float w = mix(wU, d, m);                                          // gap half-width field
      float split = uEnd[SECTORS - 2] / TAU;                           // white | orange boundary (0.75)
      float hW = PI * clamp((split - w - m * rB) / om, 0.0, 1.0);
      float hO = PI * clamp(1.0 - (split + w - m * rB) / om, 0.0, 1.0);
      float cWhite = 0.5 * (uStart[0] + uEnd[SECTORS - 2]);           // 135°
      float cOrange = 0.5 * (uStart[SECTORS - 1] + uEnd[SECTORS - 1]); // 315°
      float oCov = arcOverlap(cOrange, hO, w0, w1);
      float wCov = arcOverlap(cWhite, hW, w0, w1);
      float gaps = 0.0;
      for (int j = 1; j < SECTORS - 1; j++) {
        float bj = uStart[j] / TAU;
        float hj = PI * clamp((w - m * abs(rB - bj)) / om, 0.0, 1.0);
        gaps += arcInArcOverlap(uStart[j], hj, cWhite, hW, w0, w1);
      }
      wCov = max(wCov - gaps, 0.0);
      float cO = oCov / W * radial;
      float cW = wCov / W * radial;
      col = mix(uColor[0], uDiscColor, uDiscMix) * cW + mix(uColor[SECTORS - 1], uDiscColor, uDiscMix) * cO;
      cover = cW + cO;
      orangeCover = cO;
    }

    vec3 base;
    float coverage = cover;
    if (uSmear > 0.0) {
      // Cel smear: coverage becomes hard on/off (no translucent white-over-blue), and the
      // orange share is posterised into a few palette tones between white and orange.
      float oFrac = cover > 1e-5 ? orangeCover / cover : 0.0;
      coverage = mix(cover, posterize(min(cover, 1.0), 1.0), uSmear);
      float oMix = mix(oFrac, posterize(oFrac, uSmearSteps - 1.0), uSmear);
      base = mix(mix(uColor[0], uColor[SECTORS - 1], oMix), uDiscColor, uDiscMix);
    } else {
      base = cover > 0.0 ? col / cover : uDiscColor;   // Phase 1–2 path, unchanged
    }
    float alpha = min(coverage, 1.0) * wipeMask(phi, r, px);
    if (alpha < 0.002) discard;

    // ── Cel-shaded spinner top ──────────────────────────────────────────────
    if (uShade > 0.0) {
      float rr = r / edge;
      float pxR = px / edge;                  // radius units per pixel
      vec2 radialL = r > 1e-5 ? vPie / r : vec2(0.0);          // local, y-up
      float hubEdge = aastepW(HUB, rr, pxR);
      // Pseudo-normal: a gentle dome so the light reads across the face.
      vec3 nl = normalize(vec3(radialL * DOME * rr, 1.0));
      vec3 n = normalize(vBx * nl.x + vBy * nl.y + vBz * nl.z);
      vec3 nTop = normalize(vBz);
      float rel = dot(n, uLight) - dot(nTop, uLight);
      vec3 c = celRamp(base, rel);
      vec3 shadowTone = mix(base, uPalOrange, 0.55);

      // Coil bands (the wound tube) keep the pie's proportions: alternating tones,
      // and hard grooves where the blue gaps closed.
      if (uCoils > 0.0) {
        float parity = 0.0;
        float groove = 0.0;
        for (int j = 0; j < SECTORS - 1; j++) {
          float bj = uEnd[j] / TAU;
          parity += aastepW(bj, r, px);
          groove = max(groove, 1.0 - aastepW(0.011, abs(r - bj), px));
        }
        float odd = abs(mod(parity, 2.0) - 1.0) < 0.5 ? 1.0 : 0.0;
        c = mix(c, mix(c, shadowTone, 0.18), odd * uCoils);
        c = mix(c, shadowTone, groove * uCoils * 0.85);
      }

      // Centre hub: a darker cap with a hard lit edge.
      float hub = 1.0 - hubEdge;
      vec3 hubC = celRamp(mix(base, uPalOrange, 0.35), rel);
      float hubRim = bandW(rr, HUB - 0.024, HUB, pxR) * aastep(0.0, dot(normalize(vBx * radialL.x + vBy * radialL.y), uLight));
      c = mix(c, hubC, hub);
      c = mix(c, mix(base, uPalWhite, 0.5), hubRim);

      // Hard specular shape: follows the dome, fixed relative to the light (not the spin).
      vec3 V = normalize(-vViewPos);
      float spec = aastep(0.985, dot(n, normalize(uLight + V)));
      c = mix(c, uHot, spec * 0.9);

      base = mix(base, c, uShade);
    }

    gl_FragColor = vec4(base, alpha);
  }
`;
