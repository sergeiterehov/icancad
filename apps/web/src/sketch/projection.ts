import type { BodyEdge, TessellationResult } from '@icancad/kernel';
import {
  createStableId,
  type SketchEntity,
  type SketchFeature,
  type SketchFrame,
  type SketchProjection,
  type Vec3,
} from '@icancad/model';
import {
  projectPointToFrame,
  projectPolylineToFrame,
  polylineSagitta,
  sketchCurveFromPolyline,
  sketchCurvesFromPolyline,
  sketchPointFromProjected,
  stitchCurves,
  type Point2,
  type SketchEntityDraft,
} from '@icancad/sketch';
import { faceSilhouettes } from './silhouette';

/** What a projection click in the 3D view landed on. */
export type ProjectionPick =
  | { kind: 'vertex'; bodyId: string; elementId: string; position: Vec3 }
  | { kind: 'edge'; bodyId: string; edgeId: string }
  | { kind: 'face'; bodyId: string; faceId: string };

interface BodyElements {
  /** Vertices by their stable id: the edges that meet there. */
  vertices: Map<string, Vec3>;
  /** Position-based ids, which links written by older builds still use. */
  vertexIds: Map<string, string>;
  edges: Map<string, BodyEdge>;
}

const elementCache = new WeakMap<TessellationResult, BodyElements>();

/** Id of a vertex from its rounded position; unstable once the vertex moves. */
export function vertexElementId(point: Vec3): string {
  return `v:${point.map((value) => Math.round(value * 1e3) / 1e3).join(',')}`;
}

/**
 * Stable id of a vertex: the edges that meet there. Resizing a body keeps the
 * edges and their ids, so a projected corner follows the model instead of
 * losing its link the moment the vertex moves.
 */
export function vertexEdgeElementId(edgeIds: Iterable<string>): string | null {
  const ids = [...edgeIds].sort();
  return ids.length > 0 ? `v:${ids.join('+')}` : null;
}

export function bodyElements(mesh: TessellationResult): BodyElements {
  const cached = elementCache.get(mesh);
  if (cached) return cached;
  const edges = new Map<string, BodyEdge>();
  const byPosition = new Map<string, Vec3>();
  const incident = new Map<string, string[]>();
  for (const edge of mesh.edges ?? []) {
    edges.set(edge.id, edge);
    if (edge.closed) continue;
    const count = edge.points.length / 3;
    if (count < 2) continue;
    for (const index of [0, count - 1]) {
      const point: Vec3 = [
        edge.points[index * 3]!,
        edge.points[index * 3 + 1]!,
        edge.points[index * 3 + 2]!,
      ];
      const position = vertexElementId(point);
      byPosition.set(position, point);
      const list = incident.get(position) ?? [];
      list.push(edge.id);
      incident.set(position, list);
    }
  }
  const vertices = new Map<string, Vec3>();
  const vertexIds = new Map<string, string>();
  for (const [position, point] of byPosition) {
    const id = vertexEdgeElementId(incident.get(position) ?? []) ?? position;
    vertices.set(id, point);
    vertexIds.set(position, id);
  }
  const elements = { vertices, vertexIds, edges };
  elementCache.set(mesh, elements);
  return elements;
}

export function edgeWorldPoints(edge: BodyEdge): Vec3[] {
  const points: Vec3[] = [];
  for (let index = 0; index + 2 < edge.points.length; index += 3) {
    points.push([edge.points[index]!, edge.points[index + 1]!, edge.points[index + 2]!]);
  }
  return points;
}

function sourceKey(source: SketchProjection['source']): string {
  return `${source.bodyId}:${source.kind}:${source.elementId}`;
}

/**
 * Stable ids mean projecting the same source again lands on the same entity,
 * even if it was detached from its source in between: the link is restored and
 * the geometry is refreshed instead of adding a second copy with the same id.
 */
function replaceEntity(entities: SketchEntity[], entity: SketchEntity): void {
  const index = entities.findIndex((candidate) => candidate.id === entity.id);
  if (index >= 0) entities[index] = entity;
  else entities.push(entity);
}

export function projectionEntityIds(feature: SketchFeature): Set<string> {
  return new Set((feature.projections ?? []).map((projection) => projection.entityId));
}

export function isProjectedEntity(feature: SketchFeature, entityId: string): boolean {
  return (feature.projections ?? []).some((projection) => projection.entityId === entityId);
}

