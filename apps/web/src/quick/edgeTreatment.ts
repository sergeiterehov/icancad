import type { TessellationResult } from '@icancad/kernel';
import {
  createId,
  type BodyEdgeRef,
  type BodyFaceRef,
  type EdgeTreatmentFeature,
  type EdgeTreatmentKind,
  type Project,
  type Vec3,
} from '@icancad/model';
import type { SelectionItem } from '../stores/documentStore';
import { selectedBodyFaces, selectedEdges } from '../stores/selection';
import { edgeMatchDistance } from '../kernel/edgeLookup';
import {
  edgeBisector,
  edgeCorner,
  edgePose,
  edgeTreatmentLimit as meshTreatmentLimit,
  treatedEdges,
  type EdgeCorner,
} from '../kernel/edgeTreatment';
import { outwardNormal } from './geometry';

/** Edges and faces an edge treatment is attached to, as the user picked them. */
export interface EdgeTreatmentTarget {
  faceRefs: BodyFaceRef[];
  edgeRefs: BodyEdgeRef[];
}

export interface EdgeTreatmentGeometry {
  target: EdgeTreatmentTarget;
  /** Point on the first treated edge where the arrow starts. */
  origin: Vec3;
  /** Unit arrow direction: it points into the corner the treatment cuts. */
  direction: Vec3;
  /** Angle between the faces at that edge, on the side the new face appears. */
  wedge: number;
}

/** Below this the handle is not offered; the operation would be invisible. */
export const MIN_EDGE_TREATMENT = 0.05;

/**
 * How far the face a treatment creates sits from the edge, measured along the
 * handle arrow. A chamfer plane through both legs is `d·cos(wedge/2)` away; a
 * rounded corner reaches `r(1 − sin(wedge/2))/sin(wedge/2)` back from its centre.
 */
export function treatmentFaceOffset(
  kind: EdgeTreatmentKind,
  size: number,
  wedge: number,
): number {
  const half = clampHalfAngle(wedge);
  if (kind === 'chamfer') return Math.max(0, size) * Math.cos(half);
  const sine = Math.max(SINE_FLOOR, Math.sin(half));
  return (Math.max(0, size) * (1 - sine)) / sine;
}

/** The size a handle length stands for: the inverse of `treatmentFaceOffset`. */
export function treatmentSizeForOffset(
  kind: EdgeTreatmentKind,
  offset: number,
  wedge: number,
): number {
  const half = clampHalfAngle(wedge);
  if (kind === 'chamfer') return Math.max(0, offset) / Math.max(COSINE_FLOOR, Math.cos(half));
  const sine = Math.max(SINE_FLOOR, Math.sin(half));
  return (Math.max(0, offset) * sine) / Math.max(SINE_FLOOR, 1 - sine);
}

/** A fillet of a nearly flat corner has no room to show, so the angles clamp. */
const SINE_FLOOR = 0.05;
const COSINE_FLOOR = 0.05;

function clampHalfAngle(wedge: number): number {
  const half = Number.isFinite(wedge) ? wedge / 2 : Math.PI / 4;
  return Math.min(Math.PI / 2 - 0.001, Math.max(0.001, half));
}

/** The arrow points into the corner the treatment fills: inward on a body edge. */
function arrowDirection(bisector: Vec3, convex: boolean): Vec3 {
  const sign = convex ? -1 : 1;
  return [bisector[0] * sign, bisector[1] * sign, bisector[2] * sign];
}

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
    if (!mesh || !normal) return null;
    faceRefs.push(edgeTreatmentFaceRef(mesh, face.bodyId, face.faceId, normal));
  }

  const edgeRefs: BodyEdgeRef[] = [];
  for (const picked of selectedEdges(selection)) {
    const body = project.bodies.find((candidate) => candidate.id === picked.bodyId);
    if (!body || body.kind === 'mesh') return null;
    const mesh = meshes[picked.bodyId];
    if (!mesh) return null;
    const ref = edgeTreatmentEdgeRef(mesh, picked.bodyId, picked.edgeId);
    if (!ref) return null;
    edgeRefs.push(ref);
  }

  if (faceRefs.length === 0 && edgeRefs.length === 0) return null;
  return { faceRefs, edgeRefs };
}

