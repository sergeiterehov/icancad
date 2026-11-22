import * as THREE from 'three';

/** The part of a camera pose that decides where it looks from and how it is turned. */
export interface TurntablePose {
  azimuth: number;
  polar: number;
  /** Tilt of the horizon; a view preset always levels it. */
  roll?: number;
}

// Mirrors the basis three.js derives in `lookAt` for our orbit camera.
export function cameraBasis(
  azimuth: number,
  polar: number,
): { right: THREE.Vector3; up: THREE.Vector3 } {
  const offset = new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  );
  const upHint =
    Math.abs(Math.cos(polar)) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(upHint, offset).normalize();
  const up = new THREE.Vector3().crossVectors(offset, right).normalize();
  return { right, up };
}

/** The eye direction of a turntable pose, from the target towards the camera. */
export function poseEye(pose: TurntablePose): THREE.Vector3 {
  const sinPolar = Math.sin(pose.polar);
  return new THREE.Vector3(
    sinPolar * Math.cos(pose.azimuth),
    sinPolar * Math.sin(pose.azimuth),
    Math.cos(pose.polar),
  );
}

/** The camera orientation of a pose, as a quaternion a transition can slerp. */
export function poseQuaternion(pose: TurntablePose): THREE.Quaternion {
  const eye = poseEye(pose);
  const basis = cameraBasis(pose.azimuth, pose.polar);
  const up = basis.up.clone().applyAxisAngle(eye, pose.roll ?? 0);
  const matrix = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(0, 0, 0), up);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

/** The turntable angles that reproduce an orientation, for the state after a step. */
export function poseFromQuaternion(
  quaternion: THREE.Quaternion,
  fallbackAzimuth: number,
): { azimuth: number; polar: number; roll: number } {
  const eye = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const polar = Math.acos(THREE.MathUtils.clamp(eye.z, -1, 1));
  const azimuth = Math.sin(polar) < 1e-6 ? fallbackAzimuth : Math.atan2(eye.y, eye.x);
  const basis = cameraBasis(azimuth, polar);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const turn = new THREE.Vector3().crossVectors(basis.up, up);
  const roll = Math.atan2(turn.dot(eye), basis.up.dot(up));
  return { azimuth, polar, roll };
}
