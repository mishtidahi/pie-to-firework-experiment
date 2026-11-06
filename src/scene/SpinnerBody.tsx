import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { hexToRgb01 } from '../config/palette';
import { JITTER_RAD, emissionWidth, nozzleAngle, sourceArc, sparkTimes } from '../effects/emission';
import { BLUE, HOT, ORANGE, WHITE, discColour } from '../effects/look';
import { vibrationAt } from '../effects/vibration';
import { DEG, PIE_GAP_RATIO, PIE_SECTORS } from '../geometry/pieGeometry';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { DISC_PLANE_HALF, pieFragmentShader, pieVertexShader } from './pieShader';
import { sideFragmentShader, sideVertexShader } from './sideShader';

const TAU = Math.PI * 2;
/** Base physical shutter: blur strength 1 = the angle swept in 1/30 s. */
const BASE_SHUTTER_S = 1 / 30;
/** Max perimeter displacement (radius units) at instability 1. */
const WOBBLE_RADIUS = 0.013;
/** Key light elevation above the screen plane. */
const LIGHT_ELEVATION = 40 * DEG;
const SIDE_SEGMENTS = 256;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const v3 = (rgb: readonly number[]) => new THREE.Vector3(rgb[0], rgb[1], rgb[2]);

/** Uniforms shared by both shaders (same objects, so one update serves both). */
function sharedUniforms() {
  return {
    uLight: { value: new THREE.Vector3(0, 0, 1) },
    uBands: { value: 3 },
    uPalWhite: { value: v3(WHITE) },
    uPalOrange: { value: v3(ORANGE) },
    uPalBlue: { value: v3(BLUE) },
    uHot: { value: v3(HOT) },
    uRotation: { value: 0 },
    uJitter: { value: 0 },
    uTime: { value: 0 },
    uWobble: { value: 0 },
    uShade: { value: 0 },
    uEnergy: { value: 0 },
    uHeat: { value: 0 },
  };
}

/**
 * Side of the body as three bands (top chamfer, wall, bottom chamfer), each its
 * own strip so creases stay hard: vertex (u, profile row 0..5), outward-facing winding.
 */
function sideGeometry() {
  const side: number[] = [];
  const index: number[] = [];
  for (let band = 0; band < 3; band++) {
    const base = side.length / 2;
    for (let i = 0; i <= SIDE_SEGMENTS; i++) {
      side.push(i / SIDE_SEGMENTS, band * 2, i / SIDE_SEGMENTS, band * 2 + 1);
      if (i < SIDE_SEGMENTS) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((side.length / 2) * 3), 3));
  g.setIndex(index);
  return g;
}

/**
 * The pie chart → cel-shaded 3D ground spinner: the precise pie as the top
 * face, plus a real side wall extruded behind it, both in pie-radius units
 * (the parent rig handles world scale, tilt and vibration). All uniforms
 * are derived from the anim state every frame; nothing animates locally.
 */
