import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { BLUE, YELLOW, mixRgb } from '../effects/look';
import { cameraDistanceForFov, cameraZ } from '../geometry/projection';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { FireworkRig } from './FireworkRig';
import { OrbitStreaks } from './OrbitStreaks';
import { PieDisc } from './PieDisc';
import { Sparks } from './Sparks';

export { cameraDistanceForFov };

declare global {
  interface Window {
    __pieFireworkGL?: THREE.WebGLRenderer;
    __pieFireworkScene?: THREE.Scene;
  }
}

/** Camera FOV from params, dolly from the anim state. */
function CameraRig() {
  const engine = useEngine();
  const { params } = useEngineBuild();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    const fov = params.fov as number;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(0, 0, cameraZ(params, engine.state.camera));
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Blue → yellow. Exact palette values at both ends; solid yellow from the hold phase on. */
function Background() {
  const engine = useEngine();
  const scene = useThree((s) => s.scene);
  const color = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const s = engine.state;
    color.setRGB(...(s.finalFill >= 0.5 ? YELLOW : mixRgb(BLUE, YELLOW, s.bgMix)));
    scene.background = color;
  });
  return null;
}

/**
 * The WebGL stage. Colour handling is deliberately "what you type is what you
 * get": `legacy` disables THREE.ColorManagement, `linear` skips sRGB output
 * encoding and `flat` disables tone mapping, so #1a00d9 renders as #1a00d9.
 *
 * `preserveDrawingBuffer` lets the export tooling read back frames.
 */
export function StageCanvas() {
  const { params } = useEngineBuild();
  const fov = params.fov as number;
  return (
    <Canvas
      legacy
      linear
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      camera={{ fov, near: 0.01, far: 100, position: [0, 0, cameraDistanceForFov(fov)] }}
      onCreated={(state) => {
        // Exposed for inspection and verification (renderer stats, GPU info).
        window.__pieFireworkGL = state.gl;
        window.__pieFireworkScene = state.scene;
      }}
    >
      <Background />
      <CameraRig />
      <FireworkRig>
        <PieDisc />
        <OrbitStreaks />
        <Sparks />
      </FireworkRig>
    </Canvas>
  );
}
