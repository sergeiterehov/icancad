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
  sketchCurveFromPolyline,
  sketchPointFromProjected,
  type SketchEntityDraft,
} from '@icancad/sketch';

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
  return sketchCurveFromPolyline(projected, edge.closed);
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
    for (const edge of boundary) addEdge(pick.bodyId, edge.id, pick.faceId);
    for (const edge of boundary) {
      if (edge.closed) continue;
      const points = edgeWorldPoints(edge);
      if (points.length === 0) continue;
      addVertex(pick.bodyId, points[0]!, undefined, pick.faceId);
      addVertex(pick.bodyId, points[points.length - 1]!, undefined, pick.faceId);
    }
  }

  return changed ? { ...feature, entities, projections } : null;
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
  return {
    entities: feature.entities.map((entity) => replacements.get(entity.id) ?? entity),
    lostEntityIds,
  };
}
