export interface ClipPlane {
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly constant: number;
}

export interface ClipPoint {
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

const CLIP_EPSILON = 1e-6;

/**
 * Three.js clips fragments on the negative side of a clipping plane, but a
 * raycaster knows nothing about clipping, so it keeps reporting the material a
 * section hides.
 */
export function isPointClipped(
  planes: readonly ClipPlane[],
  point: readonly [number, number, number],
): boolean {
  return planes.some(
    (plane) =>
      plane.normal.x * point[0] +
        plane.normal.y * point[1] +
        plane.normal.z * point[2] +
        plane.constant <
      -CLIP_EPSILON,
  );
}

/**
 * The first ray hit the section leaves visible. Skipping clipped hits keeps
 * invisible material unselectable and lets the ray reach the walls a section
 * exposes, such as the inside of a cavity.
 */
export function firstUnclippedHit<T extends ClipPoint>(
  hits: readonly T[],
  planes: readonly ClipPlane[],
): T | undefined {
  if (planes.length === 0) return hits[0];
  return hits.find((hit) => !isPointClipped(planes, [hit.point.x, hit.point.y, hit.point.z]));
}
