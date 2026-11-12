import type { TessellationResult } from '@icancad/kernel';
import type { SketchFrame } from '@icancad/model';
import { faceFrame } from '@icancad/sketch';
import { outwardNormal } from '../quick/geometry';
import type { SelectionItem } from '../stores/documentStore';
import { selectedBodyFaces } from '../stores/selection';
import { isPlanarFace } from '../viewport/planarFace';

export interface SelectedFacePlane {
  bodyId: string;
  faceId: string;
  frame: SketchFrame;
}

/**
 * Plane for a sketch created on the face the user has already selected. Only a
 * single planar face of a tessellated body qualifies; anything else leaves the
 * sketch without a plane so the usual face picking takes over.
 */
export function sketchPlaneFromSelection(
  selection: readonly SelectionItem[],
  meshes: Record<string, TessellationResult>,
): SelectedFacePlane | null {
  const faces = selectedBodyFaces(selection);
  if (faces.length !== 1) return null;
  const parsed = faces[0]!;
  const mesh = meshes[parsed.bodyId];
  const faceId = Number(parsed.faceId);
  if (!mesh || !Number.isInteger(faceId) || !isPlanarFace(mesh, faceId)) return null;
  const normal = outwardNormal(mesh, faceId);
  if (!normal) return null;
  return {
    bodyId: parsed.bodyId,
    faceId: parsed.faceId,
    frame: faceFrame(normal.centroid, normal.normal),
  };
}
