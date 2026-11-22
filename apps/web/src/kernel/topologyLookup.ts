import type { BodyEdge, TessellationResult } from '@icancad/kernel';
import type { BodyEdgeRef, Vec3 } from '@icancad/model';
import { faceRegion } from '../quick/geometry';
import { edgeDirection, edgePose } from './edgeTreatment';

/** The stable part of a face reference: which body instance and which name. */
export interface FaceRefLike {
  bodyId: string;
  name: string;
  normal: Vec3;
  origin: Vec3;
  /** Written by schema 8; its name may have moved with the geometry. */
  legacyPose?: boolean;
}

export interface ResolvedFaceRef {
  bodyId: string;
  faceId: number;
}

export interface ResolvedEdgeRef {
  bodyId: string;
  edgeId: string;
}

export interface TopologyLookupContext {
  bodyShapes: ReadonlyMap<string, string>;
  meshes: Record<string, TessellationResult>;
  /** Accepted so rebuild call sites can pass their existing context unchanged. */
  bodyStats?: Record<string, unknown>;
}

const NORMAL_DOT = 0.999;

function faceMatches(mesh: TessellationResult, faceId: number, name: string): boolean {
  const canonical = mesh.faceNames?.[faceId];
  if (canonical === name) return true;
  return mesh.faceAliases?.[faceId]?.includes(name) ?? false;
}

function faceDistance(
  mesh: TessellationResult,
  faceId: number,
  normal: Vec3,
  origin: Vec3,
): number {
  const region = faceRegion(mesh, faceId);
  if (!region) return Infinity;
  const centroid = region.centroid;
  const faceNormal = region.normal;
  const dot =
    faceNormal[0] * normal[0] + faceNormal[1] * normal[1] + faceNormal[2] * normal[2];
  if (Math.abs(dot) < NORMAL_DOT) return Infinity;
  return Math.hypot(
    centroid[0] - origin[0],
    centroid[1] - origin[1],
    centroid[2] - origin[2],
  );
}

const LEGACY_POSITION_TOLERANCE = 1e-3;
const LEGACY_DIRECTION_DOT = 0.999;
const LEGACY_CENTER_TOLERANCE = 0.01;

/**
 * The face a schema 8 reference pointed at, when its name no longer exists.
 *
 * Version 8 derived some names from the geometry of a face, so a parameter
 * edit could rename it. The pose written next to the name is exact enough to
 * find that same face again; a reference that has a name still resolves by
 * name and never reaches this path.
 */
function legacyFaceRef(
  context: TopologyLookupContext,
  ref: FaceRefLike,
): ResolvedFaceRef | null {
  let best: { bodyId: string; faceId: number; distance: number; sameBody: boolean } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh?.faceNames) continue;
    for (let faceId = 0; faceId < mesh.faceNames.length; faceId += 1) {
      const distance = faceDistance(mesh, faceId, ref.normal, ref.origin);
      if (distance > LEGACY_POSITION_TOLERANCE) continue;
      const sameBody = bodyId === ref.bodyId;
      if (
        !best ||
        Number(sameBody) > Number(best.sameBody) ||
        (sameBody === best.sameBody && distance < best.distance)
      ) {
        best = { bodyId, faceId, distance, sameBody };
      }
    }
  }
  return best ? { bodyId: best.bodyId, faceId: best.faceId } : null;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function pointDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function polylineCenter(points: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (let index = 0; index + 2 < points.length; index += 3) {
    x += points[index]!;
    y += points[index + 1]!;
    z += points[index + 2]!;
    count += 1;
  }
  return count === 0 ? [0, 0, 0] : [x / count, y / count, z / count];
}

function distanceToEdge(points: readonly number[], point: Vec3): number {
  let best = Infinity;
  for (let index = 0; index + 5 < points.length; index += 3) {
    const ax = points[index]!;
    const ay = points[index + 1]!;
    const az = points[index + 2]!;
    const dx = points[index + 3]! - ax;
    const dy = points[index + 4]! - ay;
    const dz = points[index + 5]! - az;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - ax) * dx + (point[1] - ay) * dy + (point[2] - az) * dz) /
                lengthSquared,
            ),
          );
    const distance = Math.hypot(
      point[0] - (ax + dx * t),
      point[1] - (ay + dy * t),
      point[2] - (az + dz * t),
    );
    if (distance < best) best = distance;
  }
  return best;
}

