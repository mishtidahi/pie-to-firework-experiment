import type { Params } from '../config/params';
import { aspectRatio } from '../config/params';
import { DEG, PIE_RADIUS_WORLD } from './pieGeometry';

/**
 * Pure camera / tilt / coverage maths shared by the timeline (to size the
 * expansion) and the renderer (to place the camera and rig). Keeping one
 * implementation guarantees the "yellow covers the corners" calculation
 * matches what is actually drawn.
 *
 * World: in landscape and square formats the frame height is 2 units at z = 0
 * when the camera is at its start distance; portrait formats are framed wider
 * (see frameScale). The camera sits on +z looking at the origin.
 */

/** Camera distance that frames exactly 2 world units of height at z = 0. */
export function cameraDistanceForFov(fovDeg: number): number {
  return 1 / Math.tan((fovDeg * DEG) / 2);
}

/**
 * Start framing, as frame height in units of 2 world units at z = 0.
 * Aspect ≥ 1: 1 (the pie keeps the reference's share of the frame height).
 * Portrait: the camera starts further back, by √(height / width), so the pie
 * keeps the same share of the frame AREA as in landscape (9:16 → pie ≈ 48 % of
 * the width) instead of nearly filling the narrow frame. Geometry is never
 * scaled per axis, only the camera distance changes.
 */
export function frameScale(params: Params): number {
  const aspect = aspectRatio(params);
  return aspect >= 1 ? 1 : Math.sqrt(1 / aspect);
}

/** Camera z for a given close-in progress (0..1). */
export function cameraZ(params: Params, progress: number): number {
  return cameraDistanceForFov(params.fov as number) * frameScale(params) * (1 - (params.closeIn as number) * progress);
}

/** Unit tilt axis in the XY plane. */
export function tiltAxis(params: Params): [number, number, number] {
  const b = (params.tiltAxisDeg as number) * DEG;
  return [Math.cos(b), Math.sin(b), 0];
}

/**
 * Signed tilt angle in radians. Negative rotation about the (mostly X) axis
 * moves the disc's top edge away from the camera. The gentle ignition tilt
 * (preTilt 0..1 × preTiltDeg) comes first; the main tilt (0..1) then carries
 * it on to tiltDeg.
 */
export function tiltAngle(params: Params, progress: number, preTilt = 1): number {
  const pre = (params.preTiltDeg as number) * preTilt;
  const full = params.tiltDeg as number;
  return -(pre + (full - (params.preTiltDeg as number)) * progress) * DEG;
}

/**
 * Smallest disc radius (world units) that covers all four frame corners for
 * a disc centred at the origin, tilted by `tilt` about `axis`, viewed from
 * camera z `camZ`. Returns Infinity if a corner ray never meets the disc plane
 * (tilt too steep for the field of view).
 */
export function radiusToCoverCorners(
  aspect: number,
  fovDeg: number,
  camZ: number,
  axis: [number, number, number],
  tilt: number,
): number {
  const [ax, ay] = axis;
  const s = Math.sin(tilt);
  const c = Math.cos(tilt);
  // Plane normal = R(axis, tilt) · (0, 0, 1)  (Rodrigues with axis ⟂ z)
  const nx = ay * s;
  const ny = -ax * s;
  const nz = c;
  const th = Math.tan((fovDeg * DEG) / 2);
  let need = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const dx = sx * th * aspect;
      const dy = sy * th;
      const dz = -1;
      const nd = nx * dx + ny * dy + nz * dz;
      if (nd >= -1e-9) return Infinity;
      const k = -(nz * camZ) / nd;
      const px = k * dx;
      const py = k * dy;
      const pz = camZ + k * dz;
      need = Math.max(need, Math.hypot(px, py, pz));
    }
  }
  return need;
}

/** Disc scale (× reference pie radius) that just covers the corners at the end of the zoom. */
export function coverScaleAtEnd(params: Params): number {
  const r = radiusToCoverCorners(
    aspectRatio(params),
    params.fov as number,
    cameraZ(params, 1),
    tiltAxis(params),
    tiltAngle(params, 1),
  );
  return r / PIE_RADIUS_WORLD;
}

/**
 * Live coverage ratio (≥ 1 means every corner is inside the disc edge) for
 * the debug readout and verification. Ignores vibration, which is ~0 by the time this matters.
 */
export function coverageRatio(params: Params, tilt01: number, camera01: number, scale: number, preTilt01 = 1): number {
  const need = radiusToCoverCorners(
    aspectRatio(params),
    params.fov as number,
    cameraZ(params, camera01),
    tiltAxis(params),
    tiltAngle(params, tilt01, preTilt01),
  );
  return (scale * PIE_RADIUS_WORLD) / need;
}
