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

/** How far an edge is from the stored pose, or null when it does not match. */
export function edgeMatchDistance(
  edge: { points: number[] },
  ref: Pick<BodyEdgeRef, 'mid' | 'bisector'> & { start: Vec3; end: Vec3 },
): number | null {
  const direction = edgeDirection(edge.points);
  if (!direction) return null;
  const refVector: Vec3 = [
    ref.end[0] - ref.start[0],
    ref.end[1] - ref.start[1],
    ref.end[2] - ref.start[2],
  ];
  const length = Math.hypot(refVector[0], refVector[1], refVector[2]);
  if (length < 1e-9) return null;
  const alignment =
    direction[0] * (refVector[0] / length) +
    direction[1] * (refVector[1] / length) +
    direction[2] * (refVector[2] / length);
  if (Math.abs(alignment) < DIRECTION_DOT) return null;
  const mid = edgePose(edge.points).mid;
  const distance = Math.hypot(mid[0] - ref.mid[0], mid[1] - ref.mid[1], mid[2] - ref.mid[2]);
  return distance <= POSITION_TOLERANCE ? distance : null;
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
      const distance = edgeMatchDistance(edge, ref);
      if (distance === null) continue;
      if (!best || distance < best.distance) best = { bodyId, edgeId: edge.id, distance };
    }
  }
  return best ? { bodyId: best.bodyId, edgeId: best.edgeId } : null;
}
