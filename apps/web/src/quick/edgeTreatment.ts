import type { TessellationResult } from '@icancad/kernel';
import {
  createId,
  isFeatureInHistory,
  type BodyEdgeRef,
  type BodyFaceRef,
  type EdgeTreatmentFeature,
  type EdgeTreatmentKind,
  type Project,
  type Vec3,
} from '@icancad/model';
import type { SelectionItem } from '../stores/documentStore';
import { selectedBodyFaces, selectedEdges } from '../stores/selection';
import {
  edgeBisector,
  edgePose,
  edgeTreatmentLimit as meshTreatmentLimit,
  treatedEdges,
} from '../kernel/edgeTreatment';
import { outwardNormal } from './geometry';

/** Edges and faces an edge treatment is attached to, as the user picked them. */
export interface EdgeTreatmentTarget {
  faceRefs: BodyFaceRef[];
  edgeRefs: BodyEdgeRef[];
}

export interface EdgeTreatmentGeometry {
  target: EdgeTreatmentTarget;
  /** Where the track sits and the direction it is drawn away from. */
  origin: Vec3;
  /** Outward bisector of the edge or normal of the face. */
  direction: Vec3;
  /** Edges use a dashed leader instead of an arrow from the anchor. */
  leader: boolean;
}

/** Below this a track is not offered; the operation would be invisible. */
export const MIN_EDGE_TREATMENT = 0.05;

/** The edge treatment the current selection is attached to. */
export function edgeTreatmentTargetFromSelection(
  project: Project,
  selection: readonly SelectionItem[],
  meshes: Record<string, TessellationResult>,
): EdgeTreatmentTarget | null {
  const faceRefs: BodyFaceRef[] = [];
  for (const face of selectedBodyFaces(selection)) {
    const body = project.bodies.find((candidate) => candidate.id === face.bodyId);
    if (!body || body.kind === 'mesh') return null;
    const mesh = meshes[face.bodyId];
    const normal = mesh ? outwardNormal(mesh, Number(face.faceId)) : null;
    if (!normal) return null;
    faceRefs.push({
      bodyId: face.bodyId,
      faceId: face.faceId,
      normal: normal.normal,
      origin: normal.centroid,
    });
  }

  const edgeRefs: BodyEdgeRef[] = [];
  for (const picked of selectedEdges(selection)) {
    const body = project.bodies.find((candidate) => candidate.id === picked.bodyId);
    if (!body || body.kind === 'mesh') return null;
    const mesh = meshes[picked.bodyId];
    const edge = mesh?.edges?.find((candidate) => candidate.id === picked.edgeId);
    if (!mesh || !edge) return null;
    const pose = edgePose(edge.points);
    const bisector = edgeBisector(mesh, edge.faceIds);
    if (!bisector) return null;
    edgeRefs.push({
      bodyId: picked.bodyId,
      edgeId: picked.edgeId,
      faceIds: [...edge.faceIds],
      ...pose,
      bisector,
    });
  }

  if (faceRefs.length === 0 && edgeRefs.length === 0) return null;
  return { faceRefs, edgeRefs };
}

/** Anchor and axis of the track: the first edge when there is one. */
export function edgeTreatmentGeometry(
  target: EdgeTreatmentTarget,
  meshes?: Record<string, TessellationResult>,
): EdgeTreatmentGeometry | null {
  const edge = target.edgeRefs[0];
  if (edge) {
    return { target, origin: edge.mid, direction: edge.bisector, leader: true };
  }
  const face = target.faceRefs[0];
  if (!face) return null;
  // A face is treated along its rim, so the track points out of the corner at
  // half the angle between that face and its neighbour. The stored pose is the
  // fallback once the operation has rebuilt the face.
  const mesh = meshes?.[face.bodyId];
  const rim = mesh ? faceRimPose(mesh, face) : null;
  if (rim) return { target, origin: rim.mid, direction: rim.bisector, leader: true };
  return { target, origin: face.origin, direction: face.normal, leader: false };
}

/** Middle and outward bisector of the first rim edge of a face. */
function faceRimPose(
  mesh: TessellationResult,
  face: BodyFaceRef,
): { mid: Vec3; bisector: Vec3 } | null {
  const [rim] = treatedEdges(mesh, { faceIds: [Number(face.faceId)], edgeIds: [] });
  if (!rim) return null;
  const bisector = edgeBisector(mesh, rim.faceIds);
  if (!bisector) return null;
  return { mid: edgePose(rim.points).mid, bisector };
}


/**
 * Upper bound of the size that can be applied, over every body in the target.
 * The kernel still decides the exact value: its applied size is the truth.
 */
export function edgeTreatmentLimit(
  target: EdgeTreatmentTarget,
  meshes: Record<string, TessellationResult>,
): number | null {
  const bodyIds = new Set<string>();
  for (const ref of [...target.faceRefs, ...target.edgeRefs]) bodyIds.add(ref.bodyId);

  let limit = Infinity;
  for (const bodyId of bodyIds) {
    const mesh = meshes[bodyId];
    if (!mesh) return null;
    const selection = treatmentSelection(target, bodyId);
    if (selection.faceIds.length === 0 && selection.edgeIds.length === 0) continue;
    const bodyLimit = meshTreatmentLimit(mesh, selection);
    if (bodyLimit === null) continue;
    if (bodyLimit < limit) limit = bodyLimit;
  }
  if (!Number.isFinite(limit)) return null;
  return limit >= MIN_EDGE_TREATMENT ? limit : null;
}

/** The faces and edges of one body inside a target. */
export function treatmentSelection(
  target: EdgeTreatmentTarget,
  bodyId: string,
): { faceIds: number[]; edgeIds: string[] } {
  return {
    faceIds: target.faceRefs
      .filter((ref) => ref.bodyId === bodyId)
      .map((ref) => Number(ref.faceId)),
    edgeIds: target.edgeRefs.filter((ref) => ref.bodyId === bodyId).map((ref) => ref.edgeId),
  };
}

/** The active edge treatment whose inputs are exactly this target, if any. */
export function findBoundEdgeTreatment(
  project: Project,
  target: EdgeTreatmentTarget,
): EdgeTreatmentFeature | undefined {
  const faces = new Set(target.faceRefs.map((ref) => `${ref.bodyId}#${ref.faceId}`));
  const edges = new Set(target.edgeRefs.map((ref) => `${ref.bodyId}#${ref.edgeId}`));
  for (let index = project.features.length - 1; index >= 0; index -= 1) {
    const feature = project.features[index];
    if (!feature || feature.type !== 'edge-treatment' || feature.suppressed) continue;
    if (!isFeatureInHistory(project, feature.id)) continue;
    if (feature.faceRefs.length !== faces.size || feature.edgeRefs.length !== edges.size) {
      continue;
    }
    if (
      feature.faceRefs.every((ref) => faces.has(`${ref.bodyId}#${ref.faceId}`)) &&
      feature.edgeRefs.every((ref) => edges.has(`${ref.bodyId}#${ref.edgeId}`))
    ) {
      return feature;
    }
  }
  return undefined;
}

export function buildQuickEdgeTreatment(
  target: EdgeTreatmentTarget,
  kind: EdgeTreatmentKind,
  size: number,
  name: string,
): EdgeTreatmentFeature {
  return {
    id: createId('feat'),
    name,
    suppressed: false,
    type: 'edge-treatment',
    kind,
    faceRefs: target.faceRefs.map((ref) => ({ ...ref })),
    edgeRefs: target.edgeRefs.map((ref) => ({ ...ref })),
    size: Math.max(0.001, Math.abs(size)),
  };
}
