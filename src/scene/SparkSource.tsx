import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { JITTER_RAD, nozzleAngle, showerStage, sourceArc, sparkTimes } from '../effects/emission';
import { HOT, WHITE, YELLOW } from '../effects/look';
import { vibrationAt } from '../effects/vibration';
import { useEngine, useEngineBuild } from '../timeline/EngineContext';
import { aaGlsl, celCommonGlsl } from './celShading';

/** Angular samples of the flare strip. */
const SEGMENTS = 32;
/** The strip spans this share of the source arc behind the nozzle … */
const BEHIND = 1.0;
/** … and this much ahead of it (room for the rounded head). */
const AHEAD = 0.45;
const R_IN = 0.8;
const R_OUT = 1.28;

/**
 * The nozzle: an intensely hot, hard-edged source on the rim where the sparks
 * leave. It lies in the top-face plane of the (tilted, non-spinning) body frame
 * at the nozzle's angle, straddling the top edge and the chamfer, so it stays
 * attached to the physical rim through the tilt and expansion. It is a comet
 * shape: a round head at the nozzle and a tail that tapers behind it, longer than
 * one 30 fps rotation step, so consecutive frames overlap. Three flat cel layers:
 * yellow rim, hot body, white core. Its size flickers a little, re-rolled 24×/s.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aArc;             // x: −BEHIND..AHEAD (× source arc, + = ahead), y: radius
  uniform float uNozzle;           // clock angle (rad)
  uniform float uArc;              // source arc length (rad)
  uniform float uIntensity;
  varying vec2 vArc;
  void main() {
    if (uIntensity <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // not lit: culled (no fragments at all)
      return;
    }
    float phi = uNozzle + aArc.x * uArc;
    vec2 xy = aArc.y * vec2(cos(phi), sin(phi));          // clock space (y down)
    vArc = vec2(aArc.x * uArc * aArc.y, aArc.y);          // (arc length from the nozzle, radius)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xy.x, -xy.y, 0.004, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  ${celCommonGlsl}
  ${aaGlsl}
  uniform float uArc;
  uniform float uCentre;           // radius of the source's centre line
  uniform float uHead;             // head radius (R)
  uniform float uIntensity;        // 0..1
  uniform float uFlicker;
  uniform vec3 uYellow;
  uniform vec3 uHot;
  uniform vec3 uWhite;
  varying vec2 vArc;
  void main() {
    float s = vArc.x;                                      // ≤ 0 behind the nozzle
    float dr = vArc.y - uCentre;
    float head = uHead * uFlicker * uIntensity;
    float tailLen = uArc * uCentre;
    // Comet half-thickness (R) at arc position s: a round head at the nozzle, tapering to a
    // point at the tail tip. Edges are antialiased in R units against the pixel size (a smooth
    // quantity), so there is no derivative blow-up where the shape ends.
    float halfT = s >= 0.0
      ? sqrt(max(head * head - s * s, 0.0))
      : head * sqrt(clamp(1.0 + s / max(tailLen, 1e-5), 0.0, 1.0));
    if (halfT <= 0.0) discard;
    float px = max(fwidth(vArc.y), 1e-6) * 0.7;           // one pixel, in R
    float d = abs(dr);
    float a = 1.0 - smoothstep(halfT - px, halfT + px, d);
    if (a < 0.02) discard;
    vec3 c = mix(uWhite, uHot, smoothstep(0.42 * halfT - px, 0.42 * halfT + px, d));
    c = mix(c, uYellow, smoothstep(0.74 * halfT - px, 0.74 * halfT + px, d));
    gl_FragColor = vec4(c, a);
  }
`;

export function SparkSource() {
  const engine = useEngine();
  const { params, schedule } = useEngineBuild();
  const T = useMemo(() => sparkTimes(params, schedule), [params, schedule]);

  const geometry = useMemo(() => {
    const arc: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const x = -BEHIND + ((AHEAD + BEHIND) * i) / SEGMENTS;
      arc.push(x, R_IN, x, R_OUT);
      if (i < SEGMENTS) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('aArc', new THREE.Float32BufferAttribute(arc, 2));
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((arc.length / 2) * 3), 3));
    g.setIndex(index);
    return g;
  }, []);
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
          uNozzle: { value: 0 },
          uArc: { value: 0.5 },
          uCentre: { value: 1 },
          uHead: { value: 0.07 },
          uIntensity: { value: 0 },
          uFlicker: { value: 1 },
          uYellow: { value: new THREE.Vector3(...YELLOW) },
          uHot: { value: new THREE.Vector3(...HOT) },
          uWhite: { value: new THREE.Vector3(...WHITE) },
        },
      }),
    [],
  );

  useFrame(() => {
    const s = engine.state;
    const u = material.uniforms;
    const on = s.time >= T.igniteStart && s.fire > 0;
    u.uIntensity.value = on ? Math.min(1, s.fire * 1.5) : 0;
    const vibAmp = s.vibration * (params.vibration as number);
    u.uNozzle.value = nozzleAngle(s.time, vibrationAt(params.seed as number, s.time).rot * JITTER_RAD * vibAmp);
    u.uArc.value = sourceArc(T, s.time);
    u.uCentre.value = 1 + 0.5 * (params.bevel as number) * s.body;
    // A little larger while the shower is building; flicker re-rolled 24×/s (seeded, seek-safe).
    u.uHead.value = 0.1 + 0.02 * showerStage(T, s.time);
    const cell = Math.floor(s.time * 24);
    u.uFlicker.value = 0.85 + 0.3 * fract(Math.sin(cell * 12.9898 + (params.seed as number) * 0.731) * 43758.5453);
  });

  // Drawn over the body but under the sparks, whose white-hot roots spray out of it.
  return <mesh geometry={geometry} material={material} renderOrder={2} frustumCulled={false} />;
}

const fract = (x: number) => x - Math.floor(x);