/**
 * The arrow of the treatment: it stands on the first treated edge, or on the
 * first rim edge of a picked face, and points at the face the operation creates.
 */
export function edgeTreatmentGeometry(
  target: EdgeTreatmentTarget,
  meshes?: Record<string, TessellationResult>,
): EdgeTreatmentGeometry | null {
  const edge = target.edgeRefs[0];
  if (edge) {
    // The stored corner is what the pick measured; a reference saved before it
    // was stored falls back to the edge as it is in the input mesh.
    const corner =
      edge.wedge !== undefined && edge.convex !== undefined
        ? { wedge: edge.wedge, convex: edge.convex, bisector: edge.bisector }
        : liveCorner(meshes?.[edge.bodyId], edge);
    return {
      target,
      origin: edge.mid,
      direction: arrowDirection(corner?.bisector ?? edge.bisector, corner?.convex ?? true),
      wedge: corner?.wedge ?? Math.PI / 2,
    };
  }
  const face = target.faceRefs[0];
  if (!face) return null;
  const mesh = meshes?.[face.bodyId];
  const handle = face.handle ?? (mesh ? faceRimHandle(mesh, Number(face.faceId)) : null);
  if (!handle) return null;
  return { target, origin: handle.origin, direction: handle.direction, wedge: handle.wedge };
}

/**
 * Corner at the edge a reference names, read from the mesh that still has it.
 * The mesh of the finished operation no longer contains the edge it treated,
 * so this is meant for the input of the operation.
 */
function liveCorner(
  mesh: TessellationResult | undefined,
  ref: BodyEdgeRef,
): EdgeCorner | null {
  if (!mesh) return null;
  const edges = mesh.edges ?? [];
  const edge =
    edges.find((candidate) => edgeMatchDistance(candidate, ref) !== null) ??
    edges.find((candidate) => candidate.id === ref.edgeId);
  if (!edge) return null;
  return edgeCorner(mesh, edge.faceIds, edgePose(edge.points).mid);
}

/** An edge picked for a treatment, with the corner it sits in. */
export function edgeTreatmentEdgeRef(
  mesh: TessellationResult,
  bodyId: string,
  edgeId: string,
): BodyEdgeRef | null {
  const edge = mesh.edges?.find((candidate) => candidate.id === edgeId);
  if (!edge) return null;
  const pose = edgePose(edge.points);
  const corner = edgeCorner(mesh, edge.faceIds, pose.mid);
  // The corner reads the two faces next to the edge; the face average is only
  // the fallback for an edge the tessellation cannot describe.
  const bisector = corner?.bisector ?? edgeBisector(mesh, edge.faceIds);
  if (!bisector) return null;
  return {
    bodyId,
    edgeId,
    faceIds: [...edge.faceIds],
    ...pose,
    bisector,
    ...(corner ? { wedge: corner.wedge, convex: corner.convex } : {}),
  };
}

/** A face picked for a treatment; its handle is measured on the rim. */
export function edgeTreatmentFaceRef(
  mesh: TessellationResult,
  bodyId: string,
  faceId: string,
  pose: { centroid: Vec3; normal: Vec3 },
): BodyFaceRef {
  const rim = faceRimHandle(mesh, Number(faceId));
  return {
    bodyId,
    faceId,
    normal: pose.normal,
    origin: pose.centroid,
    ...(rim ? { handle: rim } : {}),
  };
}

/** Arrow pose on the first rim edge of a face: the same corner rule as an edge. */
function faceRimHandle(
  mesh: TessellationResult,
  faceId: number,
): { origin: Vec3; direction: Vec3; wedge: number } | null {
  const [rim] = treatedEdges(mesh, { faceIds: [faceId], edgeIds: [] });
  if (!rim) return null;
  const origin = edgePose(rim.points).mid;
  const corner = edgeCorner(mesh, rim.faceIds, origin);
  const bisector = corner?.bisector ?? edgeBisector(mesh, rim.faceIds);
  if (!bisector) return null;
  return {
    origin,
    direction: arrowDirection(bisector, corner?.convex ?? true),
    wedge: corner?.wedge ?? Math.PI / 2,
  };
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
