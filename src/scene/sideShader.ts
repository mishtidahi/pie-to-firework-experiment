import { celCommonGlsl, celGlsl } from './celShading';

/**
 * Side of the spinner body: real geometry extruded behind the top face
 * (local z = 0) with a small 45° chamfer at the top and bottom edges:
 *
 *   row 0 (r = 1,      z = 0)        top crease, meets the top face edge
 *   row 1 (r = 1 + b,  z = −b)       ┐ band 0: top chamfer (normal up-and-out)
 *   row 2 (r = 1 + b,  z = −b)       ┐ band 1: wall (normal out)
 *   row 3 (r = 1 + b,  z = −h + b)   ┘
 *   row 4 (r = 1 + b,  z = −h + b)   ┐ band 2: bottom chamfer (normal down-and-out)
 *   row 5 (r = 1,      z = −h)       ┘
 *
 * The chamfer is built outward from the pie edge, so the top face, and with
 * it the solved corner coverage and the exact final yellow, are untouched; the
 * body's silhouette gains a real bevelled edge. Each band uses its own
 * analytic normal, so the creases are hard (cel look). The top chamfer is lit as
 * its own plane and carries the clockwise spin accents and the rim heat flashes;
 * the wall carries irregular tube stripes and a hard rim light; the bottom
 * chamfer faces the ground and sits in the darkest band. The silhouette
 * wobbles with the same function as the top face.
 */