/** The centre of the circle through the stored start, middle and end. */
function refCenter(ref: Pick<BodyEdgeRef, 'start' | 'mid' | 'end'>): Vec3 {
  const a = ref.start;
  const ab = subtract(ref.mid, a);
  const ac = subtract(ref.end, a);
  const normal = cross(ab, ac);
  const denominator = 2 * dot(normal, normal);
  if (denominator < 1e-12) {
    return [
      (ref.start[0] + ref.mid[0] + ref.end[0]) / 3,
      (ref.start[1] + ref.mid[1] + ref.end[1]) / 3,
      (ref.start[2] + ref.mid[2] + ref.end[2]) / 3,
    ];
  }
  const term1 = cross(normal, ab).map((value) => value * dot(ac, ac)) as Vec3;
  const term2 = cross(ac, normal).map((value) => value * dot(ab, ab)) as Vec3;
  return [
    a[0] + (term1[0] + term2[0]) / denominator,
    a[1] + (term1[1] + term2[1]) / denominator,
    a[2] + (term1[2] + term2[2]) / denominator,
  ];
}

/** Circle through three points, or null for a straight line. */
function circleOf(points: readonly [Vec3, Vec3, Vec3]): { center: Vec3; radius: number } | null {
  const [a, b, c] = points;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const normal = cross(ab, ac);
  const denominator = 2 * dot(normal, normal);
  if (denominator < 1e-12) return null;
  const term1 = cross(normal, ab).map((value) => value * dot(ac, ac)) as Vec3;
  const term2 = cross(ac, normal).map((value) => value * dot(ab, ab)) as Vec3;
  const center: Vec3 = [
    a[0] + (term1[0] + term2[0]) / denominator,
    a[1] + (term1[1] + term2[1]) / denominator,
    a[2] + (term1[2] + term2[2]) / denominator,
  ];
  return { center, radius: pointDistance(center, a) };
}

function legacyEdgeDistance(edge: BodyEdge, ref: BodyEdgeRef): number | null {
  if (ref.closed !== undefined && ref.closed !== edge.closed) return null;
  const pose = edgePose(edge.points);
  const refCircle = circleOf([ref.start, ref.mid, ref.end]);
  const edgeCircle = circleOf([pose.start, pose.mid, pose.end]);
  if (refCircle && edgeCircle) {
    const centerDistance = pointDistance(refCircle.center, edgeCircle.center);
    const radiusTolerance = Math.max(LEGACY_POSITION_TOLERANCE, refCircle.radius * 1e-4);
    if (
      centerDistance <= LEGACY_POSITION_TOLERANCE &&
      Math.abs(refCircle.radius - edgeCircle.radius) <= radiusTolerance
    ) {
      // A boundary change can shorten an arc from either end without moving
      // the circle it lies on. The nearest arc on that circle is the edge the
      // reference meant.
      return distanceToEdge(edge.points, ref.mid);
    }
  }
  const direction = edgeDirection(edge.points);
  const refDirection = edgeDirection([...ref.start, ...ref.mid, ...ref.end]);
  if (!direction || !refDirection) return null;
  if (Math.abs(dot(direction, refDirection)) < LEGACY_DIRECTION_DOT) return null;
  const midDistance = pointDistance(pose.mid, ref.mid);
  if (midDistance <= LEGACY_POSITION_TOLERANCE) return midDistance;
  // A curved edge shortened by a sketch change keeps its middle while both
  // ends slide along the same curve. The stored span still identifies it when
  // it lies on the rebuilt edge.
  const contained = Math.max(
    distanceToEdge(edge.points, ref.start),
    distanceToEdge(edge.points, ref.mid),
  );
  return contained <= LEGACY_POSITION_TOLERANCE ? LEGACY_POSITION_TOLERANCE : null;
}