function projectedCurve(frame: SketchFrame, edge: BodyEdge): SketchEntityDraft | null {
  const projected = projectPolylineToFrame(frame, edgeWorldPoints(edge));
  return sketchCurveFromPolyline(projected, edge.closed, {
    tolerance: polylineSagitta(projected),
  });
}

/**
 * Contour curves of a face, named after the face and their place in the
 * left-to-right order, so the same face keeps its links when the body changes.
 * A flat face has none: its boundary edges are the whole contour.
 */
function silhouetteCurves(
  mesh: TessellationResult,
  frame: SketchFrame,
  faceId: string,
): Array<{ elementId: string; curve: SketchEntityDraft }> {
  const index = Number(faceId);
  if (!Number.isFinite(index)) return [];
  const projected = faceSilhouettes(mesh, index, frame.normal)
    .map((silhouette) => {
      const points = projectPolylineToFrame(frame, silhouette.points);
      return {
        left: Math.min(...points.map((point) => point[0])),
        bottom: Math.min(...points.map((point) => point[1])),
        // The outline comes from the tessellated surface, so it misses the real
        // curve by the sagitta of the mesh: fitting tighter than that would
        // turn every arc into a Bezier.
        curves: sketchCurvesFromPolyline(points, silhouette.closed, {
          tolerance: polylineSagitta(points),
        }),
      };
    })
    .sort((first, second) => first.left - second.left || first.bottom - second.bottom);
  const curves: Array<{ elementId: string; curve: SketchEntityDraft }> = [];
  for (const entry of projected) {
    for (const curve of entry.curves) {
      curves.push({ elementId: `${faceId}#${curves.length}`, curve });
    }
  }
  return curves;
}

interface FaceCurve {
  elementId: string;
  kind: 'edge' | 'silhouette';
  curve: SketchEntityDraft;
}

/** How far two ends of one contour may miss each other and still be joined. */
function contourTolerance(curves: readonly SketchEntityDraft[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const curve of curves) {
    for (const point of curveSamples(curve)) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1e-6);
  return Math.min(Math.max(extent * 5e-3, 1e-4), 0.5);
}

function curveSamples(curve: SketchEntityDraft): Point2[] {
  switch (curve.type) {
    case 'line':
      return [
        [curve.x1, curve.y1],
        [curve.x2, curve.y2],
      ];
    case 'arc':
      return [
        [curve.cx - curve.r, curve.cy - curve.r],
        [curve.cx + curve.r, curve.cy + curve.r],
      ];
    case 'circle':
      return [
        [curve.cx - curve.r, curve.cy - curve.r],
        [curve.cx + curve.r, curve.cy + curve.r],
      ];
    case 'ellipse': {
      const scale = Math.max(curve.rx, curve.ry);
      return [
        [curve.cx - scale, curve.cy - scale],
        [curve.cx + scale, curve.cy + scale],
      ];
    }
    case 'bezier':
      return curve.points;
    default:
      return [];
  }
}

/**
 * Everything a face contributes: its boundary edges and the contour of the
 * surface. The pieces are fitted one by one, so their ends are joined
 * afterwards; otherwise the projected outline is a set of curves that almost
 * meet, which is no use as an extrudable profile.
 */
function faceContourCurves(
  mesh: TessellationResult,
  frame: SketchFrame,
  faceId: string,
): FaceCurve[] {
  const index = Number(faceId);
  if (!Number.isFinite(index)) return [];
  const elements = bodyElements(mesh);
  const entries: FaceCurve[] = [];
  for (const edge of elements.edges.values()) {
    if (!edge.faceIds.includes(index)) continue;
    const curve = projectedCurve(frame, edge);
    if (curve) entries.push({ elementId: edge.id, kind: 'edge', curve });
  }
  for (const entry of silhouetteCurves(mesh, frame, faceId)) {
    entries.push({ elementId: entry.elementId, kind: 'silhouette', curve: entry.curve });
  }
  if (entries.length < 2) return entries;
  const stitched = stitchCurves(
    entries.map((entry) => entry.curve),
    contourTolerance(entries.map((entry) => entry.curve)),
  );
  return entries.map((entry, position) => ({
    ...entry,
    curve: stitched[position] ?? entry.curve,
  }));
}

// Rebuilding a sketch resolves every link of a face separately, so the contour
// is computed once per face and shared by its links.
const faceCurveCacheEntries = new Map<string, FaceCurve[]>();

