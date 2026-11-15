import * as THREE from 'three';

/**
 * Turning the view around the point under the pointer.
 *
 * The camera is a turntable: an azimuth, a polar angle and a target it looks
 * at. Swinging it around a pivot instead of around its own target is a rotation
 * of both the eye and the target about that point, with the view basis turned by
 * the same rotation. The pivot then keeps its pixel while the model turns, which
 * is what a drag on a surface should feel like.
 */

/** What a drag rotates around. */
export type OrbitPivot = 'cursor' | 'center';

export interface OrbitAngles {
  azimuth: number;
  polar: number;
}

/**
 * Rotation that takes the view basis of one angle pair to the basis of another.
 * The basis matches the camera's own axes, so applying it to the vector from the
 * pivot to the target turns the model the way the drag asked for.
 */
export function orbitRotation(from: OrbitAngles, to: OrbitAngles): THREE.Matrix4 {
  return viewBasis(to).multiply(viewBasis(from).transpose());
}

/** Rotates a point about the pivot, which stays where it is. */
export function orbitAbout(
  pivot: THREE.Vector3,
  rotation: THREE.Matrix4,
  point: THREE.Vector3,
): THREE.Vector3 {
  return point.clone().sub(pivot).applyMatrix4(rotation).add(pivot);
}

/**
 * The point of the ray that lies as deep as the orbit target. With nothing under
 * the pointer the view still turns around the line the pointer stands on, at the
 * depth the user is already looking at, so the zoom does not jump.
 */
export function pointOnRayAtTarget(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  const depth = new THREE.Vector3().subVectors(target, origin).dot(direction);
  if (!(depth > 0)) return target.clone();
  return origin.clone().addScaledVector(direction, depth);
}

/** Camera axes for a turntable angle pair, named the way three.js builds them. */
export function viewBasis({ azimuth, polar }: OrbitAngles): THREE.Matrix4 {
  const offset = new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  );
  // The pole is a singularity of the up hint, so it follows the camera there.
  const upHint =
    Math.abs(Math.cos(polar)) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(upHint, offset).normalize();
  const up = new THREE.Vector3().crossVectors(offset, right).normalize();
  return new THREE.Matrix4().makeBasis(right, up, offset);
}
