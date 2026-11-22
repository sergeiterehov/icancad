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
import { faceIdByName } from '../kernel/topologyLookup';
import { faceSilhouettes } from './silhouette';

/** What a projection click in the 3D view landed on. */
export type ProjectionPick =
  | { kind: 'vertex'; bodyId: string; elementId: string; position: Vec3 }
  | { kind: 'edge'; bodyId: string; edgeId: string }
  | { kind: 'face'; bodyId: string; faceId: string };

interface BodyElements {
  /** Vertices by their stable name: the edges that meet there. */
  vertices: Map<string, Vec3>;
  /** Position-based ids of the tessellation, mapped to the stable vertex name. */
  vertexIds: Map<string, string>;
  /** Edges by their persistent name. */
  edges: Map<string, BodyEdge>;
  /** Edges by the tessellation id a pick carries. */
  byId: Map<string, BodyEdge>;
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
  const byId = new Map<string, BodyEdge>();
  const byPosition = new Map<string, Vec3>();
  const incident = new Map<string, string[]>();
  for (const edge of mesh.edges ?? []) {
    byId.set(edge.id, edge);
    // An edge without a name cannot be linked to; imported meshes have none.
    if (edge.name) edges.set(edge.name, edge);
    if (edge.closed || !edge.name) continue;
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
      list.push(edge.name);
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
  const elements = { vertices, vertexIds, edges, byId };
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
  return `${source.bodyId}:${source.kind}:${source.name}`;
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
  faceName: string,
): Array<{ elementId: string; curve: SketchEntityDraft }> {
  const index = faceIdByName(mesh, faceName);
  if (index === null) return [];
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
      curves.push({ elementId: `${faceName}#${curves.length}`, curve });
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
    case 'ellipse':
    case 'elliptical-arc': {
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
  faceName: string,
): FaceCurve[] {
  const index = faceIdByName(mesh, faceName);
  if (index === null) return [];
  const elements = bodyElements(mesh);
  const entries: FaceCurve[] = [];
  for (const edge of elements.edges.values()) {
    if (!edge.faceIds.includes(index) || !edge.name) continue;
    const curve = projectedCurve(frame, edge);
    if (curve) entries.push({ elementId: edge.name, kind: 'edge', curve });
  }
  for (const entry of silhouetteCurves(mesh, frame, faceName)) {
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
// is computed once per face and shared by its links. The cache belongs to the
// tessellation it was read from: a rebuild produces a new mesh, and a contour
// taken from the old one would keep a resized body's projection where it was.
const faceCurveCacheEntries = new WeakMap<TessellationResult, Map<string, FaceCurve[]>>();

function faceCurveCache(
  mesh: TessellationResult,
  frame: SketchFrame,
  faceName: string,
): FaceCurve[] {
  let entries = faceCurveCacheEntries.get(mesh);
  if (!entries) {
    entries = new Map();
    faceCurveCacheEntries.set(mesh, entries);
  }
  const key = `${faceName}|${frame.origin.join(',')}|${frame.normal.join(',')}`;
  const cached = entries.get(key);
  if (cached) return cached;
  const curves = faceContourCurves(mesh, frame, faceName);
  entries.set(key, curves);
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

  const stableVertexId = (point: Vec3, picked?: string): string | null => {
    const position = vertexElementId(point);
    if (picked && elements.vertices.has(picked)) return picked;
    return elements.vertexIds.get(position) ?? null;
  };

  const addVertex = (bodyId: string, point: Vec3, picked?: string, faceName?: string) => {
    const name = stableVertexId(point, picked);
    if (!name) return;
    const key = `${bodyId}:vertex:${name}`;
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
      source: { kind: 'vertex', bodyId, name },
      ...(faceName ? { faceName } : {}),
    });
    changed = true;
  };

  const addEdge = (bodyId: string, picked: string, faceName?: string) => {
    const edge = elements.byId.get(picked);
    if (!edge?.name) return;
    const key = `${bodyId}:edge:${edge.name}`;
    if (known.has(key)) return;
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
      source: { kind: 'edge', bodyId, name: edge.name },
      ...(faceName ? { faceName } : {}),
    });
    changed = true;
  };

  if (pick.kind === 'vertex') {
    addVertex(pick.bodyId, pick.position, pick.elementId);
  } else if (pick.kind === 'edge') {
    addEdge(pick.bodyId, pick.edgeId);
  } else {
    const faceIndex = Number(pick.faceId);
    const faceName = mesh.faceNames?.[faceIndex];
    if (!faceName) return null;
    const boundary = [...elements.edges.values()].filter((edge) =>
      edge.faceIds.includes(faceIndex),
    );
    for (const entry of faceContourCurves(mesh, frame, faceName)) {
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
        source: { kind: entry.kind, bodyId: pick.bodyId, name: entry.elementId },
        faceName,
      });
      changed = true;
    }
    for (const edge of boundary) {
      if (edge.closed) continue;
      const points = edgeWorldPoints(edge);
      if (points.length === 0) continue;
      addVertex(pick.bodyId, points[0]!, undefined, faceName);
      addVertex(pick.bodyId, points[points.length - 1]!, undefined, faceName);
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
      const point = elements.vertices.get(projection.source.name);
      if (point) {
        entity = {
          id: projection.entityId,
          ...sketchPointFromProjected(projectPointToFrame(frame, point)),
          // The construction flag is the user's choice, so it survives a refresh.
          construction: snapshot.construction,
        };
      }
    } else if (elements && projection.faceName) {
      const curves = faceCurveCache(mesh!, frame, projection.faceName);
      const curve = curves.find(
        (entry) =>
          entry.kind === projection.source.kind && entry.elementId === projection.source.name,
      );
      if (curve) {
        entity = {
          id: projection.entityId,
          ...curve.curve,
          construction: snapshot.construction,
        };
      }
    } else if (elements) {
      const edge = elements.edges.get(projection.source.name);
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
      new Set(
        projections
          .filter((projection) => !lostEntityIds.includes(projection.entityId))
          .map((projection) => projection.entityId),
      ),
    ),
    lostEntityIds,
  };
}
