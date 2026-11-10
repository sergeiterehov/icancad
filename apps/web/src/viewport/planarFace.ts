import type { TessellationResult } from '@icancad/kernel';

const PLANAR_NORMAL_DOT = Math.cos(1e-3);

/**
 * True when every triangle of a B-rep face shares one normal. This is a cheap
 * client-side gate so a curved side is rejected at pick time; the kernel checks
 * the real surface type again before extruding.
 */
export function isPlanarFace(mesh: TessellationResult, faceId: number): boolean {
  const { positions, indices, faceIds } = mesh;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let found = false;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    const a = indices[triangle * 3]!;
    const b = indices[triangle * 3 + 1]!;
    const c = indices[triangle * 3 + 2]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const ux = positions[b * 3]! - ax;
    const uy = positions[b * 3 + 1]! - ay;
    const uz = positions[b * 3 + 2]! - az;
    const vx = positions[c * 3]! - ax;
    const vy = positions[c * 3 + 1]! - ay;
    const vz = positions[c * 3 + 2]! - az;
    let tx = uy * vz - uz * vy;
    let ty = uz * vx - ux * vz;
    let tz = ux * vy - uy * vx;
    const length = Math.hypot(tx, ty, tz);
    if (length < 1e-12) continue;
    tx /= length;
    ty /= length;
    tz /= length;
    if (!found) {
      nx = tx;
      ny = ty;
      nz = tz;
      found = true;
      continue;
    }
    if (tx * nx + ty * ny + tz * nz < PLANAR_NORMAL_DOT) return false;
  }
  return found;
}
