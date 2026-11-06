import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HOT, ORANGE, YELLOW, mixRgb } from '../effects/look';
import { buildSparkField } from '../effects/particleFields';
import { PIE_RADIUS_WORLD } from '../geometry/pieGeometry';
import { tiltAxis } from '../geometry/projection';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { aaGlsl } from './celShading';

/** Samples along each stroke, packed toward the head (u = (i/N)^1.6) so its rounded nose is smooth. */
const SEGMENTS = 16;
/** Velocity decay rate (1/s): sparks leave fast and slow as they burn out. */
const DRAG = 1.3;
/** Downward pull (pie radii / s²) on the upward launch component. */
const GRAVITY = 3.2;
/** The tail never gets thinner than this (px): strokes end as graphic points, never as hairlines. */
const MIN_PX = 3;

/**
 * Chakri sparks as graphic cel strokes, each one the recent part of its own
 * trajectory (not a line from the centre). Closed form in the spark's age τ,
 * in the body plane at birth (clock space, y down), with drag k:
 *
 *   D(τ)   = (1 − e^(−kτ)) / k                          distance factor
 *   p(τ)   = rim + dir·v0·D + n·(κ·s² + a·s·sin(2πfτ + ψ)),  s = v0·D
 *   z(τ)   = z0 + vz·D − g/k·(τ − D)   (clamped to the ground plane)
 *   ember: + kick·D(τ − split)  after it splits off its parent
 *
 * dir is the backward tangent (the jet) turned outward by the spread; n is its
 * in-plane normal, carrying the curvature κ and the waver. The result is rotated by
 * the body's tilt *at birth* about the tilt axis: the spark leaves the physical
 * rim and keeps that course while the body tilts on. The parent group carries
 * only the shake and the expansion (camera rush).
 *
 * The stroke spans τ ∈ [age − trail, min(age, life)]: after the spark dies its
 * trail drains away instead of popping, and the end-of-sequence fade drains
 * trails the same way.
 *
 * Shape and colour follow the spinner's cel language rather than photography:
 * - Thickness is benchmarked on the face's inner coil-groove rings (`sparkWidth`,
 *   0.045 R ≈ 9 px at 1080p, the weight of the inner ring pair). Each stroke has a
 *   rounded, pointed nose, a full belly just behind it and a taper to 40 % at the
 *   tail: a brush-stroke / flame shape with a clean silhouette.
 * - Colour is posterised in flat bands across the stroke, like the body's light,
 *   base and shadow bands: a hot core, a golden body and a darker orange edge.
 *   Along the stroke the bands cool in hard steps with the age at which the spark
 *   passed each point (hot → gold → amber → orange), so strokes are white-hot at
 *   the source and orange far out.
 * - Opaque palette colours, alpha only for edge antialiasing: no glow, no blur,
 *   no translucent fading.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aCorner;          // x: 0 head → 1 tail, y: −1..1 across
  attribute vec4 aS0;              // birth, life, birth angle (clock), launch speed
  attribute vec4 aS1;              // spread, width mult, lift, body tilt at birth
  attribute vec4 aS2;              // trail, curvature, waver amplitude, waver Hz
  attribute vec4 aS3;              // waver phase, split age (−1 none), kick angle, kick speed
  uniform float uTime;
  uniform float uFire;             // overall visibility (1 = all strands, 0 = none)
  uniform float uWidthView;        // strand width, view-space units
  uniform float uThickness;        // body depth, radius units
  uniform float uRimRadius;        // outer wall radius (1 + bevel)
  uniform vec3 uTiltAxis;
  uniform vec2 uViewport;          // drawing buffer, px
  varying float vVisit;            // age at which the spark passed this point
  varying float vLife;
  varying float vAcross;           // px from the strand's centre line
  varying float vHalf;             // drawn half-width (px, ≥ 0.5)
  varying float vEmber;

  const float TAU = 6.28318530718;
  const float K = ${DRAG.toFixed(3)};
  const float G = ${GRAVITY.toFixed(3)};

  float dragD(float tau) { return (1.0 - exp(-K * tau)) / K; }

  vec3 trajectory(float tau, vec2 rim, vec2 dir, vec2 n) {
    float D = dragD(tau);
    float s = aS0.w * D;
    float lateral = aS2.y * s * s + aS2.z * s * sin(TAU * aS2.w * tau + aS3.x);
    vec2 xy = rim + dir * s + n * lateral;
    if (aS3.y >= 0.0 && tau > aS3.y) {
      vec2 kd = dir * cos(aS3.z) + n * sin(aS3.z);
      xy += kd * aS3.w * dragD(tau - aS3.y);
    }
    float h = uThickness;
    float z = max(-0.35 * h + aS1.z * D - (G / K) * (tau - D), -h);
    vec3 p = vec3(xy.x, -xy.y, z);                       // clock space (y down) → local (y up)
    // Body orientation at birth (Rodrigues about the tilt axis, as FireworkRig's quaternion).
    float c = cos(aS1.w), sn = sin(aS1.w);
    return p * c + cross(uTiltAxis, p) * sn + uTiltAxis * dot(uTiltAxis, p) * (1.0 - c);
  }

  vec2 toPx(vec4 clip) { return clip.xy / clip.w * uViewport * 0.5; }

  void main() {
    float age = uTime - aS0.x;
    float life = aS0.y;
    bool ember = aS3.y >= 0.0;
    float tHead = min(age, life);
    // Fading never thins a strand below its crisp minimum width (orange at partial alpha
    // over the blue reads as a muddy purple). Instead each spark, at its own point in the
    // fade, drains its trail away: density drops progressively, every strand stays opaque.
    float pick = fract(aS3.x * 0.15915494);     // waver phase / 2π: a uniform per-spark number
    float vis = clamp((uFire - 0.85 * pick) / 0.15, 0.0, 1.0);
    float tTail = max(age - aS2.x * vis, ember ? aS3.y : 0.0);
    if (age < 0.0 || vis <= 0.0 || tTail >= tHead) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside the clip volume: culled
      return;
    }
    float tau = mix(tHead, tTail, aCorner.x);
    float ang = aS0.z;
    vec2 radial = vec2(cos(ang), sin(ang));
    vec2 tangent = vec2(-sin(ang), cos(ang));   // clockwise
    vec2 dir = -tangent * cos(aS1.x) + radial * sin(aS1.x);
    vec2 n = vec2(-dir.y, dir.x);
    vec2 rim = radial * uRimRadius;

    vec3 p = trajectory(tau, rim, dir, n);
    vec3 p2 = trajectory(tau + 0.002, rim, dir, n);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 d = toPx(projectionMatrix * modelViewMatrix * vec4(p2, 1.0)) - toPx(clip);
    float len = length(d);
    vec2 along = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);

    // Width in px from the view-space width at this depth. Stroke profile along u (0 = head):
    // a rounded nose up to the belly at u = 0.1, then a taper to 40 % at the tail; slimmer as
    // the spark burns out.
    float focalPx = projectionMatrix[1][1] * uViewport.y * 0.5;
    float wPx = uWidthView * aS1.y * focalPx / max(-mv.z, 1e-4);
    float u = aCorner.x;
    float nose = sqrt(clamp(u / 0.1, 0.0, 1.0));
    float taper = 1.0 - 0.6 * clamp((u - 0.1) / 0.9, 0.0, 1.0);
    wPx *= nose * taper * mix(1.0, 0.6, smoothstep(0.65, 1.0, tau / life));
    float halfTrue = 0.5 * max(wPx, u > 0.0 ? ${MIN_PX.toFixed(2)} : 0.0);
    float halfDraw = halfTrue + 0.75;                        // + room for the antialiased edge
    clip.xy += across * aCorner.y * halfDraw / (uViewport * 0.5) * clip.w;

    vVisit = tau;
    vLife = life;
    vAcross = aCorner.y * halfDraw;
    vHalf = halfTrue;
    vEmber = ember ? 1.0 : 0.0;
    gl_Position = clip;
  }
`;

const fragmentShader = /* glsl */ `
  ${aaGlsl}
  uniform vec3 uHot;
  uniform vec3 uGold;
  uniform vec3 uAmber;
  uniform vec3 uOrange;
  varying float vVisit;
  varying float vLife;
  varying float vAcross;
  varying float vHalf;
  varying float vEmber;
  void main() {
    float a = abs(vAcross);
    float cover = clamp(vHalf + 0.5 - a, 0.0, 1.0);   // edge antialiasing only
    if (cover < 0.02) discard;
    float f = vVisit / vLife;
    float wf = fwidth(f);
    float wa = max(fwidth(vAcross), 1e-3);
    // Heat by the age at which the spark passed this point (hard steps).
    float hot = 1.0 - aastepW(min(0.1, 0.32 * vLife), vVisit, fwidth(vVisit));
    vec3 body, core, edge;
    if (vEmber > 0.5) {
      // Split-off incandescent pellet: white-hot core in gold, cooling to gold in orange.
      float cool = aastepW(0.75, f, wf);
      core = mix(uHot, uGold, cool);
      body = core;
      edge = mix(uGold, uOrange, cool);
    } else {
      body = mix(mix(uGold, uAmber, aastepW(0.55, f, wf)), uOrange, aastepW(0.82, f, wf));
      core = mix(body, uHot, hot);
      edge = uOrange;
    }
    // Flat bands across the stroke: core (inner 40 %), body, a thin darker edge (outer ~24 %).
    float edgePx = clamp(0.24 * vHalf, 0.75, 2.0);
    vec3 c = mix(body, edge, aastepW(vHalf - edgePx, a, wa));
    c = mix(core, c, aastepW(0.4 * vHalf, a, wa));
    gl_FragColor = vec4(c, cover);
  }
`;

