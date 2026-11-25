import type { TessellationResult } from '@icancad/kernel';
import type {
  ParamValue,
  Resolved,
  SectionPlane,
  SketchFeature,
  SketchFrame,
  Vec3,
} from '@icancad/model';
import {
  datumFrame,
  faceFrame,
  rotateFrame,
  type Point2,
  type SketchRotationAngles,
} from '@icancad/sketch';
import { faceIdByName } from '../kernel/topologyLookup';
import { isPlanarFace } from '../viewport/planarFace';

export const SKETCH_SECTION_ID = '__sketch-plane__';

// The bounding corners of one face in its sketch plane. Framing a face sketch
// needs them because the sketch wireframe alone is much smaller than the face.
export function faceBoundsInFrame(
  mesh: TessellationResult | undefined,
  faceId: number,
  frame: SketchFrame,
): Point2[] {
  if (!mesh || !Number.isInteger(faceId)) return [];
  const { positions, indices, faceIds } = mesh;
  const [ox, oy, oz] = frame.origin;
  const [xx, xy, xz] = frame.xAxis;
  const [yx, yy, yz] = frame.yAxis;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const index = indices[triangle * 3 + corner]!;
      const dx = positions[index * 3]! - ox;
      const dy = positions[index * 3 + 1]! - oy;
      const dz = positions[index * 3 + 2]! - oz;
      const u = dx * xx + dy * xy + dz * xz;
      const v = dx * yx + dy * yy + dz * yz;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  if (!Number.isFinite(minU)) return [];
  return [
    [minU, minV],
    [minU, maxV],
    [maxU, minV],
    [maxU, maxV],
  ];
}

// The face may have moved because an earlier operation changed, so its centre
// and normal are derived from the current tessellation instead of the pose that
// was captured when the face was picked.
export function faceFrameFromMesh(
  mesh: TessellationResult | undefined,
  faceId: number,
): SketchFrame | null {
  if (!Number.isInteger(faceId) || faceId < 0) return null;
  return facesFrame(mesh, [faceId]);
}

/**
 * The frame of the whole face a name stands for.
 *
 * A name can cover several pieces: a boolean splits a face and every piece
 * keeps the name. The pieces tile the face the user picked, so their union is
 * the face as it was drawn on, and its middle does not jump from piece to piece.
 */
export function faceFrameByName(
  mesh: TessellationResult | undefined,
  name: string | undefined,
): SketchFrame | null {
  if (!mesh || !name) return null;
  const ids: number[] = [];
  for (let index = 0; index < (mesh.faceNames?.length ?? 0); index += 1) {
    const canonical = mesh.faceNames![index];
    if (canonical === name || (mesh.faceAliases?.[index]?.includes(name) ?? false)) {
      ids.push(index);
    }
  }
  return facesFrame(mesh, ids);
}

function facesFrame(
  mesh: TessellationResult | undefined,
  wanted: readonly number[],
): SketchFrame | null {
  if (!mesh || wanted.length === 0) return null;
  const ids = new Set(wanted);
  const { positions, indices, faceIds } = mesh;
  const centre: Vec3 = [0, 0, 0];
  const normal: Vec3 = [0, 0, 0];
  let area = 0;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (!ids.has(faceIds[triangle]!)) continue;
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
  const middle: Vec3 = [centre[0] / area, centre[1] / area, centre[2] / area];
  const fitted: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  const exact = exactFacePlane(mesh, ids, middle, fitted);
  if (exact) return faceFrame(exact[0], exact[1]);
  return faceFrame(middle, fitted);
}

/**
 * The plane of the face taken from the surface itself instead of its triangles,
 * with the middle of the face snapped onto it.
 *
 * The tessellation is float32: a plane fitted to it sits a fraction of a micron
 * inside the solid, and an operation that starts on the face then begins under
 * the surface — a cut leaves a skin over its own hole. The kernel reports the
 * exact plane, and it is used only where it lies with the triangles, so a face
 * whose surface is reported in another placement keeps the fitted plane.
 */
