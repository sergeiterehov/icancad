export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface MeshStats {
  triangleCount: number;
  vertexCount: number;
  bounds: Bounds;
  boundaryEdges: number;
  watertight: boolean;
}

export interface ParsedMesh extends MeshData {
  stats: MeshStats;
}
