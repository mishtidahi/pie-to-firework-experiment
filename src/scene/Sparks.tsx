import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HOT, ORANGE, YELLOW } from '../effects/look';
import { buildSparkField } from '../effects/particleFields';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';

/** Velocity decay rate (1/s): sparks fly fast off the rim and slow as they burn out. */
const DRAG = 2.4;
/** Streak length as a time window (s): the head's recent path, a built-in motion blur. */
const TRAIL_S = 0.1;
/** Base streak width in pie radii (~2 px at the reference size). */
const WIDTH = 0.012;

/**
 * Centrifugal sparks. Each spark leaves the rim at a fixed (seeded) angle
 * mostly along the clockwise tangent, with a small outward component, and
 * decelerates under drag. The head position at age τ is closed-form:
 *   p(τ) = rim + dir · v0/k · (1 − e^(−kτ))
 * The streak spans p(τ − trail) → p(τ). It lives in the rig's non-spinning
 * frame (sparks do not rotate with the disc once ejected) and tilts with it.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aCorner;          // x: 0 tail → 1 head, y: −1..1 across
  attribute vec4 aSpark0;          // birth, life, rim angle, speed mult
  attribute vec4 aSpark1;          // spread, width mult, seed, brightness
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uWidthScale;     // partially cancels rig expansion so sparks stay slender
  varying vec2 vUV;
  varying float vLife;
  varying float vBright;

  vec2 travel(vec2 p0, vec2 dir, float v0, float tau) {
    return p0 + dir * (v0 / ${DRAG.toFixed(3)}) * (1.0 - exp(-${DRAG.toFixed(3)} * tau));
  }

  void main() {
    float age = uTime - aSpark0.x;
    if (age < 0.0 || age > aSpark0.y || uIntensity <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside the clip volume: culled
      return;
    }
    float ang = aSpark0.z;
    vec2 radial = vec2(cos(ang), sin(ang));      // clock space (y down)
    vec2 tangent = vec2(-sin(ang), cos(ang));    // clockwise direction
    vec2 dir = normalize(tangent * cos(aSpark1.x) + radial * sin(aSpark1.x));
    float v0 = uSpeed * aSpark0.w;
    vec2 head = travel(radial, dir, v0, age);
    vec2 tail = travel(radial, dir, v0, max(age - ${TRAIL_S.toFixed(4)}, 0.0));
    vec2 perp = vec2(-dir.y, dir.x);
    // Fade by tapering width (tail → head, and shrinking with age) rather than by alpha:
    // translucent yellow over the saturated blue turns grey, opaque thin yellow stays gold.
    float lifeK = age / aSpark0.y;
    float w = ${WIDTH.toFixed(4)} * aSpark1.y * mix(0.12, 1.0, aCorner.x) * mix(1.0, 0.35, lifeK) * uWidthScale;
    vec2 p = mix(tail, head, aCorner.x) + perp * aCorner.y * w;
    vUV = aCorner;
    vLife = age / aSpark0.y;
    vBright = aSpark1.w * (0.72 + 0.28 * sin(uTime * 47.0 + aSpark1.z * 60.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uOrange;
  uniform vec3 uGold;
  uniform vec3 uHot;
  uniform float uIntensity;
  varying vec2 vUV;
  varying float vLife;
  varying float vBright;
  void main() {
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUV.y));   // opaque core, soft 1px-ish edge
    float along = vUV.x;
    float fade = smoothstep(0.0, 0.04, vLife) * (1.0 - smoothstep(0.82, 1.0, vLife));
    vec3 c = mix(uOrange, uGold, smoothstep(0.0, 0.45, along));
    c = mix(c, uHot, smoothstep(0.75, 1.0, along) * (1.0 - vLife) * vBright);
    float alpha = edge * smoothstep(0.0, 0.25, along) * fade * uIntensity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(c, alpha);
  }
`;

export function Sparks() {
  const engine = useEngine();
  const { params, schedule } = useEngineBuild();
  const field = useMemo(() => buildSparkField(params, schedule), [params, schedule]);

  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 0, 1, 1, 1], 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)); // unused, required by three
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('aSpark0', new THREE.InstancedBufferAttribute(field.a0, 4));
    g.setAttribute('aSpark1', new THREE.InstancedBufferAttribute(field.a1, 4));
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
        depthTest: false,
        // The clock-space y-flip mirrors the quads (reversing winding), so draw both faces.
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: 1 },
          uIntensity: { value: 0 },
          uWidthScale: { value: 1 },
          uOrange: { value: new THREE.Vector3(...ORANGE) },
          uGold: { value: new THREE.Vector3(...YELLOW) },
          uHot: { value: new THREE.Vector3(...HOT) },
        },
      }),
    [],
  );

  useFrame(() => {
    const s = engine.state;
    material.uniforms.uTime.value = s.time;
    material.uniforms.uSpeed.value = params.sparkSpeed as number;
    material.uniforms.uIntensity.value = s.fire;
    material.uniforms.uWidthScale.value = Math.exp(-0.65 * s.expandLog);
  });

  return <mesh geometry={geometry} material={material} renderOrder={3} frustumCulled={false} />;
}
