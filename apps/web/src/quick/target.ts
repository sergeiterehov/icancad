import type { TessellationResult } from '@icancad/kernel';
import {
  createId,
  isFeatureInHistory,
  type ExtrudeFeature,
  type Project,
  type SketchFeature,
  type SketchFrame,
  type Vec3,
} from '@icancad/model';
import { sketchPointToWorld, sketchTopology, type Point2 } from '@icancad/sketch';
import { sketchFrameOf } from '../sketch/sectionPlane';
import {
  selectedBodyFaces,
  selectedFaceIds,
  selectedSketchIds,
} from '../stores/selection';
import type { SelectionItem } from '../stores/documentStore';
import { isPlanarFace } from '../viewport/planarFace';
import { outwardNormal } from './geometry';
import type {
  ExtrudePrediction,
  QuickFace,
  QuickTarget,
  QuickTargetGeometry,
} from './types';

export interface QuickTargetSource {
  project: Project;
  selection: readonly SelectionItem[];
  meshes: Record<string, TessellationResult>;
  sketchFrames: Record<string, SketchFrame>;
}

/** The element the selection refers to, without resolving its geometry. */
export function quickTargetFromSelection(
  project: Project,
  selection: readonly SelectionItem[],
): QuickTarget | null {
  if (selection.length === 0) return null;
  if (selection.some((item) => item.kind === 'edge')) return null;

  const bodyFaces = selectedBodyFaces(selection);
  if (bodyFaces.length > 0) {
    if (selection.some((item) => item.kind === 'face' || item.kind === 'sketch')) return null;
    const bodyId = bodyFaces[0]!.bodyId;
    if (bodyFaces.some((face) => face.bodyId !== bodyId)) return null;
    const bodyRef = project.bodies.find((candidate) => candidate.id === bodyId);
    if (!bodyRef || bodyRef.kind === 'mesh') return null;
    return { kind: 'body-face', bodyId, faceIds: bodyFaces.map((face) => face.faceId) };
  }

  const sketchIds = selectedSketchIds(selection);
  const faceIds = selectedFaceIds(selection);
  const sketchId =
    sketchIds.length === 1 && faceIds.length === 0
      ? sketchIds[0]!
      : faceIds.length > 0
        ? faceIds[0]!.split('#')[0]
        : undefined;
  if (!sketchId) return null;
  if (faceIds.some((id) => id.split('#')[0] !== sketchId)) return null;
  if (sketchIds.some((id) => id !== sketchId)) return null;
  if (selection.some((item) => item.kind === 'body-face')) return null;
  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.id === sketchId && feature.type === 'sketch',
  );
  if (!sketch || !isFeatureInHistory(project, sketch.id)) return null;
  return {
    kind: 'sketch',
    sketchId,
    regions: faceIds.map((id) => id.split('#')[1] ?? '').filter(Boolean),
  };
}

/**
 * Geometry of a body-face target taken from the operation itself. After a
 * boolean the face traversal is renumbered, so the stored refs are the only
 * stable description of the face the handle belongs to.
 */
export function boundBodyFaceGeometry(
  bound: ExtrudeFeature,
  target: QuickTarget,
): QuickTargetGeometry | null {
  if (target.kind !== 'body-face') return null;
  const refs = target.faceIds.map((faceId) =>
    bound.faceRefs.find((ref) => ref.bodyId === target.bodyId && ref.faceId === faceId),
  );
  const primary = refs[refs.length - 1];
  if (!primary) return null;
  return {
    target,
    origin: primary.origin,
    direction: primary.normal,
    faces: target.faceIds.flatMap((faceId, index) => {
      const ref = refs[index];
      return ref ? [{ faceId, centroid: ref.origin, normal: ref.normal }] : [];
    }),
    samples: [],
  };
}

/** Which element the current selection opens a quick operation for. */
export function resolveQuickTarget(source: QuickTargetSource): QuickTargetGeometry | null {
  const { project, selection, meshes, sketchFrames } = source;
  const target = quickTargetFromSelection(project, selection);
  if (!target) return null;

  if (target.kind === 'body-face') {
    const { bodyId } = target;
    const mesh = meshes[bodyId];
    if (!mesh) return null;

    const faces: QuickFace[] = [];
    for (const face of target.faceIds) {
      const faceId = Number(face);
      if (!Number.isInteger(faceId) || !isPlanarFace(mesh, faceId)) return null;
      const normal = outwardNormal(mesh, faceId);
      if (!normal) return null;
      faces.push({ faceId: face, centroid: normal.centroid, normal: normal.normal });
    }
    const primary = faces[faces.length - 1]!;
    return {
      target,
      origin: primary.centroid,
      direction: primary.normal,
      faces,
      samples: [],
    };
  }

  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.id === target.sketchId && feature.type === 'sketch',
  );
  if (!sketch) return null;
  if (sketch.plane.type === 'face' && !sketch.plane.frame && !sketchFrames[sketch.id]) {
    return null;
  }
  const frame = sketchFrameOf(sketch, sketchFrames[sketch.id]);
  const samples = sampleSketchWorld(sketch, frame, target.regions);
  if (samples.length === 0) return null;
  const origin: Vec3 = [
    samples.reduce((sum, point) => sum + point[0], 0) / samples.length,
    samples.reduce((sum, point) => sum + point[1], 0) / samples.length,
    samples.reduce((sum, point) => sum + point[2], 0) / samples.length,
  ];
  return {
    target,
    origin,
    direction: frame.normal,
    faces: [],
    samples,
    ...(sketch.plane.type === 'face' && sketch.plane.bodyId
      ? { preferredBodyId: sketch.plane.bodyId }
      : {}),
  };
}

