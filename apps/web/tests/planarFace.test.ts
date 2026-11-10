import { describe, expect, it } from 'vitest';
import type { TessellationResult } from '@icancad/kernel';
import { isPlanarFace } from '../src/viewport/planarFace';

function mesh(
  positions: number[],
  indices: number[],
  faceIds: number[],
): TessellationResult {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(faceIds),
    triangleCount: faceIds.length,
    vertexCount: positions.length / 3,
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
  };
}

describe('planar face detection', () => {
  it('accepts triangles that share one normal', () => {
    const quad = mesh(
      [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      [0, 1, 2, 0, 2, 3],
      [7, 7],
    );
    expect(isPlanarFace(quad, 7)).toBe(true);
  });

  it('rejects a face whose triangles bend away from each other', () => {
    const folded = mesh(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
      [0, 1, 2, 3, 4, 5],
      [7, 7],
    );
    expect(isPlanarFace(folded, 7)).toBe(false);
  });

  it('only considers triangles of the requested face', () => {
    const mixed = mesh(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
      [0, 1, 2, 3, 4, 5],
      [7, 8],
    );
    expect(isPlanarFace(mixed, 8)).toBe(true);
    expect(isPlanarFace(mixed, 9)).toBe(false);
  });
});
