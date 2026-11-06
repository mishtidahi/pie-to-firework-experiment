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
 * Shared transform for the body and its particles, in pie-radius units:
 *
 *   outer group: vibration offset + expansion (uniform scale). The expansion is the
 *                rush toward the viewer, so it applies to everything, sparks included.
 *   inner group: the body's 3D tilt with a little precession → `children`
 *                (body, hot source, orbiting streaks: things attached to the body).
 *   `free`:      outside the tilt (sparks in flight). Each spark applies the tilt the
 *                body had at its birth, so it keeps its course while the body tilts on.
 *
 * T·S·R equals the previous single-group T·R·S (uniform scale commutes with rotation).
 * Hidden from the hold phase on, leaving only the solid background.
 */
export function FireworkRig({ children, free }: { children: ReactNode; free?: ReactNode }) {
  const engine = useEngine();
  const { params } = useEngineBuild();
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  useFrame(() => {
    const o = outer.current;
    const g = inner.current;
    if (!o || !g) return;
    const s = engine.state;
    const vib = vibrationAt(params.seed as number, s.time);
    const amp = s.vibration * (params.vibration as number);

    o.position.set(vib.x * SHAKE_WORLD * amp, vib.y * SHAKE_WORLD * amp, 0);
    o.scale.setScalar(PIE_RADIUS_WORLD * Math.exp(s.expandLog));
    o.visible = s.finalFill < 0.5;
    _axis.set(...tiltAxis(params));
    _tilt.setFromAxisAngle(_axis, tiltAngle(params, s.tilt, s.preTilt));
    _wobble.setFromEuler(_euler.set(vib.tiltX * PRECESSION_RAD * amp, vib.tiltY * PRECESSION_RAD * amp, 0));
    g.quaternion.copy(_tilt).multiply(_wobble);
  });

  return (
    <group ref={outer}>
      <group ref={inner}>{children}</group>
      {free}
    </group>
  );
}
