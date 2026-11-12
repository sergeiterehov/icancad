import type { TessellationResult } from '@icancad/kernel';

/** Closed cube with one B-rep face id per side, for geometry tests. */
export function cubeMesh(size = 20): TessellationResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];

  const quad = (
    points: Array<[number, number, number]>,
    normal: [number, number, number],
    faceId: number,
  ) => {
    const base = positions.length / 3;
    for (const point of points) {
      positions.push(...point);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faceIds.push(faceId, faceId);
  };

  // -X
  quad(
    [
      [0, 0, 0],
      [0, 0, size],
      [0, size, size],
      [0, size, 0],
    ],
    [-1, 0, 0],
    0,
  );
  // +X
  quad(
    [
      [size, 0, 0],
      [size, size, 0],
      [size, size, size],
      [size, 0, size],
    ],
    [1, 0, 0],
    1,
  );
  // -Y
  quad(
    [
      [0, 0, 0],
      [size, 0, 0],
      [size, 0, size],
      [0, 0, size],
    ],
    [0, -1, 0],
    2,
  );
  // +Y
  quad(
    [
      [0, size, 0],
      [0, size, size],
      [size, size, size],
      [size, size, 0],
    ],
    [0, 1, 0],
    3,
  );
  // -Z
  quad(
    [
      [0, 0, 0],
      [0, size, 0],
      [size, size, 0],
      [size, 0, 0],
    ],
    [0, 0, -1],
    4,
  );
  // +Z
  quad(
    [
      [0, 0, size],
      [size, 0, size],
      [size, size, size],
      [0, size, size],
    ],
    [0, 0, 1],
    5,
  );

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(faceIds),
    triangleCount: 12,
    vertexCount: positions.length / 3,
    bbox: { min: [0, 0, 0], max: [size, size, size] },
    edges: [],
  };
}

export function cubeCenter(size = 20): [number, number, number] {
  return [size / 2, size / 2, size / 2];
}
