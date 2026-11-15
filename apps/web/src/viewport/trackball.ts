import * as THREE from 'three';
import { viewBasis, type OrbitAngles } from './orbitPivot';

/**
 * Turning the view like a ball in the hand.
 *
 * A turntable keeps the world up axis: a drag moves the azimuth and the polar
 * angle, and the horizon never tilts. A trackball turns the model in its own
 * frame instead — a horizontal drag rotates about the screen's up axis, a
 * vertical one about its right axis — so the horizon can end up tilted and any
 * orientation is reachable without a pole to get stuck on. The state is the same
 * angle pair plus a roll about the view direction, which is what the camera
 * needs to draw the tilt.
 */

export interface OrbitState extends OrbitAngles {
  /** Tilt of the horizon about the view direction, in radians. */
  roll: number;
}

/** The view basis with the horizon rolled about the view direction. */
export function rolledBasis({ azimuth, polar, roll }: OrbitState): THREE.Matrix4 {
  const basis = viewBasis({ azimuth, polar });
  if (roll === 0) return basis;
  return basis.multiply(new THREE.Matrix4().makeRotationZ(roll));
}

/** The angles and the roll of an orientation, as the turntable camera stores them. */
export function orbitStateOf(orientation: THREE.Quaternion): OrbitState {
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(orientation);
  const direction = new THREE.Vector3().setFromMatrixColumn(matrix, 2).normalize();
  const azimuth = Math.atan2(direction.y, direction.x);
  const polar = Math.acos(Math.min(1, Math.max(-1, direction.z)));
  const base = viewBasis({ azimuth, polar });
  const up = new THREE.Vector3().setFromMatrixColumn(matrix, 1);
  const baseUp = new THREE.Vector3().setFromMatrixColumn(base, 1);
  const baseRight = new THREE.Vector3().setFromMatrixColumn(base, 0);
  // Rolling the basis turns its up towards its right, so the sign comes back
  // the other way round.
  return { azimuth, polar, roll: Math.atan2(-up.dot(baseRight), up.dot(baseUp)) };
}

export interface TrackballTurn {
  state: OrbitState;
  /** The same turn in world space, for the target and the orbit pivot. */
  rotation: THREE.Matrix4;
}

/**
 * Turns the view by a pointer delta in its own frame. Returns the new state and
 * the world-space rotation the model turned by, so the target can follow the
 * pivot exactly as it does for a turntable.
 */
export function trackballOrbit(
  state: OrbitState,
  deltaX: number,
  deltaY: number,
  radiansPerPixel: number,
): TrackballTurn {
  const screenUp = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -deltaX * radiansPerPixel,
  );
  const screenRight = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -deltaY * radiansPerPixel,
  );
  const current = new THREE.Quaternion().setFromRotationMatrix(rolledBasis(state));
  const turned = current.clone().multiply(screenUp).multiply(screenRight);
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
    turned.clone().multiply(current.clone().invert()),
  );
  return { state: orbitStateOf(turned), rotation };
}
