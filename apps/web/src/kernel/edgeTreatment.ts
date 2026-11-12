import type { BodyEdge, TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { faceRegion } from '../quick/geometry';

/** Faces and edges of one body an edge treatment is attached to. */
export interface EdgeTreatmentSelection {
  faceIds: readonly number[];
  edgeIds: readonly string[];
}

export interface EdgePose {
  start: Vec3;
  mid: Vec3;
  end: Vec3;
}

function pointAt(points: readonly number[], index: number): Vec3 {
  return [points[index * 3]!, points[index * 3 + 1]!, points[index * 3 + 2]!];
}

function lastIndex(points: readonly number[]): number {
  return Math.max(0, Math.floor(points.length / 3) - 1);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** Start, middle and end of an edge polyline. */
export function edgePose(points: readonly number[]): EdgePose {
  const start = pointAt(points, 0);
  const end = pointAt(points, lastIndex(points));
  const count = lastIndex(points) + 1;
  // A tessellated edge has a vertex near its middle already; a straight two
  // point edge only gets one by averaging.
  const mid: Vec3 =
    count > 2
      ? pointAt(points, Math.floor((count - 1) / 2))
      : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
  return { start, mid, end };
}

/**
 * Direction of an edge. A closed edge, such as the rim of a cylinder, starts and
 * ends at the same point, so the chord to its middle vertex is used instead.
 */
export function edgeDirection(points: readonly number[]): Vec3 | null {
  const start = pointAt(points, 0);
  const end = pointAt(points, lastIndex(points));
  return normalize(subtract(end, start)) ?? normalize(subtract(edgePose(points).mid, start));
}

/**
 * Direction that points out of the material along an edge. The sum of the two
 * adjacent face normals always points into free space, for a convex and for a
 * concave edge alike, so a positive drag is always "round it" and a negative
 * one is always "cut it".
 */
export function edgeBisector(mesh: TessellationResult, faceIds: readonly number[]): Vec3 | null {
  const normals = faceIds
    .map((faceId) => faceRegion(mesh, faceId)?.normal)
    .filter((normal): normal is Vec3 => Boolean(normal));
  if (normals.length === 0) return null;
  return normalize(
    normals.reduce<Vec3>(
      (sum, normal) => [sum[0] + normal[0], sum[1] + normal[1], sum[2] + normal[2]],
      [0, 0, 0],
    ),
  );
}

export interface EdgeCorner {
  /** Angle between the two faces where the treatment face appears, radians. */
  wedge: number;
  /** The material fills the corner, as on the edge of a body. */
  convex: boolean;
  /** Bisector of the two faces at the edge, pointing away from the material. */
  bisector: Vec3;
}

/** Nearest triangle of a face to a point, as its centroid and smooth normal. */
function nearestTriangle(
  mesh: TessellationResult,
  faceId: number,
  at: Vec3,
): { centroid: Vec3; normal: Vec3 } | null {
  const { positions, indices, faceIds, normals } = mesh;
  let best: { centroid: Vec3; normal: Vec3 } | null = null;
  let bestDistance = Infinity;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    const corners = [0, 1, 2].map((corner) => indices[triangle * 3 + corner]!);
    const points = corners.map(
      (index): Vec3 => [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!],
    );
    const centroid: Vec3 = [
      (points[0]![0] + points[1]![0] + points[2]![0]) / 3,
      (points[0]![1] + points[1]![1] + points[2]![1]) / 3,
      (points[0]![2] + points[1]![2] + points[2]![2]) / 3,
    ];
    const distance = Math.hypot(
      centroid[0] - at[0],
      centroid[1] - at[1],
      centroid[2] - at[2],
    );
    if (distance >= bestDistance) continue;
    // The vertex normals are smooth, so they follow a curved face where the
    // area-weighted normal of the whole face would cancel out.
    const normal = normalize(
      corners.reduce<Vec3>(
        (sum, index) => [
          sum[0] + (normals[index * 3] ?? 0),
          sum[1] + (normals[index * 3 + 1] ?? 0),
          sum[2] + (normals[index * 3 + 2] ?? 0),
        ],
        [0, 0, 0],
      ),
    );
    if (!normal) continue;
    bestDistance = distance;
    best = { centroid, normal };
  }
  return best;
}

/**
 * Shape of the corner at an edge. `wedge` is the angle between the two faces on
 * the side the new face appears, so a treatment of size `s` sits at
 * `s·cos(wedge/2)` (chamfer) or `s(1 − sin(wedge/2))/sin(wedge/2)` (fillet) from
 * the edge. `convex` says whether that face ends up inside the body.
 *
 * Both readings come from the triangles next to the edge rather than from the
 * whole faces: a face such as the side of a cylinder has no single normal. The
 * bisector of the two normals always points into free space, so the material
 * side is found by asking which side of one face the other face leaves from.
 */
export function edgeCorner(
  mesh: TessellationResult,
  faceIds: readonly number[],
  at: Vec3,
): EdgeCorner | null {
  const [firstId, secondId] = faceIds;
  if (firstId === undefined || secondId === undefined) return null;
  const first = nearestTriangle(mesh, firstId, at);
  const second = nearestTriangle(mesh, secondId, at);
  if (!first || !second) return null;
  const bisector = normalize([
    first.normal[0] + second.normal[0],
    first.normal[1] + second.normal[1],
    first.normal[2] + second.normal[2],
  ]);
  if (!bisector) return null;
  const cosine = Math.max(-1, Math.min(1, dot(first.normal, second.normal)));
  const wedge = Math.PI - Math.acos(cosine);
  // Free space between two faces meets at the edge; the material fills the
  // corner when each face leaves the edge on the far side of the other's plane.
  const convex =
    dot(subtract(second.centroid, at), first.normal) +
      dot(subtract(first.centroid, at), second.normal) <
    0;
  return { wedge, convex, bisector };
}

/** Edges the operation will treat: picked ones plus the rim of picked faces. */
export function treatedEdges(
  mesh: TessellationResult,
  selection: EdgeTreatmentSelection,
): BodyEdge[] {
  const picked = new Set(selection.edgeIds);
  const faces = new Set(selection.faceIds);
  const chosen: BodyEdge[] = [];
  for (const edge of mesh.edges ?? []) {
    if (picked.has(edge.id)) {
      chosen.push(edge);
      continue;
    }
    if (faces.size === 0) continue;
    const inside = edge.faceIds.filter((face) => faces.has(face)).length;
    // An edge between two selected faces is inside the selection; only the rim
    // shared with faces that stay untouched is treated.
    if (inside > 0 && inside < edge.faceIds.length) chosen.push(edge);
  }
  return chosen;
}

const spans = new WeakMap<TessellationResult, Map<number, Map<string, number>>>();

/**
 * How far a face reaches away from an edge. A radius larger than that would
 * need more material than the face has, so it is the natural ceiling.
 */
function faceSpan(mesh: TessellationResult, faceId: number, edge: BodyEdge): number {
  let byEdge = spans.get(mesh)?.get(faceId);
  if (!byEdge) {
    byEdge = new Map();
    const cached = spans.get(mesh) ?? new Map<number, Map<string, number>>();
    cached.set(faceId, byEdge);
    spans.set(mesh, cached);
  }
  const known = byEdge.get(edge.id);
  if (known !== undefined) return known;

  const start = pointAt(edge.points, 0);
  const axis = edgeDirection(edge.points) ?? ([1, 0, 0] as Vec3);
  let span = 0;
  const { positions, indices, faceIds } = mesh;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const index = indices[triangle * 3 + corner]! * 3;
      const offset = subtract([positions[index]!, positions[index + 1]!, positions[index + 2]!], start);
      const along = dot(offset, axis);
      const distance = Math.hypot(
        offset[0] - axis[0] * along,
        offset[1] - axis[1] * along,
        offset[2] - axis[2] * along,
      );
      if (distance > span) span = distance;
    }
  }
  byEdge.set(edge.id, span);
  return span;
}

/**
 * Upper bound of the size that can be applied to one body. A face reached from
 * both sides by parallel edges has to fit both treatments, so it is split
 * between them. The kernel still decides the exact value: its applied size is
 * the truth.
 */
export function edgeTreatmentLimit(
  mesh: TessellationResult,
  selection: EdgeTreatmentSelection,
): number | null {
  const edges = treatedEdges(mesh, selection);
  if (edges.length === 0) return null;
  const directions = new Map(edges.map((edge) => [edge.id, edgeDirection(edge.points)] as const));
  let limit = Infinity;
  for (const edge of edges) {
    const direction = directions.get(edge.id);
    for (const faceId of edge.faceIds) {
      const span = faceSpan(mesh, faceId, edge);
      let parallel = 0;
      for (const other of edges) {
        if (!other.faceIds.includes(faceId)) continue;
        const otherDirection = directions.get(other.id);
        if (!direction || !otherDirection) continue;
        if (Math.abs(dot(direction, otherDirection)) > 0.9) parallel += 1;
      }
      const size = span / Math.max(1, parallel);
      if (size < limit) limit = size;
    }
  }
  if (!Number.isFinite(limit)) return null;
  return Math.round(limit * 1000) / 1000;
}