/** A schema 8 edge reference whose name no longer exists. */
function legacyEdgeRef(
  context: TopologyLookupContext,
  ref: BodyEdgeRef,
): ResolvedEdgeRef | null {
  let best: {
    bodyId: string;
    edgeId: string;
    distance: number;
    sameBody: boolean;
  } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh?.edges) continue;
    for (const edge of mesh.edges) {
      const distance = legacyEdgeDistance(edge, ref);
      const centerDistance =
        distance === null && ref.closed && edge.closed && bodyId === ref.bodyId
          ? pointDistance(polylineCenter(edge.points), refCenter(ref))
          : null;
      const matched = distance ?? (centerDistance !== null && centerDistance <= LEGACY_CENTER_TOLERANCE ? centerDistance : null);
      if (matched === null) continue;
      const sameBody = bodyId === ref.bodyId;
      if (
        !best ||
        Number(sameBody) > Number(best.sameBody) ||
        (sameBody === best.sameBody && matched < best.distance)
      ) {
        best = { bodyId, edgeId: edge.id, distance: matched, sameBody };
      }
    }
  }
  return best ? { bodyId: best.bodyId, edgeId: best.edgeId } : null;
}

/**
 * The face a reference names. The name is looked up on the body the reference
 * came from first; a face a boolean moved to another body is found by its name
 * there. A split face has several pieces with the same name, so the stored pose
 * picks the piece the user actually pointed at.
 */
export function resolveFaceRef(
  context: TopologyLookupContext,
  ref: FaceRefLike,
): ResolvedFaceRef | null {
  let best: { bodyId: string; faceId: number; rank: number; distance: number } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh?.faceNames) continue;
    for (let faceId = 0; faceId < mesh.faceNames.length; faceId += 1) {
      if (!faceMatches(mesh, faceId, ref.name)) continue;
      const canonical = mesh.faceNames[faceId] === ref.name;
      const sameBody = bodyId === ref.bodyId;
      const rank = (sameBody ? 0 : 2) + (canonical ? 0 : 1);
      const distance = faceDistance(mesh, faceId, ref.normal, ref.origin);
      if (
        !best ||
        rank < best.rank ||
        (rank === best.rank && distance < best.distance)
      ) {
        best = { bodyId, faceId, rank, distance };
      }
    }
  }
  if (best) return { bodyId: best.bodyId, faceId: best.faceId };
  return ref.legacyPose ? legacyFaceRef(context, ref) : null;
}

function edgeMatches(edge: BodyEdge, name: string): boolean {
  return edge.name === name || (edge.aliases?.includes(name) ?? false);
}

function edgeDistance(edge: BodyEdge, ref: BodyEdgeRef): number {
  const points = edge.points;
  if (points.length < 3) return Infinity;
  return Math.hypot(
    points[0]! - ref.start[0],
    points[1]! - ref.start[1],
    points[2]! - ref.start[2],
  );
}

/**
 * The edge a reference names. As with faces, the named body is tried first and
 * the stored pose only picks between pieces a split left with the same name.
 */
export function resolveEdgeRef(
  context: TopologyLookupContext,
  ref: BodyEdgeRef,
): ResolvedEdgeRef | null {
  let best: { bodyId: string; edgeId: string; rank: number; distance: number } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh?.edges) continue;
    for (const edge of mesh.edges) {
      if (!edgeMatches(edge, ref.name)) continue;
      const canonical = edge.name === ref.name;
      const sameBody = bodyId === ref.bodyId;
      const rank = (sameBody ? 0 : 2) + (canonical ? 0 : 1);
      const distance = edgeDistance(edge, ref);
      if (
        !best ||
        rank < best.rank ||
        (rank === best.rank && distance < best.distance)
      ) {
        best = { bodyId, edgeId: edge.id, rank, distance };
      }
    }
  }
  if (best) return { bodyId: best.bodyId, edgeId: best.edgeId };
  return ref.legacyPose ? legacyEdgeRef(context, ref) : null;
}

/** Face index of a name in one mesh, or null when the mesh does not have it. */
export function faceIdByName(
  mesh: TessellationResult | undefined,
  name: string | undefined,
): number | null {
  if (!mesh || !name) return null;
  const index = mesh.faceNames?.findIndex(
    (candidate, faceId) => candidate === name || (mesh.faceAliases?.[faceId]?.includes(name) ?? false),
  );
  return index === undefined || index < 0 ? null : index;
}

/** Edge record of a name in one mesh, or null when the mesh does not have it. */
export function edgeByName(
  mesh: TessellationResult | undefined,
  name: string | undefined,
): BodyEdge | null {
  if (!mesh || !name) return null;
  return mesh.edges?.find((edge) => edgeMatches(edge, name)) ?? null;
}