/** The active extrude whose inputs are exactly this target, if one exists. */
export function findBoundExtrude(
  project: Project,
  target: QuickTarget,
): ExtrudeFeature | undefined {
  for (let index = project.features.length - 1; index >= 0; index -= 1) {
    const feature = project.features[index];
    if (!feature || feature.type !== 'extrude' || feature.suppressed) continue;
    if (!isFeatureInHistory(project, feature.id)) continue;
    if (target.kind === 'body-face') {
      const refs = feature.faceRefs ?? [];
      if (feature.sketchId || refs.length !== target.faceIds.length) continue;
      const keys = new Set(refs.map((ref) => `${ref.bodyId}#${ref.faceId}`));
      if (
        refs.every((ref) => ref.bodyId === target.bodyId) &&
        target.faceIds.every((faceId) => keys.has(`${target.bodyId}#${faceId}`))
      ) {
        return feature;
      }
      continue;
    }
    if (feature.sketchId !== target.sketchId || (feature.faceRefs ?? []).length > 0) continue;
    if (target.regions.length === 0) {
      if (feature.scope === 'all') return feature;
      continue;
    }
    if (feature.scope !== 'selected') continue;
    const regions = new Set(feature.regions);
    if (
      regions.size === target.regions.length &&
      target.regions.every((region) => regions.has(region))
    ) {
      return feature;
    }
  }
  return undefined;
}

/** A quick operation is an ordinary extrude with its inputs already chosen. */
export function buildQuickExtrude(
  geometry: QuickTargetGeometry,
  prediction: ExtrudePrediction,
  value: number,
  name: string,
): ExtrudeFeature {
  const { target } = geometry;
  const distance = Math.max(0.001, Math.abs(value));
  const reversed = value < 0;
  if (target.kind === 'body-face') {
    return {
      id: createId('feat'),
      name,
      suppressed: false,
      type: 'extrude',
      regions: [],
      faceRefs: geometry.faces.map((face) => ({
        bodyId: target.bodyId,
        faceId: face.faceId,
        normal: face.normal,
        origin: face.centroid,
      })),
      objectOrder: geometry.faces.map((face) => `b:${target.bodyId}#${face.faceId}`),
      end: 'blind',
      distance,
      reversed,
      op: prediction.op,
      scope: 'all',
      bodyIds: prediction.bodyIds,
      joinRegions: true,
    };
  }
  return {
    id: createId('feat'),
    name,
    suppressed: false,
    type: 'extrude',
    sketchId: target.sketchId,
    regions: target.regions,
    faceRefs: [],
    objectOrder:
      target.regions.length > 0
        ? target.regions.map((region) => `s:${target.sketchId}#${region}`)
        : [`s:${target.sketchId}#*`],
    end: 'blind',
    distance,
    reversed,
    op: prediction.op,
    scope: target.regions.length > 0 ? 'selected' : 'all',
    bodyIds: prediction.bodyIds,
    joinRegions: true,
  };
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonCentroid(points: readonly Point2[]): Point2 {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const average = points.reduce<Point2>((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
    return [average[0] / Math.max(1, points.length), average[1] / Math.max(1, points.length)];
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

function sampleRegion(
  outline: readonly Point2[],
  holes: ReadonlyArray<readonly Point2[]>,
): Point2[] {
  if (outline.length < 3) return [];
  const inside = (point: Point2) =>
    pointInPolygon(point, outline) && !holes.some((hole) => pointInPolygon(point, hole));
  const centroid = polygonCentroid(outline);
  const samples: Point2[] = [];
  if (inside(centroid)) samples.push(centroid);

  const limit = Math.max(4, Math.min(12, outline.length));
  for (let index = 0; index < limit && samples.length < 7; index += 1) {
    const a = outline[Math.floor((index / limit) * outline.length)]!;
    const b = outline[Math.floor(((index + 1) / limit) * outline.length) % outline.length]!;
    const mid: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const inward: Point2 = [
      mid[0] + (centroid[0] - mid[0]) * 0.02,
      mid[1] + (centroid[1] - mid[1]) * 0.02,
    ];
    if (inside(inward)) samples.push(inward);
  }
  return samples;
}

function sampleSketchWorld(
  sketch: SketchFeature,
  frame: SketchFrame,
  regions: readonly string[],
): Vec3[] {
  const faces = sketchTopology(sketch.entities).faces;
  const selected =
    regions.length > 0
      ? faces.filter((face) => regions.includes(face.id))
      : faces.filter((face) => face.depth === 0);
  const local: Point2[] = [];
  for (const face of selected) {
    for (const point of sampleRegion(face.outline, face.holeOutlines)) {
      local.push(point);
      if (local.length >= 24) break;
    }
    if (local.length >= 24) break;
  }
  return local.map((point) => sketchPointToWorld(frame, point));
}