export function SpinnerBody() {
  const engine = useEngine();
  const { params, schedule } = useEngineBuild();
  const sparkT = useMemo(() => sparkTimes(params, schedule), [params, schedule]);
  const camera = useThree((s) => s.camera);
  const spin = useRef<THREE.Group>(null);
  const sideMesh = useRef<THREE.Mesh>(null);
  const shared = useMemo(sharedUniforms, []);

  const topMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pieVertexShader,
        fragmentShader: pieFragmentShader,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        uniforms: {
          ...shared,
          uStart: { value: PIE_SECTORS.map((s) => s.startDeg * DEG) },
          uEnd: { value: PIE_SECTORS.map((s) => s.endDeg * DEG) },
          uColor: { value: PIE_SECTORS.map((s) => new THREE.Vector3(...hexToRgb01(s.color))) },
          uHalfGap: { value: PIE_GAP_RATIO / 2 },
          uReveal: { value: 0 },
          uBlur: { value: 0 },
          uSmear: { value: 0 },
          uSmearSteps: { value: 3 },
          uMorph: { value: 0 },
          uDiscColor: { value: new THREE.Vector3() },
          uDiscMix: { value: 0 },
          uCoils: { value: 0 },
        },
      }),
    [shared],
  );

  const sideMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sideVertexShader,
        fragmentShader: sideFragmentShader,
        depthWrite: true,
        depthTest: true,
        uniforms: {
          ...shared,
          uThickness: { value: 0 },
          uBevel: { value: 0 },
          uBase: { value: new THREE.Vector3() },
          uNozzle: { value: 0 },
          uRegion: { value: 0 },
          uSourceArc: { value: 0 },
          uSource: { value: 0 },
        },
      }),
    [shared],
  );
  const sideGeo = useMemo(sideGeometry, []);
  useEffect(() => () => sideGeo.dispose(), [sideGeo]);
  const lightWorld = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const s = engine.state;
    const top = topMaterial.uniforms;
    const vib = vibrationAt(params.seed as number, s.time);
    const vibAmp = s.vibration * (params.vibration as number);

    // Motion smear window: the physical shutter, ramped in between ½× and 1× the onset speed and
    // only from the spin-up phase on, so the completed pie at the wipe hand-off still matches the
    // reference exactly. (The morph to concentric bands, not a wider blur, removes the sectors.)
    const speed = Math.abs(s.angularVelocity);
    const onset = params.blurStartSpeed as number;
    const gate = s.phase.spinUp > 0 ? 1 : 0;
    const onsetWeight = gate * (onset > 0 ? smoothstep(0.5 * onset, onset, speed) : 1);
    const physicalRevs = speed * BASE_SHUTTER_S * (params.blurStrength as number) * onsetWeight;
    // From Stage A the hard smear shapes are stretched to twice the per-frame step at 30 fps,
    // so consecutive frames overlap instead of abutting (cel smear readability, not soft blur).
    const windowRevs = Math.min(1, physicalRevs * (1 + s.smear));

    const disc = discColour(params, s.goldMix);
    const thickness = (params.thickness as number) * s.body;

    // Key light, from the screen-plane angle and a fixed elevation, into view space.
    const a = (params.lightAngleDeg as number) * DEG;
    lightWorld.set(Math.cos(a) * Math.cos(LIGHT_ELEVATION), Math.sin(a) * Math.cos(LIGHT_ELEVATION), Math.sin(LIGHT_ELEVATION));
    shared.uLight.value.copy(lightWorld).transformDirection(camera.matrixWorldInverse);

    const rot = ((s.rotationDeg % 360) + 360) % 360;
    shared.uBands.value = params.toonBands as number;
    shared.uRotation.value = rot * DEG;
    shared.uJitter.value = vib.rot * JITTER_RAD * vibAmp;
    shared.uTime.value = s.time;
    shared.uWobble.value = WOBBLE_RADIUS * s.wobble * (params.wobble as number);
    shared.uShade.value = s.shade;
    shared.uEnergy.value = s.energy * (params.energy as number);
    shared.uHeat.value = s.fire * (params.glow as number);

    top.uReveal.value = s.reveal;
    top.uBlur.value = windowRevs * TAU;
    top.uSmear.value = s.smear;
    top.uSmearSteps.value = params.smearSteps as number;
    top.uMorph.value = s.morph;
    top.uHalfGap.value = (PIE_GAP_RATIO / 2) * (1 - s.gapClose);
    top.uDiscColor.value.set(...disc);
    top.uDiscMix.value = s.discMix;
    top.uCoils.value = (params.coilGrooves as number) * s.morph;

    sideMaterial.uniforms.uThickness.value = thickness;
    sideMaterial.uniforms.uBevel.value = (params.bevel as number) * s.body;
    sideMaterial.uniforms.uBase.value.set(...disc);
    // Spark nozzle and emitting region (rotating with the body's visible spin), from ignition on.
    const ignited = s.time >= sparkT.igniteStart && s.fire > 0;
    sideMaterial.uniforms.uNozzle.value = nozzleAngle(s.time, shared.uJitter.value);
    sideMaterial.uniforms.uRegion.value = ignited ? emissionWidth(params, sparkT, s.time) : 0;
    sideMaterial.uniforms.uSourceArc.value = sourceArc(sparkT, s.time);
    sideMaterial.uniforms.uSource.value = ignited ? Math.min(1, s.fire * 1.5) : 0;
    // The side mesh is never hidden: at zero thickness all profile rows coincide, so its
    // triangles have zero area and draw nothing, but its shader is compiled on the first
    // frame instead of hitching when the body first appears.

    // Clock angles are clockwise-positive; three.js z-rotation is anticlockwise-positive.
    if (spin.current) spin.current.rotation.z = -rot * DEG;
  });

  const size = DISC_PLANE_HALF * 2;
  return (
    <group ref={spin}>
      <mesh ref={sideMesh} geometry={sideGeo} material={sideMaterial} renderOrder={0} frustumCulled={false} />
      <mesh material={topMaterial} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[size, size]} />
      </mesh>
    </group>
  );
}
