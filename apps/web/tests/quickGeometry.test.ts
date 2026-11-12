import { describe, expect, it } from 'vitest';
import { faceRegion, outwardNormal, pointInMesh, probeDistance } from '../src/quick/geometry';
import { cubeCenter, cubeMesh } from './cubeMesh';

describe('quick operation geometry', () => {
  it('finds the centroid and outward normal of a face', () => {
    const mesh = cubeMesh();
    const right = faceRegion(mesh, 1);
    expect(right?.normal).toEqual([1, 0, 0]);
    expect(right?.area).toBeCloseTo(400, 6);
    expect(right?.centroid[0]).toBeCloseTo(20, 6);
    expect(right?.centroid[1]).toBeCloseTo(10, 6);
    expect(right?.centroid[2]).toBeCloseTo(10, 6);
    const top = faceRegion(mesh, 5);
    expect(top?.normal).toEqual([0, 0, 1]);
    expect(top?.centroid[2]).toBeCloseTo(20, 6);
  });

  it('detects points inside and outside a closed mesh', () => {
    const mesh = cubeMesh();
    expect(pointInMesh(mesh, cubeCenter())).toBe(true);
    expect(pointInMesh(mesh, [10, 10, 0.1])).toBe(true);
    expect(pointInMesh(mesh, [25, 10, 10])).toBe(false);
    expect(pointInMesh(mesh, [-1, 10, 10])).toBe(false);
  });

  it('keeps the normal pointing out of the material', () => {
    const mesh = cubeMesh();
    expect(outwardNormal(mesh, 1)).toMatchObject({ normal: [1, 0, 0] });
    expect(outwardNormal(mesh, 0)).toMatchObject({ normal: [-1, 0, 0] });
    expect(outwardNormal(mesh, 5)).toMatchObject({ normal: [0, 0, 1] });
  });

  it('scales the probe to the body but keeps a floor', () => {
    expect(probeDistance(cubeMesh())).toBeGreaterThanOrEqual(0.01);
    expect(probeDistance(cubeMesh(1))).toBe(0.01);
  });
});
