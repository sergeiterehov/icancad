import { featureBodyId, type Model } from '@icancad/model';
import type { SelectionItem } from './documentStore';

/** Id of a solid-body face: `${bodyId}#${faceId}`. */
export function bodyFaceId(bodyId: string, faceId: string): string {
  return `${bodyId}#${faceId}`;
}

export function parseBodyFaceId(id: string): { bodyId: string; faceId: string } | null {
  const index = id.lastIndexOf('#');
  if (index <= 0 || index === id.length - 1) return null;
  return { bodyId: id.slice(0, index), faceId: id.slice(index + 1) };
}

/** Id of a solid-body edge: `${bodyId}#${edgeId}`. */
export function bodyEdgeId(bodyId: string, edgeId: string): string {
  return `${bodyId}#${edgeId}`;
}

export function parseBodyEdgeId(id: string): { bodyId: string; edgeId: string } | null {
  const parsed = parseBodyFaceId(id);
  return parsed ? { bodyId: parsed.bodyId, edgeId: parsed.faceId } : null;
}

/** Body a detail-selection item belongs to, if any. */
export function selectedDetailBodyId(item: SelectionItem): string | null {
  if (item.kind === 'body-face') return parseBodyFaceId(item.id)?.bodyId ?? null;
  if (item.kind === 'edge') return parseBodyEdgeId(item.id)?.bodyId ?? null;
  return null;
}

/**
 * Bodies the viewport has drilled into: selected objects plus the owners of
 * selected detail elements. A face selection keeps its body open for the next
 * click, even though the body itself is no longer selected as an object.
 */
export function drilledBodyIds(selection: SelectionItem[]): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'body' || item.kind === 'mesh') {
      ids.add(item.id);
      continue;
    }
    const bodyId = selectedDetailBodyId(item);
    if (bodyId) ids.add(bodyId);
  }
  return [...ids];
}

export function isDirectlySelected(
  selection: SelectionItem[],
  kind: SelectionItem['kind'],
  id: string,
): boolean {
  return selection.some((item) => item.kind === kind && item.id === id);
}

export function directBodyIds(selection: SelectionItem[]): string[] {
  return selection
    .filter((item) => item.kind === 'body' || item.kind === 'mesh')
    .map((item) => item.id);
}

export function linkedBodyIds(selection: SelectionItem[], model: Model): string[] {
  const direct = new Set(directBodyIds(selection));
  const ids = new Set<string>();
  const featureIds = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'feature') featureIds.add(item.id);
    // A selected face or edge keeps its body highlighted in the tree without
    // selecting the object itself.
    const bodyId = selectedDetailBodyId(item);
    if (bodyId && !direct.has(bodyId)) ids.add(bodyId);
  }
  for (const body of model.bodies) {
    if (featureIds.has(body.createdBy) && !direct.has(body.id)) ids.add(body.id);
  }
  return [...ids];
}

export function selectedBodyIds(selection: SelectionItem[], model: Model): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'body') {
      const body = model.bodies.find((candidate) => candidate.id === item.id);
      if (body && body.kind !== 'mesh') ids.add(item.id);
    } else if (item.kind === 'feature') {
      const feature = model.features.find((candidate) => candidate.id === item.id);
      if (feature && feature.type !== 'import-mesh') ids.add(featureBodyId(item.id));
    }
  }
  return [...ids];
}

export function selectedMeshIds(selection: SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'mesh').map((item) => item.id);
}

/**
 * Operations a timeline menu acts on: the whole operation selection when the
 * clicked chip belongs to it, otherwise just that operation.
 */
export function menuFeatureIds(selection: readonly SelectionItem[], clickedId: string): string[] {
  const ids = selection.filter((item) => item.kind === 'feature').map((item) => item.id);
  return ids.includes(clickedId) && ids.length > 1 ? ids : [clickedId];
}

export function selectedSketchIds(selection: readonly SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'sketch').map((item) => item.id);
}

export function selectedFaceIds(selection: readonly SelectionItem[]): string[] {
  return selection.filter((item) => item.kind === 'face').map((item) => item.id);
}

/** Curves of a sketch picked through its object, mirroring its regions. */
export function selectedSketchEdges(
  selection: readonly SelectionItem[],
): Array<{ sketchId: string; entityId: string }> {
  const edges: Array<{ sketchId: string; entityId: string }> = [];
  for (const item of selection) {
    if (item.kind !== 'sketch-edge') continue;
    const separator = item.id.lastIndexOf('#');
    if (separator <= 0) continue;
    edges.push({
      sketchId: item.id.slice(0, separator),
      entityId: item.id.slice(separator + 1),
    });
  }
  return edges;
}

/**
 * Sketch whose region or edge is selected. Its panel stays open while the user
 * drills into the sketch.
 */
export function selectedSketchDetailId(selection: readonly SelectionItem[]): string | null {
  const first = selection[0];
  if (!first) return null;
  const sketchId = first.id.split('#')[0] ?? null;
  if (!sketchId) return null;
  const detail = selection.every(
    (item) =>
      (item.kind === 'face' || item.kind === 'sketch-edge') && item.id.split('#')[0] === sketchId,
  );
  return detail ? sketchId : null;
}

export function selectedBodyFaces(
  selection: readonly SelectionItem[],
): Array<{ bodyId: string; faceId: string }> {
  const faces: Array<{ bodyId: string; faceId: string }> = [];
  for (const item of selection) {
    if (item.kind !== 'body-face') continue;
    const parsed = parseBodyFaceId(item.id);
    if (parsed) faces.push(parsed);
  }
  return faces;
}

export function selectedEdges(
  selection: readonly SelectionItem[],
): Array<{ bodyId: string; edgeId: string }> {
  const edges: Array<{ bodyId: string; edgeId: string }> = [];
  for (const item of selection) {
    if (item.kind !== 'edge') continue;
    const parsed = parseBodyEdgeId(item.id);
    if (parsed) edges.push(parsed);
  }
  return edges;
}

export function selectedFeatureIds(selection: SelectionItem[], model: Model): string[] {
  const ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'feature' || item.kind === 'sketch') {
      ids.add(item.id);
    } else if (item.kind === 'face' || item.kind === 'sketch-edge') {
      ids.add(item.id.split('#')[0] ?? item.id);
    } else if (
      item.kind === 'body' ||
      item.kind === 'mesh' ||
      item.kind === 'body-face' ||
      item.kind === 'edge'
    ) {
      const bodyId =
        item.kind === 'body' || item.kind === 'mesh' ? item.id : selectedDetailBodyId(item);
      const body = bodyId ? model.bodies.find((candidate) => candidate.id === bodyId) : undefined;
      if (body) ids.add(body.createdBy);
    }
  }
  return [...ids];
}
