import type { TessellationResult } from '@icancad/kernel';
import type { SketchFeature } from '@icancad/model';
import { sketchTopology } from '@icancad/sketch';

/**
 * How a piece of geometry is named, everywhere: the object it belongs to, a
 * middle dot, and the number of the piece. What the piece is — a face, an edge,
 * a curve — is said by the icon beside the name, so the name itself stays short
 * and the same in a picker, in a list and in the panel (ADR 0029).
 */
export function geometryName(object: string, index: number | null | undefined): string {
  return index === null || index === undefined ? object : `${object} · ${index}`;
}

/** The number a face is shown with: face ids count from zero. */
export function faceNumber(faceId: string | number): number | null {
  const value = Number(faceId);
  return Number.isFinite(value) ? value + 1 : null;
}

/** Position of a body edge in the edge list of its own body, from one. */
export function bodyEdgeNumber(
  mesh: TessellationResult | undefined,
  edgeId: string,
): number | null {
  const index = mesh?.edges?.findIndex((edge) => edge.id === edgeId) ?? -1;
  return index >= 0 ? index + 1 : null;
}

/** Position of a region in the faces of the sketch it belongs to, from one. */
export function sketchFaceNumber(sketch: SketchFeature, faceId: string): number | null {
  const index = sketchTopology(sketch.entities).faces.findIndex((face) => face.id === faceId);
  return index >= 0 ? index + 1 : null;
}

/** Position of a curve in the outline of the sketch it is drawn in, from one. */
export function sketchEdgeNumber(sketch: SketchFeature, entityId: string): number | null {
  const index = sketchTopology(sketch.entities).edges.findIndex((edge) => edge.id === entityId);
  return index >= 0 ? index + 1 : null;
}
