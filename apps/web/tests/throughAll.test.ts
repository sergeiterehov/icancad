import type { TessellationResult } from '@icancad/kernel';
import { describe, expect, it } from 'vitest';
import { modelSupport, throughAllDistance } from '../src/kernel/rebuild';

function meshOf(min: [number, number, number], max: [number, number, number]): TessellationResult {
  const positions: number[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) positions.push(x, y, z);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(),
    faceIds: new Uint32Array(),
    triangleCount: 0,
    vertexCount: positions.length / 3,
    bbox: { min, max },
  };
}

const length = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const normalize = (v: readonly number[]): [number, number, number] => {
  const l = length(v);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

describe('through-all reach', () => {
  it('reaches the farthest vertex along an oblique direction', () => {
    // A unit cube: the support along (1, 1, 1) is at the corner, not at any
    // bounding-box corner projected the same way, so a bounding-box estimate
    // would be short.
    const meshes = { body: meshOf([-1, -1, -1], [1, 1, 1]) };
    const direction = normalize([1, 1, 1]);
    expect(modelSupport(meshes, direction)).toBeCloseTo(Math.sqrt(3), 6);
  });

  it('cuts all the way through a body that is not axis aligned', () => {
    const mesh = meshOf([-5, -5, 0], [5, 5, 4]);
    const meshes = { body: mesh };
    // A sketch drawn on a slanted face: the plane goes through the top face and
    // its normal points down into the body.
    const normal = normalize([0, -0.5, 0.866]);
    const origin: [number, number, number] = [0, 0, 4];
    const distance = throughAllDistance({ origin, normal }, meshes, 1);
    // Every vertex has to end up behind the end of the cut.
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const offset =
        (mesh.positions[index]! - origin[0]!) * normal[0]! +
        (mesh.positions[index + 1]! - origin[1]!) * normal[1]! +
        (mesh.positions[index + 2]! - origin[2]!) * normal[2]!;
      expect(offset).toBeLessThan(distance);
    }
  });

  it('keeps a minimum reach when the model lies behind the sketch plane', () => {
    const meshes = { body: meshOf([-1, -1, -1], [1, 1, 1]) };
    expect(throughAllDistance({ origin: [0, 0, 50], normal: [0, 0, 1] }, meshes, 1)).toBe(10);
  });
});
