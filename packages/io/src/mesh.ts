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

interface TopologyStats {
  boundaryEdges: number;
  componentCount: number;
  volume: number;
  surfaceArea: number;
}

function analyzeTopology(positions: Float32Array, indices: Uint32Array): TopologyStats {
  const welded = new Map<string, number>();
  const quantize = (value: number) => Math.round(value * 10_000);
  const vertexId = (index: number): number => {
    const key = `${quantize(positions[index * 3]!)},${quantize(positions[index * 3 + 1]!)},${quantize(positions[index * 3 + 2]!)}`;
    const existing = welded.get(key);
    if (existing !== undefined) return existing;
    const id = welded.size;
    welded.set(key, id);
    return id;
  };

  const parent: number[] = [];
  const find = (id: number): number => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]!]!;
      id = parent[id]!;
    }
    return id;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const edgeCounts = new Map<string, number>();
  let volume = 0;
  let surfaceArea = 0;

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const ia = indices[triangle]!;
    const ib = indices[triangle + 1]!;
    const ic = indices[triangle + 2]!;
    const a = vertexId(ia);
    const b = vertexId(ib);
    const c = vertexId(ic);
    for (const id of [a, b, c]) {
      if (parent[id] === undefined) parent[id] = id;
    }
    union(a, b);
    union(b, c);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }

    const ax = positions[ia * 3]!;
    const ay = positions[ia * 3 + 1]!;
    const az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!;
    const by = positions[ib * 3 + 1]!;
    const bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!;
    const cy = positions[ic * 3 + 1]!;
    const cz = positions[ic * 3 + 2]!;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    surfaceArea += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }

  let boundaryEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count !== 2) boundaryEdges += 1;
  }
  const roots = new Set<number>();
  for (let id = 0; id < parent.length; id += 1) roots.add(find(id));
  return {
    boundaryEdges,
    componentCount: roots.size,
    volume: Math.abs(volume),
    surfaceArea,
  };
}

export function buildParsedMesh(
  positions: Float32Array,
  indices: Uint32Array,
  normals?: Float32Array,
): ParsedMesh {
  const topology =
    positions.length > 0
      ? analyzeTopology(positions, indices)
      : { boundaryEdges: 0, componentCount: 0, volume: 0, surfaceArea: 0 };
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
      boundaryEdges: topology.boundaryEdges,
      watertight: topology.boundaryEdges === 0,
      volume: topology.volume,
      surfaceArea: topology.surfaceArea,
      componentCount: topology.componentCount,
    },
  } satisfies MeshData & ParsedMesh;
}
