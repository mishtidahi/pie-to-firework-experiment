import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { hexToRgb01 } from '../config/palette';
import { HOT, ORANGE, discColour, mixRgb } from '../effects/look';
import { vibrationAt } from '../effects/vibration';
import { DEG, PIE_GAP_RATIO, PIE_SECTORS } from '../geometry/pieGeometry';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { DISC_PLANE_HALF, pieFragmentShader, pieVertexShader } from './pieShader';

const TAU = Math.PI * 2;
/** Base physical shutter: blur strength 1 = the angle swept in 1/30 s. */
const BASE_SHUTTER_S = 1 / 30;
/** Max rotational jitter (rad) at vibration 1. */
const JITTER_RAD = 4 * DEG;
/** Max perimeter displacement (radius units) at instability 1. */
const WOBBLE_RADIUS = 0.013;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The pie chart → spinner disc, one shader-driven plane in pie-radius units
 * (the parent rig handles world scale, tilt and vibration). All uniforms are
 * derived from the anim state each frame; the component holds no animation
 * state of its own.
 */
export function PieDisc() {
  const engine = useEngine();
  const { params } = useEngineBuild();
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pieVertexShader,
        fragmentShader: pieFragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uStart: { value: PIE_SECTORS.map((s) => s.startDeg * DEG) },
          uEnd: { value: PIE_SECTORS.map((s) => s.endDeg * DEG) },
          uColor: { value: PIE_SECTORS.map((s) => new THREE.Vector3(...hexToRgb01(s.color))) },
          uHalfGap: { value: PIE_GAP_RATIO / 2 },
          uReveal: { value: 0 },
          uBlur: { value: 0 },
          uDiscColor: { value: new THREE.Vector3() },
          uDiscMix: { value: 0 },
          uRotation: { value: 0 },
          uJitter: { value: 0 },
          uTime: { value: 0 },
          uEnergy: { value: 0 },
          uWobble: { value: 0 },
          uGlow: { value: 0 },
          uHot: { value: new THREE.Vector3(...HOT) },
          uDeep: { value: new THREE.Vector3() },
        },
      }),
    [],
  );

  useFrame(() => {
    const s = engine.state;
    const u = material.uniforms;
    const vib = vibrationAt(params.seed as number, s.time);
    const vibAmp = s.vibration * (params.vibration as number);

    // Motion blur window: physical shutter (with an onset threshold) widening to a full revolution.
    const speed = Math.abs(s.angularVelocity);
    // Physical blur ramps in between ½× and 1× the onset speed, and only from the
    // spin-up phase on: the overshoot/recoil stay crisp, so the completed pie at the
    // wipe hand-off still matches the reference exactly.
    const onset = params.blurStartSpeed as number;
    const gate = s.phase.spinUp > 0 ? 1 : 0;
    const onsetWeight = gate * (onset > 0 ? smoothstep(0.5 * onset, onset, speed) : 1);
    const physicalRevs = speed * BASE_SHUTTER_S * (params.blurStrength as number) * onsetWeight;
    const windowRevs = Math.min(1, physicalRevs + (1 - physicalRevs) * s.blurMix);

    u.uReveal.value = s.reveal;
    u.uBlur.value = windowRevs * TAU;
    u.uHalfGap.value = (PIE_GAP_RATIO / 2) * (1 - s.gapClose);
    const disc = discColour(params, s.goldMix);
    u.uDiscColor.value.set(...disc);
    u.uDeep.value.set(...mixRgb(disc, ORANGE, 0.45));
    u.uDiscMix.value = s.discMix;
    u.uTime.value = s.time;
    u.uJitter.value = vib.rot * JITTER_RAD * vibAmp;
    u.uEnergy.value = s.energy * (params.energy as number);
    u.uWobble.value = WOBBLE_RADIUS * s.wobble * (params.wobble as number);
    u.uGlow.value = s.fire * (params.glow as number);

    const rot = ((s.rotationDeg % 360) + 360) % 360;
    u.uRotation.value = rot * DEG;
    // Clock angles are clockwise-positive; three.js z-rotation is anticlockwise-positive.
    if (mesh.current) mesh.current.rotation.z = -rot * DEG;
  });

  const size = DISC_PLANE_HALF * 2;
  return (
    <mesh ref={mesh} material={material} renderOrder={1} frustumCulled={false}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
