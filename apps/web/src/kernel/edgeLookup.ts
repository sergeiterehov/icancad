import type { TessellationResult } from '@icancad/kernel';
import type { BodyEdgeRef, Vec3 } from '@icancad/model';
import { edgeDirection, edgePose } from './edgeTreatment';

export interface ResolvedEdgeRef {
  bodyId: string;
  edgeId: string;
}

export interface EdgeLookupContext {
  bodyShapes: ReadonlyMap<string, string>;
  meshes: Record<string, TessellationResult>;
}

const DIRECTION_DOT = 0.999;
const POSITION_TOLERANCE = 1e-3;

function directionOf(start: Vec3, mid: Vec3, end: Vec3): Vec3 | null {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  if (length > 1e-9) {
    return [
      (end[0] - start[0]) / length,
      (end[1] - start[1]) / length,
      (end[2] - start[2]) / length,
    ];
  }
  // A closed edge ends where it starts; the chord to its middle still tells the
  // direction apart from any other closed edge.
  const chord = Math.hypot(mid[0] - start[0], mid[1] - start[1], mid[2] - start[2]);
  if (chord < 1e-9) return null;
  return [
    (mid[0] - start[0]) / chord,
    (mid[1] - start[1]) / chord,
    (mid[2] - start[2]) / chord,
  ];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Distance from a point to the polyline of an edge. */
function distanceToEdge(points: readonly number[], point: Vec3): number {
  let best = Infinity;
  for (let index = 0; index + 5 < points.length; index += 3) {
    const ax = points[index]!;
    const ay = points[index + 1]!;
    const az = points[index + 2]!;
    const bx = points[index + 3]!;
    const by = points[index + 4]!;
    const bz = points[index + 5]!;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy + (point[2] - az) * dz) / lengthSquared),
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

/** How far an edge is from the stored pose, or null when it does not match. */
export function edgeMatchDistance(
  edge: { points: number[] },
  ref: Pick<BodyEdgeRef, 'start' | 'mid' | 'end'>,
): number | null {
  const direction = edgeDirection(edge.points);
  const refDirection = directionOf(ref.start, ref.mid, ref.end);
  if (!direction || !refDirection) return null;
  const alignment =
    direction[0] * refDirection[0] +
    direction[1] * refDirection[1] +
    direction[2] * refDirection[2];
  if (Math.abs(alignment) < DIRECTION_DOT) return null;
  // The middle pins the span and one of the ends pins it along the line: a
  // rebuilt edge may list its points the other way round, so either end will do.
  const pose = edgePose(edge.points);
  const starts: Vec3[] = [pose.start, pose.end];
  const exact =
    distance(pose.mid, ref.mid) <= POSITION_TOLERANCE &&
    starts.some((start) => distance(start, ref.start) <= POSITION_TOLERANCE);
  if (exact) return distance(pose.mid, ref.mid);

  // The edge may have been picked on a shape where an earlier operation of the
  // same body had already trimmed it, so the stored span is only a piece of the
  // edge that is really there. That piece still says which edge was meant.
  const contained = Math.max(
    distanceToEdge(edge.points, ref.start),
    distanceToEdge(edge.points, ref.mid),
  );
  return contained <= POSITION_TOLERANCE ? POSITION_TOLERANCE : null;
}

/**
 * An edge ref first resolves against the body it names. A body rebuilt by a
 * later operation renumbers its traversal, so the stored pose finds the edge
 * again wherever it now lives.
 */
export function resolveEdgeRef(
  context: EdgeLookupContext,
  ref: BodyEdgeRef,
): ResolvedEdgeRef | null {
  const directMesh = context.meshes[ref.bodyId];
  if (directMesh && context.bodyShapes.has(ref.bodyId)) {
    const direct = directMesh.edges?.find(
      (edge) => edge.id === ref.edgeId && edgeMatchDistance(edge, ref) !== null,
    );
    if (direct) return { bodyId: ref.bodyId, edgeId: direct.id };
  }

  let best: { bodyId: string; edgeId: string; distance: number } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh) continue;
    for (const edge of mesh.edges ?? []) {
      const edgeDistance = edgeMatchDistance(edge, ref);
      if (edgeDistance === null) continue;
      if (!best || edgeDistance < best.distance) {
        best = { bodyId, edgeId: edge.id, distance: edgeDistance };
      }
    }
  }
  return best ? { bodyId: best.bodyId, edgeId: best.edgeId } : null;
}