function faceCurveCache(
  mesh: TessellationResult,
  frame: SketchFrame,
  bodyId: string,
  faceId: string,
): FaceCurve[] {
  const key = `${bodyId}|${faceId}|${frame.origin.join(',')}|${frame.normal.join(',')}`;
  const cached = faceCurveCacheEntries.get(key);
  if (cached) return cached;
  const curves = faceContourCurves(mesh, frame, faceId);
  if (faceCurveCacheEntries.size > 64) faceCurveCacheEntries.clear();
  faceCurveCacheEntries.set(key, curves);
  return curves;
}

/**
 * Joins the ends of every projected curve of the sketch. Two neighbouring faces
 * share their boundary edge, and each face joins that edge to its own contour,
 * so the shared edge has to meet both: stitching only inside one face leaves the
 * other face open and unselectable for an extrude.
 */
function stitchProjected(entities: SketchEntity[], projectedIds: Set<string>): SketchEntity[] {
  const positions: number[] = [];
  const drafts: SketchEntityDraft[] = [];
  entities.forEach((entity, index) => {
    if (!projectedIds.has(entity.id)) return;
    positions.push(index);
    const { id, ...draft } = entity;
    void id;
    drafts.push(draft as SketchEntityDraft);
  });
  if (drafts.length < 2) return entities;
  const stitched = stitchCurves(drafts, contourTolerance(drafts));
  if (stitched.length !== drafts.length) return entities;
  const next = [...entities];
  positions.forEach((position, index) => {
    const original = entities[position]!;
    next[position] = { ...stitched[index]!, id: original.id } as SketchEntity;
  });
  return next;
}

/**
 * Adds the geometry a click in the 3D view stands for to the sketch: a vertex
 * becomes a point, an edge becomes a curve, and a face contributes its boundary
 * edges and their corner points. Nothing is added twice.
 */
export function addProjectionToSketch(
  feature: SketchFeature,
  frame: SketchFrame,
  mesh: TessellationResult,
  pick: ProjectionPick,
): SketchFeature | null {
  const projections = [...(feature.projections ?? [])];
  const entities = [...feature.entities];
  const known = new Set(projections.map((projection) => sourceKey(projection.source)));
  const elements = bodyElements(mesh);
  let changed = false;

  const stableVertexId = (point: Vec3): string => {
    const position = vertexElementId(point);
    return elements.vertexIds.get(position) ?? position;
  };

  const addVertex = (
    bodyId: string,
    point: Vec3,
    elementId = stableVertexId(point),
    faceId?: string,
  ) => {
    const key = `${bodyId}:vertex:${elementId}`;
    if (known.has(key)) return;
    known.add(key);
    const entity: SketchEntity = {
      id: createStableId('entity', 'projection', key),
      ...sketchPointFromProjected(projectPointToFrame(frame, point)),
    };
    replaceEntity(entities, entity);
    projections.push({
      id: createStableId('proj', key),
      entityId: entity.id,
      source: { kind: 'vertex', bodyId, elementId },
      ...(faceId ? { faceId } : {}),
    });
    changed = true;
  };

  const addEdge = (bodyId: string, edgeId: string, faceId?: string) => {
    const key = `${bodyId}:edge:${edgeId}`;
    if (known.has(key)) return;
    const edge = elements.edges.get(edgeId);
    if (!edge) return;
    const curve = projectedCurve(frame, edge);
    if (!curve) return;
    known.add(key);
    const entity = {
      id: createStableId('entity', 'projection', key),
      ...curve,
    } as SketchEntity;
    replaceEntity(entities, entity);
    projections.push({
      id: createStableId('proj', key),
      entityId: entity.id,
      source: { kind: 'edge', bodyId, elementId: edgeId },
      ...(faceId ? { faceId } : {}),
    });
    changed = true;
  };

  if (pick.kind === 'vertex') {
    addVertex(pick.bodyId, pick.position, pick.elementId);
  } else if (pick.kind === 'edge') {
    addEdge(pick.bodyId, pick.edgeId);
  } else {
    const faceId = Number(pick.faceId);
    const boundary = [...elements.edges.values()].filter((edge) => edge.faceIds.includes(faceId));
    // Corners projected before vertices were named after their edges point at a
    // position that a resize has moved away from. Projecting the face again
    // replaces those broken links with the corners added below.
    const replacesBrokenCorner = (projection: SketchProjection): boolean =>
      projection.source.kind === 'vertex' &&
      projection.source.bodyId === pick.bodyId &&
      projection.faceId === pick.faceId &&
      // Position-based ids are the ones older builds wrote.
      projection.source.elementId.includes(',') &&
      !elements.vertices.has(projection.source.elementId) &&
      !elements.vertexIds.has(projection.source.elementId);
    for (let index = projections.length - 1; index >= 0; index -= 1) {
      const projection = projections[index]!;
      if (!replacesBrokenCorner(projection)) continue;
      known.delete(sourceKey(projection.source));
      projections.splice(index, 1);
      const entity = entities.findIndex((candidate) => candidate.id === projection.entityId);
      if (entity >= 0) entities.splice(entity, 1);
      changed = true;
    }
    for (const entry of faceContourCurves(mesh, frame, pick.faceId)) {
      const key = `${pick.bodyId}:${entry.kind}:${entry.elementId}`;
      if (known.has(key)) continue;
      known.add(key);
      const entity = {
        id: createStableId('entity', 'projection', key),
        ...entry.curve,
      } as SketchEntity;
      replaceEntity(entities, entity);
      projections.push({
        id: createStableId('proj', key),
        entityId: entity.id,
        source: { kind: entry.kind, bodyId: pick.bodyId, elementId: entry.elementId },
        faceId: pick.faceId,
      });
      changed = true;
    }
    for (const edge of boundary) {
      if (edge.closed) continue;
      const points = edgeWorldPoints(edge);
      if (points.length === 0) continue;
      addVertex(pick.bodyId, points[0]!, undefined, pick.faceId);
      addVertex(pick.bodyId, points[points.length - 1]!, undefined, pick.faceId);
    }
  }

  if (!changed) return null;
  return {
    ...feature,
    entities: stitchProjected(
      entities,
      new Set(projections.map((projection) => projection.entityId)),
    ),
    projections,
  };
}

