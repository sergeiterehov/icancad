import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rolledBasis, orbitStateOf, trackballOrbit, type OrbitState } from '../src/viewport/trackball';

const start: OrbitState = { azimuth: 0.4, polar: 1.1, roll: 0 };

const quaternionOf = (state: OrbitState) =>
  new THREE.Quaternion().setFromRotationMatrix(rolledBasis(state));

const expectSameOrientation = (left: THREE.Quaternion, right: THREE.Quaternion) => {
  // A quaternion and its negation describe the same turn.
  const dot = Math.abs(left.dot(right));
  expect(dot).toBeCloseTo(1, 6);
};

describe('trackball', () => {
  it('reads back the angles and the roll it was built from', () => {
    const state: OrbitState = { azimuth: -0.8, polar: 0.7, roll: 0.35 };
    const back = orbitStateOf(quaternionOf(state));
    expect(back.azimuth).toBeCloseTo(state.azimuth, 6);
    expect(back.polar).toBeCloseTo(state.polar, 6);
    expect(back.roll).toBeCloseTo(state.roll, 6);
  });

  it('turns the view the way the drag asks', () => {
    const right = trackballOrbit(start, 20, 0, 0.008);
    // A drag to the right turns the model the same way a turntable does.
    expect(right.state.azimuth).toBeLessThan(start.azimuth);
    // So does a drag down, which lifts the eye: the polar angle shrinks.
    const down = trackballOrbit(start, 0, 20, 0.008);
    expect(down.state.polar).toBeLessThan(start.polar);
  });

  it('reports the world rotation that matches the new orientation', () => {
    const turn = trackballOrbit(start, 12, 7, 0.008);
    const basis = rolledBasis(turn.state);
    const expected = new THREE.Matrix4().multiplyMatrices(
      turn.rotation,
      rolledBasis(start),
    );
    const difference = new THREE.Matrix4().multiplyMatrices(
      expected,
      new THREE.Matrix4().copy(basis).transpose(),
    );
    const angle = new THREE.Quaternion().setFromRotationMatrix(difference);
    expect(2 * Math.acos(Math.min(1, Math.abs(angle.w)))).toBeLessThan(1e-6);
  });

  it('lets the horizon tilt once the view has turned off the axes', () => {
    // A drag along the screen's up axis, then one along the screen's right axis:
    // the second one is not a turntable turn, so the horizon leaves the level.
    const first = trackballOrbit({ ...start, azimuth: 0.3, polar: 0.9 }, 40, 0, 0.008);
    const second = trackballOrbit(first.state, 0, 40, 0.008);
    expect(Math.abs(second.state.roll)).toBeGreaterThan(1e-4);
    // The orientation is still a pure rotation: the basis stays orthonormal.
    expect(rolledBasis(second.state).determinant()).toBeCloseTo(1, 6);
  });

  it('stays on the sphere over a long drag', () => {
    let state: OrbitState = { ...start };
    for (let step = 0; step < 200; step += 1) {
      state = trackballOrbit(state, 3, -2, 0.008).state;
    }
    const direction = new THREE.Vector3().setFromMatrixColumn(rolledBasis(state), 2);
    expect(direction.length()).toBeCloseTo(1, 6);
    expect(state.polar).toBeGreaterThanOrEqual(0);
    expect(state.polar).toBeLessThanOrEqual(Math.PI);
    expect(Number.isFinite(state.azimuth) && Number.isFinite(state.roll)).toBe(true);
    expectSameOrientation(quaternionOf(state), quaternionOf(orbitStateOf(quaternionOf(state))));
  });
});
