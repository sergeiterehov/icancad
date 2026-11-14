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

export interface RayLike {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

export interface SectionCrossing {
  /** Index of the plane in the list. */
  index: number;
  /** Where the ray meets the plane. */
  point: [number, number, number];
  /** Distance along the ray. */
  distance: number;
}

/**
 * The section planes the ray meets where the other visible sections leave the
 * cut intact, nearest first. The point of a plane lies on that plane, so its
 * own clip test always keeps it.
 */
export function sectionCrossings(ray: RayLike, planes: readonly ClipPlane[]): SectionCrossing[] {
  const crossings: SectionCrossing[] = [];
  planes.forEach((plane, index) => {
    const denominator =
      plane.normal.x * ray.direction.x +
      plane.normal.y * ray.direction.y +
      plane.normal.z * ray.direction.z;
    if (Math.abs(denominator) < CLIP_EPSILON) return;
    const distance =
      -(
        plane.normal.x * ray.origin.x +
        plane.normal.y * ray.origin.y +
        plane.normal.z * ray.origin.z +
        plane.constant
      ) / denominator;
    if (distance <= CLIP_EPSILON) return;
    const point: [number, number, number] = [
      ray.origin.x + ray.direction.x * distance,
      ray.origin.y + ray.direction.y * distance,
      ray.origin.z + ray.direction.z * distance,
    ];
    const hidden = planes.some(
      (other, otherIndex) => otherIndex !== index && isPointClipped([other], point),
    );
    if (hidden) return;
    crossings.push({ index, point, distance });
  });
  return crossings.sort((left, right) => left.distance - right.distance);
}