export function Sparks() {
  const engine = useEngine();
  const { params, schedule, rig } = useEngineBuild();
  const field = useMemo(() => buildSparkField(params, schedule, rig), [params, schedule, rig]);
  const gl = useThree((s) => s.gl);
  const viewport = useMemo(() => new THREE.Vector2(), []);

  const geometry = useMemo(() => {
    const corners: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = Math.pow(i / SEGMENTS, 1.6);
      corners.push(u, -1, u, 1);
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((corners.length / 2) * 3), 3)); // unused, required by three
    g.setIndex(index);
    g.setAttribute('aS0', new THREE.InstancedBufferAttribute(field.a0, 4));
    g.setAttribute('aS1', new THREE.InstancedBufferAttribute(field.a1, 4));
    g.setAttribute('aS2', new THREE.InstancedBufferAttribute(field.a2, 4));
    g.setAttribute('aS3', new THREE.InstancedBufferAttribute(field.a3, 4));
    g.instanceCount = field.count;
    return g;
  }, [field]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        // Strands are built in screen space; draw both faces regardless of winding.
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uFire: { value: 0 },
          uWidthView: { value: 0 },
          uThickness: { value: 0 },
          uRimRadius: { value: 1 },
          uTiltAxis: { value: new THREE.Vector3(1, 0, 0) },
          uViewport: { value: viewport },
          uHot: { value: new THREE.Vector3(...HOT) },
          uGold: { value: new THREE.Vector3(...YELLOW) },
          uAmber: { value: new THREE.Vector3(...mixRgb(YELLOW, ORANGE, 0.5)) },
          uOrange: { value: new THREE.Vector3(...ORANGE) },
        },
      }),
    [viewport],
  );

  useFrame(() => {
    const s = engine.state;
    const u = material.uniforms;
    gl.getDrawingBufferSize(viewport);
    u.uTime.value = s.time;
    u.uFire.value = s.fire;
    u.uThickness.value = (params.thickness as number) * s.body;
    u.uRimRadius.value = 1 + (params.bevel as number) * s.body;
    u.uTiltAxis.value.set(...tiltAxis(params));
    // View-space width (benchmark: the inner coil-groove rings); grows with the rig only as
    // scale^0.35 so the strokes stay graphic, not tubes, during the rush toward camera.
    u.uWidthView.value = (params.sparkWidth as number) * PIE_RADIUS_WORLD * Math.exp(0.35 * s.expandLog);
  });

  return <mesh geometry={geometry} material={material} renderOrder={3} frustumCulled={false} />;
}
