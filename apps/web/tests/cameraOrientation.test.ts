import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  poseFromQuaternion,
  poseQuaternion,
  type TurntablePose,
} from '../src/viewport/cameraOrientation';

function quatAngle(first: THREE.Quaternion, second: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(first.dot(second))));
}

function upOf(quaternion: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
}

const poses: TurntablePose[] = [
  { azimuth: 0, polar: 0.001, roll: 0 },
  { azimuth: Math.PI / 2, polar: Math.PI / 2, roll: Math.PI / 2 },
  { azimuth: -2.4, polar: 1.1, roll: -0.7 },
  { azimuth: 3.0, polar: Math.PI - 0.001, roll: Math.PI },
];

describe('camera orientation', () => {
  it('turns a pose into a quaternion and back without changing the view', () => {
    for (const pose of poses) {
      const restored = poseFromQuaternion(poseQuaternion(pose), pose.azimuth);
      const rebuilt = poseQuaternion({ ...pose, ...restored });
      expect(quatAngle(rebuilt, poseQuaternion(pose))).toBeCloseTo(0, 5);
    }
  });

  it('keeps the horizon turning smoothly between two poses', () => {
    const start = poseQuaternion(poses[0]!);
    const end = poseQuaternion(poses[1]!);
    const middle = start.clone().slerp(end, 0.5);
    const startUp = upOf(start);
    const endUp = upOf(end);
    const middleUp = upOf(middle);
    // The half-way orientation is a real step towards the target, not one of
    // its ends repeated until the last frame.
    expect(middleUp.angleTo(startUp)).toBeGreaterThan(0.2);
    expect(middleUp.angleTo(endUp)).toBeGreaterThan(0.2);
    expect(middleUp.angleTo(startUp)).toBeLessThan(Math.PI);
    expect(middleUp.angleTo(endUp)).toBeLessThan(Math.PI);
  });
});
