import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HOT, ORANGE, YELLOW } from '../effects/look';
import { buildStreakField } from '../effects/particleFields';
import { PIE_RADIUS_WORLD } from '../geometry/pieGeometry';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { aaGlsl } from './celShading';

const SEGMENTS = 20;
/** The stroke never gets thinner than this (px): no faint, dotted hairlines. */
const MIN_PX = 3;

/**
 * Irregular streaks orbiting just outside the body wall, clockwise, at
 * different heights, born where the rim is emitting (particleFields.ts): the
 * dense swirl of hot material right at the source. Each stroke is the recent
 * path of a moving head: vertex u samples the head at time (age − u·trail), so a
 * streak that breaks away curls outward and upward like a comet. Depth-tested
 * against the body (the far half passes behind the spinner).
 *
 * Drawn exactly like the sparks (Sparks.tsx): a screen-space stroke of the same
 * thickness (`sparkWidth`), tapering to 40 %, never below MIN_PX, in flat cel
 * bands: a hot core near the head, a gold body and a thin orange edge. A streak
 * grows in by length after its birth and drains its trail when it dies or as the
 * sparks fade, so it never thins out into a translucent line.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aCorner;          // x: 0 head → 1 tail, y: −1..1 across
  attribute vec4 aS0;              // birth, life, start angle, angular speed (rad/s)
  attribute vec4 aS1;              // radius, trail (s), width, break time (−1 none)
  attribute vec4 aS2;              // break accel, wobble amp, wobble freq, seed
  uniform float uTime;
  uniform float uIntensity;
  uniform float uWidthView;        // stroke width, view-space units
  uniform float uThickness;
  uniform float uRimRadius;        // outer wall radius (1 + bevel)
  uniform vec2 uViewport;          // drawing buffer, px
  varying float vAcross;           // px from the centre line
  varying float vHalf;             // half-width (px)
  varying float vU;

  vec3 headAt(float tau) {
    float th = aS0.z + aS0.w * tau;
    float rr = aS1.x + (uRimRadius - 1.0) + aS2.y * sin(aS2.z * tau + aS2.w * 6.2831);
    float z = -uThickness * (0.2 + 0.6 * fract(aS2.w * 7.13));
    if (aS1.w >= 0.0 && tau > aS1.w) {
      float b = tau - aS1.w;
      rr += aS2.x * b * b;            // breaks away from the rim…
      th -= aS0.w * 0.6 * b * b;      // …loses angular speed…
      z += 1.6 * b * b;               // …and lifts off
    }
    vec2 xy = rr * vec2(cos(th), sin(th));   // clock space
    return vec3(xy.x, -xy.y, z);
  }

  vec2 toPx(vec4 clip) { return clip.xy / clip.w * uViewport * 0.5; }

  void main() {
    float age = uTime - aS0.x;
    float vis = clamp((uIntensity - 0.85 * aS2.w) / 0.15, 0.0, 1.0);   // per-streak point in the fade
    float tHead = min(age, aS0.y);
    float tTail = max(age - aS1.y * vis, 0.0);
    if (age < 0.0 || vis <= 0.0 || tTail >= tHead) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float tau = mix(tHead, tTail, aCorner.x);
    vec4 mv = modelViewMatrix * vec4(headAt(tau), 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 d = toPx(projectionMatrix * modelViewMatrix * vec4(headAt(tau + 0.004), 1.0)) - toPx(clip);
    float len = length(d);
    vec2 along = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    float focalPx = projectionMatrix[1][1] * uViewport.y * 0.5;
    float wPx = uWidthView * aS1.z * focalPx / max(-mv.z, 1e-4) * (1.0 - 0.6 * aCorner.x);
    float halfTrue = 0.5 * max(wPx, ${MIN_PX.toFixed(2)});
    float halfDraw = halfTrue + 0.75;                        // + room for the antialiased edge
    clip.xy += across * aCorner.y * halfDraw / (uViewport * 0.5) * clip.w;
    vAcross = aCorner.y * halfDraw;
    vHalf = halfTrue;
    vU = aCorner.x;
    gl_Position = clip;
  }
`;

const fragmentShader = /* glsl */ `
  ${aaGlsl}
  uniform vec3 uGold;
  uniform vec3 uHot;
  uniform vec3 uOrange;
  varying float vAcross;
  varying float vHalf;
  varying float vU;
  void main() {
    float a = abs(vAcross);
    float cover = clamp(vHalf + 0.5 - a, 0.0, 1.0);   // edge antialiasing only
    if (cover < 0.02) discard;
    float wa = max(fwidth(vAcross), 1e-3);
    vec3 core = mix(uHot, uGold, aastepW(0.45, vU, fwidth(vU)));   // hot core only near the head
    vec3 c = mix(uGold, uOrange, aastepW(vHalf - clamp(0.24 * vHalf, 0.75, 2.0), a, wa));
    c = mix(core, c, aastepW(0.4 * vHalf, a, wa));
    gl_FragColor = vec4(c, cover);
  }
`;

export function OrbitStreaks() {
  const engine = useEngine();
  const { params, schedule } = useEngineBuild();
  const field = useMemo(() => buildStreakField(params, schedule), [params, schedule]);
  const gl = useThree((s) => s.gl);
  const viewport = useMemo(() => new THREE.Vector2(), []);

  const geometry = useMemo(() => {
    const corners: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      corners.push(u, -1, u, 1);
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((corners.length / 2) * 3), 3));
    g.setIndex(index);
    g.setAttribute('aS0', new THREE.InstancedBufferAttribute(field.a0, 4));
    g.setAttribute('aS1', new THREE.InstancedBufferAttribute(field.a1, 4));
    g.setAttribute('aS2', new THREE.InstancedBufferAttribute(field.a2, 4));
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
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uWidthView: { value: 0 },
          uThickness: { value: 0 },
          uRimRadius: { value: 1 },
          uViewport: { value: viewport },
          uGold: { value: new THREE.Vector3(...YELLOW) },
          uHot: { value: new THREE.Vector3(...HOT) },
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
    u.uIntensity.value = s.fire;
    u.uThickness.value = (params.thickness as number) * s.body;
    u.uRimRadius.value = 1 + (params.bevel as number) * s.body;
    // Same stroke weight as the sparks, growing with the rig only as scale^0.35.
    u.uWidthView.value = (params.sparkWidth as number) * PIE_RADIUS_WORLD * Math.exp(0.35 * s.expandLog);
  });

  return <mesh geometry={geometry} material={material} renderOrder={2.5} frustumCulled={false} />;
}
