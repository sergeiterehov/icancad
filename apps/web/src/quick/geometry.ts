import type { TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';

export interface FaceRegion {
  centroid: Vec3;
  /** Unit normal, area-weighted over the face triangles. */
  normal: Vec3;
  area: number;
}

const INSIDE_EPSILON = 1e-9;

// Normalizing -0 keeps directions predictable in comparisons and tests.
function clean(value: number): number {
  return value === 0 ? 0 : value;
}

/** Area-weighted centroid and normal of one B-rep face of a tessellated body. */
export function faceRegion(mesh: TessellationResult, faceId: number): FaceRegion | null {
  return faceRegions(mesh).get(faceId) ?? null;
}

// Face lookup after a split asks for many faces of the same mesh, and the
// tessellation does not change while the mesh object lives.
const regionCache = new WeakMap<TessellationResult, ReadonlyMap<number, FaceRegion>>();

/** Centroid and normal of every face of a mesh, in one pass over its triangles. */
export function faceRegions(mesh: TessellationResult): ReadonlyMap<number, FaceRegion> {
  const cached = regionCache.get(mesh);
  if (cached) return cached;
  const { positions, indices, faceIds } = mesh;
  const sums = new Map<
    number,
    { area: number; cx: number; cy: number; cz: number; nx: number; ny: number; nz: number }
  >();
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    const faceId = faceIds[triangle]!;
    const a = indices[triangle * 3]! * 3;
    const b = indices[triangle * 3 + 1]! * 3;
    const c = indices[triangle * 3 + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const ux = positions[b]! - ax;
    const uy = positions[b + 1]! - ay;
    const uz = positions[b + 2]! - az;
    const vx = positions[c]! - ax;
    const vy = positions[c + 1]! - ay;
    const vz = positions[c + 2]! - az;
    const tnx = uy * vz - uz * vy;
    const tny = uz * vx - ux * vz;
    const tnz = ux * vy - uy * vx;
    const triangleArea = Math.hypot(tnx, tny, tnz) / 2;
    if (triangleArea <= INSIDE_EPSILON) continue;
    const entry = sums.get(faceId) ?? { area: 0, cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0 };
    entry.area += triangleArea;
    entry.cx += ((ax + positions[b]! + positions[c]!) / 3) * triangleArea;
    entry.cy += ((ay + positions[b + 1]! + positions[c + 1]!) / 3) * triangleArea;
    entry.cz += ((az + positions[b + 2]! + positions[c + 2]!) / 3) * triangleArea;
    entry.nx += tnx;
    entry.ny += tny;
    entry.nz += tnz;
    sums.set(faceId, entry);
  }
  const regions = new Map<number, FaceRegion>();
  for (const [faceId, entry] of sums) {
    if (entry.area <= INSIDE_EPSILON) continue;
    const length = Math.hypot(entry.nx, entry.ny, entry.nz);
    if (length <= INSIDE_EPSILON) continue;
    regions.set(faceId, {
      centroid: [
        clean(entry.cx / entry.area),
        clean(entry.cy / entry.area),
        clean(entry.cz / entry.area),
      ],
      normal: [
        clean(entry.nx / length),
        clean(entry.ny / length),
        clean(entry.nz / length),
      ],
      area: entry.area,
    });
  }
  regionCache.set(mesh, regions);
  return regions;
}

/** 0.1% of the body diagonal, but never below 0.01 mm. */
export function probeDistance(mesh: TessellationResult): number {
  const dx = mesh.bbox.max[0] - mesh.bbox.min[0];
  const dy = mesh.bbox.max[1] - mesh.bbox.min[1];
  const dz = mesh.bbox.max[2] - mesh.bbox.min[2];
  return Math.max(0.01, Math.hypot(dx, dy, dz) * 1e-3);
}

function rayHitsTriangle(
  origin: Vec3,
  direction: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): boolean {
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];
  const px = direction[1] * e2z - direction[2] * e2y;
  const py = direction[2] * e2x - direction[0] * e2z;
  const pz = direction[0] * e2y - direction[1] * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(determinant) < INSIDE_EPSILON) return false;
  const inverse = 1 / determinant;
  const tx = origin[0] - a[0];
  const ty = origin[1] - a[1];
  const tz = origin[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return distance > INSIDE_EPSILON;
}

function trianglePoint(mesh: TessellationResult, triangle: number, corner: number): Vec3 {
  const index = mesh.indices[triangle * 3 + corner]! * 3;
  return [mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!];
}

// Slightly irrational directions keep the ray away from mesh vertices and
// edges, where an even number of hits could be counted at the exact boundary.
const RAY_DIRECTIONS: readonly Vec3[] = [
  [0.995_037, 0.099_503, 0.0],
  [0.0, 0.995_037, 0.099_503],
  [0.099_503, 0.0, 0.995_037],
];

/** Whether a world point lies inside a closed tessellated solid. */
export function pointInMesh(mesh: TessellationResult, point: Vec3): boolean {
  const triangles = mesh.indices.length / 3;
  let insideVotes = 0;
  for (const direction of RAY_DIRECTIONS) {
    let hits = 0;
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      if (
        rayHitsTriangle(
          point,
          direction,
          trianglePoint(mesh, triangle, 0),
          trianglePoint(mesh, triangle, 1),
          trianglePoint(mesh, triangle, 2),
        )
      ) {
        hits += 1;
      }
    }
    if (hits % 2 === 1) insideVotes += 1;
  }
  return insideVotes >= 2;
}

/** Face normal that points out of the material, verified with a point probe. */
export function outwardNormal(
  mesh: TessellationResult,
  faceId: number,
): { centroid: Vec3; normal: Vec3 } | null {
  const region = faceRegion(mesh, faceId);
  if (!region) return null;
  const distance = probeDistance(mesh);
  const probe: Vec3 = [
    region.centroid[0] + region.normal[0] * distance,
    region.centroid[1] + region.normal[1] * distance,
    region.centroid[2] + region.normal[2] * distance,
  ];
  if (pointInMesh(mesh, probe)) {
    return {
      centroid: region.centroid,
      normal: [
        clean(-region.normal[0]),
        clean(-region.normal[1]),
        clean(-region.normal[2]),
      ],
    };
  }
  return { centroid: region.centroid, normal: region.normal };
}
