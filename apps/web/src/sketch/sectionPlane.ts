import type { TessellationResult } from '@icancad/kernel';
import type { SectionPlane, SketchFeature, SketchFrame, Vec3 } from '@icancad/model';
import { datumFrame, faceFrame } from '@icancad/sketch';
import { isPlanarFace } from '../viewport/planarFace';

export const SKETCH_SECTION_ID = '__sketch-plane__';

// The face may have moved because an earlier operation changed, so its centre
// and normal are derived from the current tessellation instead of the pose that
// was captured when the face was picked.
export function faceFrameFromMesh(
  mesh: TessellationResult | undefined,
  faceId: number,
): SketchFrame | null {
  if (!mesh || !Number.isInteger(faceId) || faceId < 0) return null;
  const { positions, indices, faceIds } = mesh;
  const centre: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  let area = 0;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    const a = indices[triangle * 3]!;
    const b = indices[triangle * 3 + 1]!;
    const c = indices[triangle * 3 + 2]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const bx = positions[b * 3]!;
    const by = positions[b * 3 + 1]!;
    const bz = positions[b * 3 + 2]!;
    const cx = positions[c * 3]!;
    const cy = positions[c * 3 + 1]!;
    const cz = positions[c * 3 + 2]!;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const twiceArea = Math.hypot(nx, ny, nz);
    if (twiceArea < 1e-12) continue;
    const triangleArea = twiceArea / 2;
    area += triangleArea;
    centre[0] += ((ax + bx + cx) / 3) * triangleArea;
    centre[1] += ((ay + by + cy) / 3) * triangleArea;
    centre[2] += ((az + bz + cz) / 3) * triangleArea;
    normal[0] += nx;
    normal[1] += ny;
    normal[2] += nz;
  }
  if (area === 0) return null;
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length === 0) return null;
  return faceFrame(
    [centre[0] / area, centre[1] / area, centre[2] / area],
    [normal[0] / length, normal[1] / length, normal[2] / length],
  );
}

function withSketchOffset(frame: SketchFrame, offset: number): SketchFrame {
  if (offset === 0) return frame;
  return {
    ...frame,
    origin: [
      frame.origin[0] + frame.normal[0] * offset,
      frame.origin[1] + frame.normal[1] * offset,
      frame.origin[2] + frame.normal[2] * offset,
    ],
  };
}

// Computed once while the sketch operation is being evaluated, then stored as
// the sketch object's frozen frame for the rest of that rebuild.
export function computeSketchFrame(
  feature: SketchFeature,
  faceMesh?: TessellationResult,
): SketchFrame {
  if (feature.plane.type === 'datum') {
    return datumFrame(feature.plane.plane, feature.plane.offset);
  }
  const faceId = Number(feature.plane.topoId);
  const dynamic = faceFrameFromMesh(faceMesh, faceId);
  const base = dynamic ?? feature.plane.frame ?? datumFrame('XY', 0);
  return withSketchOffset(base, feature.plane.offset ?? 0);
}

// The frozen frame wins; without one (before the first rebuild) fall back to
// the frame captured when the face was picked.
export function sketchFrameOf(
  feature: SketchFeature,
  frozenFrame?: SketchFrame,
): SketchFrame {
  if (frozenFrame) return frozenFrame;
  if (feature.plane.type === 'datum') {
    return datumFrame(feature.plane.plane, feature.plane.offset);
  }
  return withSketchOffset(feature.plane.frame ?? datumFrame('XY', 0), feature.plane.offset ?? 0);
}

// A face plane is usable only while it still has a picked face and a frame.
export function sketchPlaneReady(feature: SketchFeature): boolean {
  if (feature.plane.type === 'datum') return true;
  return Boolean(feature.plane.bodyId && feature.plane.topoId && feature.plane.frame);
}

// True when the stored face still exists on the current body and is planar.
export function faceSketchValid(
  feature: SketchFeature,
  faceMesh: TessellationResult | undefined,
): boolean {
  if (feature.plane.type === 'datum') return true;
  if (!feature.plane.bodyId || !feature.plane.topoId || !feature.plane.frame) return false;
  const faceId = Number(feature.plane.topoId);
  if (!Number.isInteger(faceId) || faceId < 0) return false;
  if (!faceFrameFromMesh(faceMesh, faceId)) return false;
  return isPlanarFace(faceMesh!, faceId);
}

export function canEditSketch(
  feature: SketchFeature,
  featureErrors: Record<string, string>,
): boolean {
  return sketchPlaneReady(feature) && !featureErrors[feature.id];
}

// The sketch plane cuts the model away in front of the camera, so the section
// at the sketch plane stays visible while the sketch is being edited.
export function sketchSectionPlane(
  feature: SketchFeature,
  frozenFrame?: SketchFrame,
): SectionPlane {
  const frame = sketchFrameOf(feature, frozenFrame);
  const normal = frame.normal.map((value) => -value) as Vec3;
  return {
    id: SKETCH_SECTION_ID,
    name: '',
    origin: [...frame.origin] as Vec3,
    normal,
    offset: 0,
    visible: true,
  };
}

export interface ResolvedSectionPlane extends SectionPlane {
  /** False when the linked face is gone and the stored pose is used instead. */
  faceLinked: boolean;
}

/** Centre and normal of a planar face, or null when the face is missing or curved. */
export function sectionFaceFrame(
  mesh: TessellationResult | undefined,
  topoId: string | undefined,
): { origin: Vec3; normal: Vec3 } | null {
  if (!mesh || !topoId) return null;
  const faceId = Number(topoId);
  if (!Number.isInteger(faceId) || faceId < 0) return null;
  if (!isPlanarFace(mesh, faceId)) return null;
  const frame = faceFrameFromMesh(mesh, faceId);
  return frame ? { origin: frame.origin, normal: frame.normal } : null;
}

// Keeps zeroes positive, so a flipped axis still reads as `[0, 0, 1]`.
export function flipNormal(normal: Vec3): Vec3 {
  return normal.map((value) => (value === 0 ? 0 : -value)) as Vec3;
}

/**
 * A plane that follows a face only cuts once the face is there: until then it
 * has no pose the user asked for.
 */
export function sectionPlaneActive(plane: SectionPlane): boolean {
  return plane.face !== null;
}

/**
 * A face-bound section keeps the material behind the picked face, so its normal
 * points into the body and the offset cuts deeper. The pose stored in the
 * project is already in that form, which is what a lost face falls back to.
 */
export function resolveSectionPlane(
  plane: SectionPlane,
  meshes: Record<string, TessellationResult>,
): ResolvedSectionPlane {
  const frame = plane.face ? sectionFaceFrame(meshes[plane.face.bodyId], plane.face.topoId) : null;
  const base = frame ? flipNormal(frame.normal) : plane.normal;
  // Inverting swaps which side survives without moving the plane, so the offset
  // runs the other way as well.
  return {
    ...plane,
    origin: frame?.origin ?? plane.origin,
    normal: plane.inverted ? flipNormal(base) : base,
    offset: plane.inverted && plane.offset !== 0 ? -plane.offset : plane.offset,
    faceLinked: frame !== null,
  };
}