export const sideVertexShader = /* glsl */ `
  ${celCommonGlsl}
  attribute vec2 aSide;            // x: 0..1 around the rim, y: profile row 0..5
  uniform float uThickness;        // h, radius units
  uniform float uBevel;            // b, radius units (clamped to h/2)
  uniform float uWobble;
  uniform float uTime;
  uniform float uRotation;
  uniform float uJitter;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vTopN;
  varying float vTh;
  varying float vBand;
  varying float vAlong;            // 0 at the upper row of the band, 1 at the lower

  void main() {
    float th = aSide.x * TAU;                       // local math angle (y-up)
    float phiS = -th + uRotation;                   // screen-frame clock angle (periodic use only)
    float wob = uWobble * wobbleAt(phiS + uJitter, uTime);
    float h = uThickness;
    float b = min(uBevel, 0.5 * h);
    float row = aSide.y;
    float band = floor(row * 0.5 + 0.01);
    float rOff = row < 0.5 ? 0.0 : (row > 4.5 ? 0.0 : b);
    float z = row < 0.5 ? 0.0 : (row < 2.5 ? -b : (row < 4.5 ? -h + b : -h));
    vec2 dir = vec2(cos(th), sin(th));
    vec3 p = vec3(dir * (1.0 + wob + rOff), z);
    float s = 0.70710678;
    vec3 nLocal = band < 0.5 ? vec3(dir * s, s) : (band < 1.5 ? vec3(dir, 0.0) : vec3(dir * s, -s));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * nLocal);
    vTopN = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
    vTh = th;
    vBand = band;
    vAlong = mod(row, 2.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const sideFragmentShader = /* glsl */ `
  ${celGlsl}
  uniform vec3 uBase;
  uniform vec3 uHot;
  uniform float uShade;
  uniform float uEnergy;
  uniform float uHeat;
  uniform float uRotation;
  uniform float uJitter;
  uniform float uTime;
  uniform float uNozzle;           // nozzle clock angle (rad), emission.ts
  uniform float uRegion;           // emitting rim region behind the nozzle (rad)
  uniform float uSourceArc;        // hot source length behind the nozzle (rad)
  uniform float uSource;           // 0..1 (0 before ignition)
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vTopN;
  varying float vTh;
  varying float vBand;
  varying float vAlong;

  void main() {
    vec3 n = normalize(vNormalV);
    vec3 V = normalize(-vViewPos);
    float lit = dot(n, uLight);
    float topLit = dot(normalize(vTopN), uLight);
    vec3 shadowTone = mix(uBase, uPalOrange, 0.55);
    float band = floor(vBand + 0.5);
    float phiBase = -vTh + uRotation;
    float wTh = max(fwidth(vTh), 1e-5);
    // Angle behind the nozzle (0 at the nozzle, growing against the spin); the wrap sits
    // just ahead of the nozzle, outside both the region and the source.
    float behind = mod(uNozzle - phiBase + 0.05, TAU) - 0.05;
    float inRegion = 1.0 - aastepW(uRegion, behind, wTh);
    float src = bandW(behind, -0.02, uSourceArc * 0.8, wTh) * uSource;
    float srcCore = bandW(behind, -0.01, uSourceArc * 0.3, wTh) * uSource;
    vec3 c;

    if (band < 0.5) {
      // Top chamfer: its own lit plane between the top face and the wall.
      // A cel bevel sits visibly between its neighbours: the light tone where it faces the
      // key light, otherwise a half tone between the gold top and the orange wall.
      vec3 lightTone = mix(uBase, uPalWhite, 0.5);
      c = mix(mix(uBase, shadowTone, 0.5), lightTone, aastep(0.06, lit - topLit));
      // Spin accents: three hard arcs racing clockwise (apparent 2 rev/s: ≤ 0.2 of their
      // spacing per 30 fps frame, so the direction never aliases).
      float ax = 3.0 * ((phiBase + uJitter) / TAU - 2.0 * uTime);
      c = mix(c, uHot, bandW(fract(ax), 0.62, 0.86, wTh * 3.0 / TAU) * uEnergy);
      // Rim heat flashes: random hard notches, re-rolled 24×/s.
      float cellX = phiBase / TAU * 48.0;
      float flash = step(0.88, hash12(vec2(mod(floor(cellX), 48.0), floor(uTime * 24.0))));
      c = mix(c, uHot, flash * bandW(fract(cellX), 0.1, 0.9, wTh * 48.0 / TAU) * uHeat * inRegion);
      // The nozzle: a hot patch with a white core where the sparks leave the rim.
      c = mix(mix(c, uHot, src), uPalWhite, srcCore);
    } else if (band < 1.5) {
      // Wall: a tone below the top plane, with tube segments and a hard rim light.
      c = celRamp(uBase, lit - topLit - 0.12);
      // 7 irregular stripes per turn sweeping clockwise at an apparent 1.3 rev/s
      // (≤ 0.3 of a stripe per 30 fps frame: direction cannot alias).
      float x = 7.0 * ((phiBase + uJitter) / TAU - 1.3 * uTime);
      float id = mod(floor(x), 7.0);
      float duty = 0.3 + 0.35 * fract(sin(id * 12.9898) * 43758.5453);
      float stripe = 1.0 - bandW(fract(x), 0.0, duty, wTh * 7.0 / TAU);
      c = mix(c, mix(c, shadowTone, 0.55), stripe * (0.45 + 0.35 * uEnergy));
      float grazing = 1.0 - abs(dot(n, V));
      c = mix(c, uHot, aastep(0.8, grazing) * aastep(0.15, lit) * 0.85);
      // Heat flashes continue a little way down the wall from the chamfer.
      float cellX = phiBase / TAU * 48.0;
      float flash = step(0.88, hash12(vec2(mod(floor(cellX), 48.0), floor(uTime * 24.0))));
      c = mix(c, uHot, flash * (1.0 - aastepW(0.3, vAlong, fwidth(vAlong))) * uHeat * inRegion);
      c = mix(c, uHot, src * (1.0 - aastepW(0.55, vAlong, fwidth(vAlong))));
    } else {
      // Bottom chamfer: faces the ground: always the deep tone, a dark contact edge.
      c = mix(shadowTone, uPalBlue, 0.22);
    }

    // Before the cel shading is fully in, the side still sits a tone below the top plane.
    gl_FragColor = vec4(mix(shadowTone, c, uShade), 1.0);
  }
`;
