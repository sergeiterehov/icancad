import type { Bounds, MeshData, ParsedMesh, Vec3 } from './types';

export function computeBounds(positions: Float32Array): Bounds {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

export function computeSmoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle]! * 3;
    const b = indices[triangle + 1]! * 3;
    const c = indices[triangle + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const offset of [a, b, c]) {
      normals[offset] = normals[offset]! + nx;
      normals[offset + 1] = normals[offset + 1]! + ny;
      normals[offset + 2] = normals[offset + 2]! + nz;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!);
    if (length === 0) continue;
    normals[index] = normals[index]! / length;
    normals[index + 1] = normals[index + 1]! / length;
    normals[index + 2] = normals[index + 2]! / length;
  }
  return normals;
}

export function countBoundaryEdges(positions: Float32Array, indices: Uint32Array): number {
  const welded = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  const quantize = (value: number) => Math.round(value * 10_000);

  const vertexId = (index: number): number => {
    const key = `${quantize(positions[index * 3]!)},${quantize(positions[index * 3 + 1]!)},${quantize(positions[index * 3 + 2]!)}`;
    const existing = welded.get(key);
    if (existing !== undefined) return existing;
    const id = welded.size;
    welded.set(key, id);
    return id;
  };

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = vertexId(indices[triangle]!);
    const b = vertexId(indices[triangle + 1]!);
    const c = vertexId(indices[triangle + 2]!);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let boundary = 0;
  for (const count of edgeCounts.values()) {
    if (count !== 2) boundary += 1;
  }
  return boundary;
}

export function buildParsedMesh(
  positions: Float32Array,
  indices: Uint32Array,
  normals?: Float32Array,
): ParsedMesh {
  const boundaryEdges = positions.length > 0 ? countBoundaryEdges(positions, indices) : 0;
  return {
    positions,
    normals:
      normals && normals.length === positions.length
        ? normals
        : computeSmoothNormals(positions, indices),
    indices,
    stats: {
      triangleCount: Math.floor(indices.length / 3),
      vertexCount: positions.length / 3,
      bounds: computeBounds(positions),
      boundaryEdges,
      watertight: boundaryEdges === 0,
    },
  } satisfies MeshData & ParsedMesh;
}