export interface ProjectionResolution {
  entities: SketchEntity[];
  lostEntityIds: string[];
}

/**
 * Rebuilds the linked entities from the current body geometry. A source that no
 * longer exists leaves the stored snapshot in place and is reported as lost;
 * the snapshot is the whole reason a projection survives the loss of its
 * reference. Regenerated entities are ordinary geometry: only the construction
 * flag, which the user owns, is taken from the snapshot.
 */
export function resolveSketchProjections(
  feature: SketchFeature,
  frame: SketchFrame,
  meshOf: (bodyId: string) => TessellationResult | undefined,
): ProjectionResolution {
  const projections = feature.projections ?? [];
  if (projections.length === 0) return { entities: feature.entities, lostEntityIds: [] };
  const byId = new Map(feature.entities.map((entity) => [entity.id, entity]));
  const replacements = new Map<string, SketchEntity>();
  const lostEntityIds: string[] = [];
  for (const projection of projections) {
    const snapshot = byId.get(projection.entityId);
    if (!snapshot) continue;
    const mesh = meshOf(projection.source.bodyId);
    const elements = mesh ? bodyElements(mesh) : null;
    let entity: SketchEntity | null = null;
    if (elements && projection.source.kind === 'vertex') {
      // Links written before vertices took their ids from the incident edges
      // carry a position instead.
      const point =
        elements.vertices.get(projection.source.elementId) ??
        elements.vertices.get(elements.vertexIds.get(projection.source.elementId) ?? '');
      if (point) {
        entity = {
          id: projection.entityId,
          ...sketchPointFromProjected(projectPointToFrame(frame, point)),
          // The construction flag is the user's choice, so it survives a refresh.
          construction: snapshot.construction,
        };
      }
    } else if (elements && projection.faceId) {
      const curves = faceCurveCache(mesh!, frame, projection.source.bodyId, projection.faceId);
      const curve = curves.find(
        (entry) =>
          entry.kind === projection.source.kind &&
          entry.elementId === projection.source.elementId,
      );
      if (curve) {
        entity = {
          id: projection.entityId,
          ...curve.curve,
          construction: snapshot.construction,
        };
      }
    } else if (elements) {
      const edge = elements.edges.get(projection.source.elementId);
      if (edge) {
        const curve = projectedCurve(frame, edge);
        if (curve) {
          entity = { id: projection.entityId, ...curve, construction: snapshot.construction };
        }
      }
    }
    if (entity) replacements.set(projection.entityId, entity);
    else lostEntityIds.push(projection.entityId);
  }
  const resolved = feature.entities.map((entity) => replacements.get(entity.id) ?? entity);
  return {
    // Rebuilt geometry is joined the same way it was when it was projected.
    entities: stitchProjected(
      resolved,
      new Set(projections.filter((projection) => !lostEntityIds.includes(projection.entityId)).map((projection) => projection.entityId)),
    ),
    lostEntityIds,
  };
}
