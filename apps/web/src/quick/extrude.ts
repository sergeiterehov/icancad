import type { TessellationResult } from '@icancad/kernel';
import { isFeatureInHistory, type Model, type SketchFeature } from '@icancad/model';
import type { ExtrudeStart, SelectionItem } from '../stores/documentStore';
import { parseBodyFaceId } from '../stores/selection';
import { isPlanarFace } from '../viewport/planarFace';
import { outwardNormal } from './geometry';

/**
 * What the extrude tool starts with. A selected sketch is a profile of its own,
 * its regions are profiles of the same sketch, and a selected face of a body is
 * a profile too — an operation may hold both at once (ADR 0009).
 *
 * A face keeps the pose it has at pick time, so the operation can find it again
 * after a rebuild. What cannot be a profile — a curved side, a face of an
 * imported mesh, something the cursor has rolled past — is left out: the tool
 * then opens with the rest, or empty and asks for its input.
 */
export function extrudeInputFromSelection(
  model: Model,
  selection: readonly SelectionItem[],
  meshes: Record<string, TessellationResult>,
): ExtrudeStart | null {
  const sketchIds: string[] = [];
  const regions = new Map<string, string[]>();
  const faceRefs: NonNullable<ExtrudeStart['faceRefs']> = [];
  const seenFaces = new Set<string>();

  for (const item of selection) {
    if (item.kind === 'sketch') {
      if (!sketchIds.includes(item.id)) sketchIds.push(item.id);
      continue;
    }
    if (item.kind === 'face') {
      const [sketchId, faceId] = item.id.split('#');
      if (!sketchId || !faceId) continue;
      const picked = regions.get(sketchId) ?? [];
      if (picked.includes(faceId)) continue;
      regions.set(sketchId, [...picked, faceId]);
      continue;
    }
    if (item.kind !== 'body-face') continue;
    const parsed = parseBodyFaceId(item.id);
    if (!parsed) continue;
    const body = model.bodies.find((candidate) => candidate.id === parsed.bodyId);
    if (!body || body.kind === 'mesh' || !isFeatureInHistory(model, body.createdBy)) continue;
    const mesh = meshes[parsed.bodyId];
    const faceId = Number(parsed.faceId);
    if (!mesh || !Number.isInteger(faceId) || !isPlanarFace(mesh, faceId)) continue;
    const name = mesh.faceNames?.[faceId];
    if (!name) continue;
    const key = `${parsed.bodyId}#${name}`;
    if (seenFaces.has(key)) continue;
    const pose = outwardNormal(mesh, faceId);
    if (!pose) continue;
    seenFaces.add(key);
    faceRefs.push({
      bodyId: parsed.bodyId,
      name,
      normal: pose.normal,
      origin: pose.centroid,
    });
  }

  // Profiles of two sketches cannot be one operation: regions are named against
  // the sketch they belong to.
  if (sketchIds.length > 1 || regions.size > 1) return null;
  const regionSketchId = regions.keys().next().value;
  if (regionSketchId && sketchIds.length > 0 && sketchIds[0] !== regionSketchId) return null;
  const sketchId = regionSketchId ?? sketchIds[0];
  if (sketchId) {
    const sketch = model.features.find(
      (candidate): candidate is SketchFeature =>
        candidate.id === sketchId && candidate.type === 'sketch',
    );
    if (!sketch || !isFeatureInHistory(model, sketchId)) return null;
  }
  if (!sketchId && faceRefs.length === 0) return null;
  const picked = sketchId ? (regions.get(sketchId) ?? []) : [];
  return {
    ...(sketchId ? { sketchId } : {}),
    ...(picked.length > 0 ? { regions: picked } : {}),
    ...(faceRefs.length > 0 ? { faceRefs } : {}),
  };
}
