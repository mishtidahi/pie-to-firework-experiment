import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HOT, YELLOW } from '../effects/look';
import { buildStreakField } from '../effects/particleFields';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';

const SEGMENTS = 20;

/**
 * Irregular streaks orbiting the perimeter clockwise. Each ribbon is the
 * recent path of a moving head: vertex u samples the head at time (age − u·trail),
 * so a streak that breaks away from the rim curls outward like a comet.
 * Radius wobbles per streak; about 40% break away mid-life, gaining radius
 * quadratically and losing angular speed. All closed-form in uTime.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aCorner;          // x: 0 head → 1 tail, y: −1..1 across
  attribute vec4 aS0;              // birth, life, start angle, angular speed (rad/s)
  attribute vec4 aS1;              // radius, trail (s), width, break time (−1 none)
  attribute vec4 aS2;              // break accel, wobble amp, wobble freq, seed
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUV;
  varying float vLife;

  vec2 headAt(float tau) {
    float th = aS0.z + aS0.w * tau;
    float rr = aS1.x + aS2.y * sin(aS2.z * tau + aS2.w * 6.2831);
    if (aS1.w >= 0.0 && tau > aS1.w) {
      float b = tau - aS1.w;
      rr += aS2.x * b * b;            // breaks away from the rim
      th -= aS0.w * 0.6 * b * b;      // and loses angular speed
    }
    return rr * vec2(cos(th), sin(th));   // clock space
  }

  void main() {
    float age = uTime - aS0.x;
    if (age < 0.0 || age > aS0.y || uIntensity <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float tau = max(age - aCorner.x * aS1.y, 0.0);
    vec2 p = headAt(tau);
    vec2 ahead = headAt(tau + 0.004);
    vec2 t = normalize(ahead - p + vec2(1e-6, 0.0));
    vec2 perp = vec2(-t.y, t.x);
    float w = 0.016 * aS1.z * (1.0 - 0.85 * aCorner.x);   // tapers to the tail
    p += perp * aCorner.y * w;
    vUV = aCorner;
    vLife = age / aS0.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uGold;
  uniform vec3 uHot;
  uniform float uIntensity;
  varying vec2 vUV;
  varying float vLife;
  void main() {
    float edge = 1.0 - smoothstep(0.5, 1.0, abs(vUV.y));    // opaque core (stays gold on blue)
    float head = 1.0 - vUV.x;
    float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
    vec3 c = mix(uGold, uHot, pow(head, 3.0));
    float alpha = edge * smoothstep(0.0, 0.35, head) * fade * uIntensity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(c, alpha);
  }
`;

export function OrbitStreaks() {
  const engine = useEngine();
  const { params, schedule } = useEngineBuild();
  const field = useMemo(() => buildStreakField(params, schedule), [params, schedule]);

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
        depthTest: false,
        // The clock-space y-flip mirrors the quads (reversing winding), so draw both faces.
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uGold: { value: new THREE.Vector3(...YELLOW) },
          uHot: { value: new THREE.Vector3(...HOT) },
        },
      }),
    [],
  );

  useFrame(() => {
    material.uniforms.uTime.value = engine.state.time;
    material.uniforms.uIntensity.value = engine.state.fire;
  });

  return <mesh geometry={geometry} material={material} renderOrder={2} frustumCulled={false} />;
}
