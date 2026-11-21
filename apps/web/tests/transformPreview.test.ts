import type { Vec3 } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import { transformMatrix, transformPoint } from '../src/kernel/transformPlacement';
import { placementDelta, transformMesh } from '../src/kernel/transformPreview';
import { cubeMesh } from './cubeMesh';

interface Placement {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const still: Placement = { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
}

describe('transform preview', () => {
  it('takes one placement to another', () => {
    const before = transformMatrix(still, [0, 0, 0]);
    const after = transformMatrix(
      { translation: [10, 0, 0], rotation: [0, 0, 90], scale: 2 },
      [5, 5, 5],
    );
    const delta = placementDelta(after, before)!;
    const point: Vec3 = [3, 4, 5];
    near(transformPoint(delta, point), transformPoint(after, point));
  });

  it('moves a mesh placed at an earlier state to a later one', () => {
    const before = transformMatrix({ ...still, translation: [5, 0, 0] }, [5, 5, 5]);
    const after = transformMatrix(
      { ...still, translation: [5, 0, 0], rotation: [0, 0, 90] },
      [5, 5, 5],
    );
    const delta = placementDelta(after, before)!;
    // A point of the mesh as it was drawn reaches where the later placement
    // would put it.
    const drawn = transformPoint(before, [10, 5, 5]);
    near(transformPoint(delta, drawn), transformPoint(after, [10, 5, 5]));
  });

  it('moves positions, bounds and edges of a tessellation', () => {
    const mesh = cubeMesh(10);
    const moved = transformMesh(
      mesh,
      transformMatrix({ ...still, translation: [4, 0, 0] }, [0, 0, 0]),
    );
    near([moved.bbox.min[0], moved.bbox.max[0]], [4, 14]);
    near([moved.bbox.min[1], moved.bbox.max[1]], [0, 10]);
    near([moved.positions[0]!, moved.positions[1]!, moved.positions[2]!], [4, 0, 0]);
    // Indices describe the same triangles and stay shared.
    expect(moved.indices).toBe(mesh.indices);
    expect(moved.faceIds).toBe(mesh.faceIds);
  });

  it('turns normals with the surface and keeps them unit length', () => {
    const mesh = cubeMesh(10);
    const rotated = transformMesh(
      mesh,
      transformMatrix({ ...still, rotation: [0, 0, 90] }, [0, 0, 0]),
    );
    // The first face points along −X and ends up along −Y.
    near([rotated.normals[0]!, rotated.normals[1]!, rotated.normals[2]!], [0, -1, 0]);
    for (let index = 0; index < rotated.normals.length; index += 3) {
      expect(
        Math.hypot(
          rotated.normals[index]!,
          rotated.normals[index + 1]!,
          rotated.normals[index + 2]!,
        ),
      ).toBeCloseTo(1, 9);
    }
  });
});
