import { describe, expect, it } from 'vitest';
import type { TessellationResult } from '@icancad/kernel';
import { resolveFaceRef } from '../src/kernel/faceLookup';
import { cubeMesh } from './cubeMesh';

function translated(mesh: TessellationResult, offset: [number, number, number]): TessellationResult {
  const positions = new Float32Array(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = positions[index]! + offset[0];
    positions[index + 1] = positions[index + 1]! + offset[1];
    positions[index + 2] = positions[index + 2]! + offset[2];
  }
  return {
    ...mesh,
    positions,
    bbox: {
      min: [
        mesh.bbox.min[0] + offset[0],
        mesh.bbox.min[1] + offset[1],
        mesh.bbox.min[2] + offset[2],
      ],
      max: [
        mesh.bbox.max[0] + offset[0],
        mesh.bbox.max[1] + offset[1],
        mesh.bbox.max[2] + offset[2],
      ],
    },
  };
}

const stats = { faces: 6, edges: 12, solids: 1 };
const bodyShapes = new Map([
  ['a', 'shape-a'],
  ['b', 'shape-b'],
]);

describe('face ref lookup after a split', () => {
  it('keeps a face that still sits on the named body', () => {
    const meshes = { a: cubeMesh(), b: translated(cubeMesh(), [40, 0, 0]) };
    expect(
      resolveFaceRef(
        { bodyShapes, meshes, bodyStats: { a: stats, b: stats } },
        { bodyId: 'a', faceId: '1', normal: [1, 0, 0], origin: [20, 10, 10] },
      ),
    ).toEqual({ bodyId: 'a', faceId: 1 });
  });

  it('finds a face that a split moved to another body', () => {
    const meshes = { a: cubeMesh(), b: translated(cubeMesh(), [40, 0, 0]) };
    // The stored ref still names body a, but the pose only exists on body b.
    expect(
      resolveFaceRef(
        { bodyShapes, meshes, bodyStats: { a: stats, b: stats } },
        { bodyId: 'a', faceId: '1', normal: [-1, 0, 0], origin: [40, 10, 10] },
      ),
    ).toEqual({ bodyId: 'b', faceId: 0 });
  });

  it('falls back to the stored face when it was rebuilt in place', () => {
    const meshes = { a: cubeMesh(), b: translated(cubeMesh(), [40, 0, 0]) };
    expect(
      resolveFaceRef(
        { bodyShapes, meshes, bodyStats: { a: stats, b: stats } },
        { bodyId: 'a', faceId: '1', normal: [1, 0, 0], origin: [25, 10, 10] },
      ),
    ).toEqual({ bodyId: 'a', faceId: 1 });
  });

  it('reports a face that no longer exists', () => {
    const meshes = { a: cubeMesh(), b: translated(cubeMesh(), [40, 0, 0]) };
    expect(
      resolveFaceRef(
        { bodyShapes, meshes, bodyStats: { a: stats, b: stats } },
        {
          bodyId: 'missing',
          faceId: '0',
          normal: [1, 0, 0],
          origin: [100, 100, 100],
        },
      ),
    ).toBeNull();
  });
});
