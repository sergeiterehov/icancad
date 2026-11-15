import type { TessellationResult } from '@icancad/kernel';
import type { BodyFaceRef, Model, Vec3 } from '@icancad/model';
import type { SelectionItem, ShellInput } from '../stores/documentStore';
import { parseBodyFaceId } from '../stores/selection';
import { resolveFaceRef, type FaceLookupContext, type ResolvedFaceRef } from '../kernel/faceLookup';
import { faceRegion } from './geometry';

export interface FacePose {
  normal: Vec3;
  origin: Vec3;
}

/** Fallback pose of a face whose triangles cancel out, such as a full cylinder. */
function trianglePose(mesh: TessellationResult, faceId: number): FacePose | null {
  const { positions, indices, faceIds } = mesh;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let first: Vec3 | null = null;
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] !== faceId) continue;
    const a = indices[triangle * 3]! * 3;
    const b = indices[triangle * 3 + 1]! * 3;
    const c = indices[triangle * 3 + 2]! * 3;
    const ux = positions[b]! - positions[a]!;
    const uy = positions[b + 1]! - positions[a + 1]!;
    const uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!;
    const vy = positions[c + 1]! - positions[a + 1]!;
    const vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const size = Math.hypot(nx, ny, nz);
    if (size <= 1e-12) continue;
    const triangleArea = size / 2;
    area += triangleArea;
    cx += ((positions[a]! + positions[b]! + positions[c]!) / 3) * triangleArea;
    cy += ((positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3) * triangleArea;
    cz += ((positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3) * triangleArea;
    first ??= [nx / size, ny / size, nz / size];
  }
  if (!first || area <= 1e-9) return null;
  return { origin: [cx / area, cy / area, cz / area], normal: first };
}

/** Stored pose of a face the shell leaves open. */
export function shellFaceRef(
  mesh: TessellationResult,
  bodyId: string,
  faceId: string,
  picked?: FacePose,
): BodyFaceRef | null {
  const id = Number(faceId);
  if (!Number.isInteger(id) || id < 0) return null;
  const region = faceRegion(mesh, id);
  if (region) return { bodyId, faceId, normal: region.normal, origin: region.centroid };
  const pose = picked ?? trianglePose(mesh, id);
  if (!pose) return null;
  const length = Math.hypot(pose.normal[0], pose.normal[1], pose.normal[2]);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  return {
    bodyId,
    faceId,
    normal: [pose.normal[0] / length, pose.normal[1] / length, pose.normal[2] / length],
    origin: pose.origin,
  };
}

/**
 * A face the shell leaves open. A face with a single stable normal resolves by
 * its stored pose; a closed curved face (a full cylinder, a sphere) has no such
 * normal, so its traversal index is the only description it can offer.
 */
export function resolveShellFaceRef(
  context: FaceLookupContext,
  ref: BodyFaceRef,
): ResolvedFaceRef | null {
  const resolved = resolveFaceRef(context, ref);
  if (resolved) return resolved;
  const faceId = Number(ref.faceId);
  const mesh = context.meshes[ref.bodyId];
  if (!Number.isInteger(faceId) || faceId < 0 || !mesh) return null;
  if (!context.bodyShapes.has(ref.bodyId)) return null;
  if (faceId >= (context.bodyStats[ref.bodyId]?.faces ?? 0)) return null;
  return faceRegion(mesh, faceId) ? null : { bodyId: ref.bodyId, faceId };
}

/**
 * The bodies and open faces the current selection gives a new shell operation.
 * Bodies are hollowed whole; a picked face also makes its body a target.
 */
export function shellInputFromSelection(
  project: Model,
  selection: readonly SelectionItem[],
  meshes: Record<string, TessellationResult>,
): ShellInput | null {
  const bodyIds = new Set<string>();
  const faceRefs: BodyFaceRef[] = [];

  for (const item of selection) {
    if (item.kind === 'body') {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      if (!body || body.kind === 'mesh') continue;
      bodyIds.add(item.id);
      continue;
    }
    if (item.kind !== 'body-face') continue;
    const parsed = parseBodyFaceId(item.id);
    if (!parsed) continue;
    const body = project.bodies.find((candidate) => candidate.id === parsed.bodyId);
    if (!body || body.kind === 'mesh') continue;
    const mesh = meshes[parsed.bodyId];
    const ref = mesh ? shellFaceRef(mesh, parsed.bodyId, parsed.faceId) : null;
    if (!ref) continue;
    faceRefs.push(ref);
    bodyIds.add(parsed.bodyId);
  }

  if (bodyIds.size === 0 && faceRefs.length === 0) return null;
  return { bodyIds: [...bodyIds], faceRefs };
}
