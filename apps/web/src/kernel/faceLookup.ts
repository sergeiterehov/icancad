import type { ShapeStats, TessellationResult } from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { faceRegion } from '../quick/geometry';

/** Stored pose of a body face, as written by a quick operation. */
export interface FaceRefLike {
  bodyId: string;
  faceId: string;
  normal: Vec3;
  origin: Vec3;
}

export interface ResolvedFaceRef {
  bodyId: string;
  faceId: number;
}

export interface FaceLookupContext {
  bodyShapes: ReadonlyMap<string, string>;
  meshes: Record<string, TessellationResult>;
  bodyStats: Record<string, ShapeStats>;
}

const NORMAL_DOT = 0.999;
const POSITION_TOLERANCE = 1e-3;

/** How far a face is from the stored pose, or null when it does not match. */
export function faceMatchDistance(
  mesh: TessellationResult,
  faceId: number,
  normal: Vec3,
  origin: Vec3,
): number | null {
  if (!Number.isInteger(faceId) || faceId < 0) return null;
  const region = faceRegion(mesh, faceId);
  if (!region) return null;
  const dot =
    region.normal[0] * normal[0] +
    region.normal[1] * normal[1] +
    region.normal[2] * normal[2];
  if (Math.abs(dot) < NORMAL_DOT) return null;
  const distance = Math.hypot(
    region.centroid[0] - origin[0],
    region.centroid[1] - origin[1],
    region.centroid[2] - origin[2],
  );
  return distance <= POSITION_TOLERANCE ? distance : null;
}

/**
 * A face ref first resolves against the body it names. When a boolean split
 * moved the face to another body, the face itself was not recreated, so its
 * stored pose finds it there. A face that was rebuilt in place keeps the
 * positional fallback, which is what face indexing did before splits existed.
 */
export function resolveFaceRef(
  context: FaceLookupContext,
  ref: FaceRefLike,
): ResolvedFaceRef | null {
  const directFace = Number(ref.faceId);
  const directMesh = context.meshes[ref.bodyId];
  if (
    directMesh &&
    context.bodyShapes.has(ref.bodyId) &&
    faceMatchDistance(directMesh, directFace, ref.normal, ref.origin) !== null
  ) {
    return { bodyId: ref.bodyId, faceId: directFace };
  }

  let best: { bodyId: string; faceId: number; distance: number } | null = null;
  for (const bodyId of context.bodyShapes.keys()) {
    const mesh = context.meshes[bodyId];
    if (!mesh) continue;
    const faces = context.bodyStats[bodyId]?.faces ?? 0;
    for (let faceId = 0; faceId < faces; faceId += 1) {
      const distance = faceMatchDistance(mesh, faceId, ref.normal, ref.origin);
      if (distance === null) continue;
      if (!best || distance < best.distance) best = { bodyId, faceId, distance };
    }
  }
  if (best) return { bodyId: best.bodyId, faceId: best.faceId };

  if (directMesh && context.bodyShapes.has(ref.bodyId) && faceRegion(directMesh, directFace)) {
    return { bodyId: ref.bodyId, faceId: directFace };
  }
  return null;
}