function exactFacePlane(
  mesh: TessellationResult,
  ids: ReadonlySet<number>,
  middle: Vec3,
  fitted: Vec3,
): [Vec3, Vec3] | null {
  for (const id of ids) {
    const plane = mesh.facePlanes?.[id];
    if (!plane) continue;
    const [nx, ny, nz] = plane.normal;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    // The surface says where the plane is; the fitted normal says which of its
    // two sides the material is on.
    const sign = nx * fitted[0] + ny * fitted[1] + nz * fitted[2] < 0 ? -1 : 1;
    // A zero stays a zero: `-0` survives every comparison as a different number.
    const tidy = (value: number) => (value === 0 ? 0 : value);
    const normal: Vec3 = [
      tidy((nx / length) * sign),
      tidy((ny / length) * sign),
      tidy((nz / length) * sign),
    ];
    const distance =
      normal[0] * plane.origin[0] + normal[1] * plane.origin[1] + normal[2] * plane.origin[2];
    const away = normal[0] * middle[0] + normal[1] * middle[1] + normal[2] * middle[2] - distance;
    return [
      [
        tidy(middle[0] - normal[0] * away),
        tidy(middle[1] - normal[1] * away),
        tidy(middle[2] - normal[2] * away),
      ],
      normal,
    ];
  }
  return null;
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

/**
 * A flipped sketch keeps its plane where it is and looks at the back of it: the
 * normal and one axis turn around, so the sketch and its extrusions start on the
 * other side without moving.
 */
function withDirection(frame: SketchFrame, inverted: boolean | undefined): SketchFrame {
  if (!inverted) return frame;
  return {
    ...frame,
    xAxis: flipNormal(frame.xAxis),
    normal: flipNormal(frame.normal),
  };
}

// Computed once while the sketch operation is being evaluated, then stored as
// the sketch object's frozen frame for the rest of that rebuild.
type SketchLike = SketchFeature | Resolved<SketchFeature>;

/** The number of a resolved or authored offset; a formula alone is not one. */
function numeric(value: ParamValue | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Authored angles resolved to numbers; an absent rotation is all zeroes. */
export function sketchRotationAngles(feature: SketchLike): SketchRotationAngles {
  const rotation = feature.plane.rotation;
  return rotation ? [numeric(rotation[0]), numeric(rotation[1]), numeric(rotation[2])] : [0, 0, 0];
}

/**
 * The frame before rotation: the pose of the datum or face, its offset and its
 * direction flip.
 *
 * A face sketch is placed at the middle of the whole face, not at the piece the
 * name happens to match: a face cut into pieces would otherwise move the sketch
 * to whichever piece came first. When the name is gone the last good frame is
 * used, so a transient loss — a preview, an operation being edited — cannot
 * move the sketch either.
 */
export function sketchFrameBasis(
  feature: SketchLike,
  faceMesh?: TessellationResult,
  previousFrame?: SketchFrame,
): SketchFrame {
  if (feature.plane.type === 'datum') {
    return withDirection(
      datumFrame(feature.plane.plane, numeric(feature.plane.offset)),
      feature.plane.inverted,
    );
  }
  const live = faceFrameByName(faceMesh, feature.plane.name);
  const base = live ?? previousFrame ?? feature.plane.frame ?? datumFrame('XY', 0);
  return withDirection(
    withSketchOffset(base, numeric(feature.plane.offset)),
    feature.plane.inverted,
  );
}

export function computeSketchFrame(
  feature: SketchLike,
  faceMesh?: TessellationResult,
  previousFrame?: SketchFrame,
): SketchFrame {
  return rotateFrame(
    sketchFrameBasis(feature, faceMesh, previousFrame),
    sketchRotationAngles(feature),
  );
}

// The frozen frame wins; without one (before the first rebuild) fall back to
// the frame captured when the face was picked.
export function sketchFrameOf(feature: SketchLike, frozenFrame?: SketchFrame): SketchFrame {
  if (frozenFrame) return frozenFrame;
  return rotateFrame(sketchFrameBasis(feature), sketchRotationAngles(feature));
}

// A face plane is usable only while it still has a picked face and a frame.
export function sketchPlaneReady(feature: SketchFeature): boolean {
  if (feature.plane.type === 'datum') return true;
  return Boolean(feature.plane.bodyId && feature.plane.name && feature.plane.frame);
}

// True when the stored face still exists on the current body and is planar.
export function faceSketchValid(
  feature: SketchFeature,
  faceMesh: TessellationResult | undefined,
): boolean {
  if (feature.plane.type === 'datum') return true;
  if (!feature.plane.bodyId || !feature.plane.name || !feature.plane.frame) return false;
  if (!faceMesh) return false;
  const faceId = faceIdByName(faceMesh, feature.plane.name);
  if (faceId === null) return false;
  if (!faceFrameFromMesh(faceMesh, faceId)) return false;
  return isPlanarFace(faceMesh, faceId);
}

export function canEditSketch(
  feature: SketchFeature,
  featureErrors: Record<string, string>,
): boolean {
  const error = featureErrors[feature.id];
  // A broken formula leaves the sketch's last solved geometry intact. Editing
  // it and fixing the formula is exactly what the user needs to do next, so
  // only a missing or invalid plane closes the editor.
  return sketchPlaneReady(feature) && (!error || error === 'EXPRESSION_ERROR');
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
  name: string | undefined,
): { origin: Vec3; normal: Vec3 } | null {
  const faceId = faceIdByName(mesh, name);
  if (faceId === null) return null;
  if (!isPlanarFace(mesh!, faceId)) return null;
  const frame = faceFrameFromMesh(mesh!, faceId);
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
  const frame = plane.face ? sectionFaceFrame(meshes[plane.face.bodyId], plane.face.name) : null;
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
