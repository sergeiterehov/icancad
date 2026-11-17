import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  orbitAbout,
  orbitPivotPoint,
  orbitRotation,
  pointOnRayAtTarget,
  type OrbitAngles,
} from '../src/viewport/orbitPivot';

/** The direction from the target to the eye, which the camera looks along. */
function eyeDirection({ azimuth, polar }: OrbitAngles): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  ).normalize();
}

const from: OrbitAngles = { azimuth: 0.3, polar: 1.1 };
const to: OrbitAngles = { azimuth: 0.6, polar: 0.9 };

describe('orbit about a point', () => {
  it('turns the view direction to the new angles', () => {
    const turned = eyeDirection(from).applyMatrix4(orbitRotation(from, to));
    expect(turned.distanceTo(eyeDirection(to))).toBeLessThan(1e-9);
  });

  it('is a rotation and not a scale or a mirror', () => {
    const rotation = orbitRotation(from, to);
    expect(rotation.determinant()).toBeCloseTo(1, 9);
    const axis = new THREE.Vector3(1, 2, 3).applyMatrix4(rotation);
    expect(axis.length()).toBeCloseTo(Math.hypot(1, 2, 3), 9);
  });

  it('swings the target around the pivot without changing how far it is', () => {
    const pivot = new THREE.Vector3(5, -3, 2);
    const target = new THREE.Vector3(8, -1, 4);
    const moved = orbitAbout(pivot, orbitRotation(from, to), target);
    expect(moved.distanceTo(pivot)).toBeCloseTo(target.distanceTo(pivot), 9);
    // A pivot on the target leaves the target alone: nothing to turn around.
    expect(orbitAbout(target, orbitRotation(from, to), target).distanceTo(target)).toBeLessThan(
      1e-9,
    );
  });

  it('keeps the pivot on its pixel: the same offsets in the turned basis', () => {
    const pivot = new THREE.Vector3(1, 2, -3);
    const target = new THREE.Vector3(4, 2, -3);
    const rotation = orbitRotation(from, to);
    const moved = orbitAbout(pivot, rotation, target);
    // The vector from the target to the pivot, seen through the camera basis,
    // is what decides the pixel. Both the vector and the basis turned, so the
    // offsets have to match.
    const before = target.clone().sub(pivot);
    const after = moved.clone().sub(pivot).applyMatrix4(rotation.clone().transpose());
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('does not turn the view at all for a zero drag', () => {
    const rotation = orbitRotation(from, from);
    const point = new THREE.Vector3(3, 4, 5);
    expect(point.clone().applyMatrix4(rotation).distanceTo(point)).toBeLessThan(1e-12);
  });
});

describe('pivot when nothing is under the pointer', () => {
  const origin = new THREE.Vector3(0, 0, 100);
  const direction = new THREE.Vector3(0, 0, -1);

  it('prefers the cursor hit, then the frame centre, then the ray depth', () => {
    const cursor = new THREE.Vector3(1, 2, 3);
    const centre = new THREE.Vector3(4, 5, 6);
    const target = new THREE.Vector3(0, 0, 0);
    expect(orbitPivotPoint(cursor, centre, origin, direction, target)).toEqual(cursor);
    expect(orbitPivotPoint(null, centre, origin, direction, target)).toEqual(centre);
    const fallback = orbitPivotPoint(null, null, origin, direction, target);
    expect(fallback.distanceTo(pointOnRayAtTarget(origin, direction, target))).toBeLessThan(1e-9);
  });

  it('takes the point of the ray at the depth of the target', () => {
    const target = new THREE.Vector3(7, 0, 0);
    const point = pointOnRayAtTarget(origin, direction, target);
    expect(point.x).toBeCloseTo(0, 9);
    expect(point.z).toBeCloseTo(0, 9);
  });

  it('keeps the pointer column, so the view turns under the cursor', () => {
    const shiftedOrigin = new THREE.Vector3(5, 6, 100);
    const target = new THREE.Vector3(0, 0, 0);
    const point = pointOnRayAtTarget(shiftedOrigin, direction, target);
    expect(point.x).toBeCloseTo(5, 9);
    expect(point.y).toBeCloseTo(6, 9);
  });

  it('falls back to the target when the ray points away from it', () => {
    const target = new THREE.Vector3(0, 0, 200);
    const point = pointOnRayAtTarget(origin, direction, target);
    expect(point.distanceTo(target)).toBeLessThan(1e-9);
  });
});
