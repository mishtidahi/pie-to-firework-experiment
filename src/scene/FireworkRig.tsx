import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { vibrationAt } from '../effects/vibration';
import { DEG, PIE_RADIUS_WORLD } from '../geometry/pieGeometry';
import { tiltAngle, tiltAxis } from '../geometry/projection';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';

/** Positional jitter amplitude in world units at vibration 1 (frame height = 2 → ~3 px at 1080p). */
const SHAKE_WORLD = 0.0055;
/** Tilt "precession" wobble amplitude at vibration 1. */
const PRECESSION_RAD = 1.6 * DEG;

const _axis = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _wobble = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * Shared transform for the disc and its particles: vibration offset, 3D tilt
 * (with a little precession), and expansion. Children work in pie-radius
 * units. Hidden from the hold phase on, leaving only the solid background.
 */
export function FireworkRig({ children }: { children: ReactNode }) {
  const engine = useEngine();
  const { params } = useEngineBuild();
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = engine.state;
    const vib = vibrationAt(params.seed as number, s.time);
    const amp = s.vibration * (params.vibration as number);

    g.position.set(vib.x * SHAKE_WORLD * amp, vib.y * SHAKE_WORLD * amp, 0);
    _axis.set(...tiltAxis(params));
    _tilt.setFromAxisAngle(_axis, tiltAngle(params, s.tilt));
    _wobble.setFromEuler(_euler.set(vib.tiltX * PRECESSION_RAD * amp, vib.tiltY * PRECESSION_RAD * amp, 0));
    g.quaternion.copy(_tilt).multiply(_wobble);
    g.scale.setScalar(PIE_RADIUS_WORLD * Math.exp(s.expandLog));
    g.visible = s.finalFill < 0.5;
  });

  return <group ref={group}>{children}</group>;
}
