import type { MakeBoxResult, ShapeStats, TessellationResult } from '@icancad/kernel';
import { sketchProfiles, type ProfileRegion } from '@icancad/sketch';
import {
  HISTORY_START,
  extrudeBodyId,
  featureBodyId,
  type BodyFaceRef,
  type ExtrudeFeature,
  type ImportMeshFeature,
  type Project,
  type SketchFeature,
  type SketchFrame,
} from '@icancad/model';
import { computeSketchFrame, faceSketchValid } from '../sketch/sectionPlane';
import type { MeshFormat, MeshStats, ParsedMesh } from '@icancad/io';
import { loadAsset } from '../persistence/db';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { parseMeshInWorker } from '../io/client';
import { getKernelClient } from './client';
import { kernelTaskQueue } from './scheduler';

let rebuildEpoch = 0;
const importedMeshCache = new Map<string, Promise<ParsedMesh>>();

async function loadImportedMesh(assetId: string, format: MeshFormat): Promise<ParsedMesh> {
  const cached = importedMeshCache.get(assetId);
  if (cached) return cached;
  const promise = (async () => {
    const blob = await loadAsset(assetId);
    if (!blob) throw new Error('MISSING_ASSET');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return parseMeshInWorker(bytes, format);
  })();
  importedMeshCache.set(assetId, promise);
  promise.catch(() => importedMeshCache.delete(assetId));
  return promise;
}

function transformImportedMesh(mesh: ParsedMesh, feature: ImportMeshFeature): TessellationResult {
  const scale = feature.scale || 1;
  const [rx, ry, rz] = feature.transform.rotation;
  const [tx, ty, tz] = feature.transform.translation;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index]! * scale;
    const y = mesh.positions[index + 1]! * scale;
    const z = mesh.positions[index + 2]! * scale;

    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    const x3 = x2 * cz - y1 * sz;
    const y3 = x2 * sz + y1 * cz;

    positions[index] = x3 + tx;
    positions[index + 1] = y3 + ty;
    positions[index + 2] = z2 + tz;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }

    const nx = mesh.normals[index]!;
    const ny = mesh.normals[index + 1]!;
    const nz = mesh.normals[index + 2]!;
    const ny1 = ny * cx - nz * sx;
    const nz1 = ny * sx + nz * cx;
    const nx2 = nx * cy + nz1 * sy;
    const nz2 = -nx * sy + nz1 * cy;
    normals[index] = nx2 * cz - ny1 * sz;
    normals[index + 1] = nx2 * sz + ny1 * cz;
    normals[index + 2] = nz2;
  }

  return {
    positions,
    normals,
    indices: mesh.indices,
    faceIds: new Uint32Array(positions.length / 3),
    triangleCount: mesh.stats.triangleCount,
    vertexCount: positions.length / 3,
    bbox: {
      min: mesh.positions.length > 0 ? min : [0, 0, 0],
      max: mesh.positions.length > 0 ? max : [0, 0, 0],
    },
  };
}

export function abortRebuild(): void {
  rebuildEpoch += 1;
  useKernelStore.getState().setRebuildCursor(null);
}

export function rebuildScene(project: Project, label: string): Promise<void> {
  if (useKernelStore.getState().status !== 'ready') return Promise.resolve();
  return kernelTaskQueue.enqueue({
    key: 'rebuild',
    label,
    run: () => runRebuild(project),
  });
}

async function runRebuild(project: Project): Promise<void> {
  const epoch = ++rebuildEpoch;
  const kernel = useKernelStore.getState();
  const client = getKernelClient();

  const endIndex =
    project.historyEnd === null
      ? project.features.length - 1
      : project.historyEnd === HISTORY_START
        ? -1
        : project.features.findIndex((feature) => feature.id === project.historyEnd);
  const activeFeatures = project.features
    .slice(0, endIndex + 1)
    .filter((feature) => !feature.suppressed);

  const meshes: Record<string, TessellationResult> = {};
  const meshStats: Record<string, MeshStats> = {};
  const featureErrors: Record<string, string> = {};
  /** Per-operation errors of individual body targets, shown on the body itself. */
  const featureBodyErrors: Record<string, Record<string, string>> = {};
  /** Per-operation errors of picked face objects, keyed by `s:`/`b:` ref. */
  const featureObjectErrors: Record<string, Record<string, string>> = {};
  const shapeIds: string[] = [];
  /** Body id -> shape that currently represents it in the kernel. */
  const bodyShapes = new Map<string, string>();
  /** Body id -> operation that owns the body. */
  const bodyOwner = new Map<string, string>();
  const createdBodies = new Map<string, string[]>();
  const sketches = new Map<string, SketchFeature>();
  /** Sketch id -> frame frozen when that operation was evaluated. */
  const sketchFrames: Record<string, SketchFrame> = {};
  /** The first failed operation: nothing after it is built. */
  let blockedFeatureId: string | null = null;
  useKernelStore.getState().setRebuildCursor(0);

  for (const feature of activeFeatures) {
    if (epoch !== rebuildEpoch) return;
    // The dashed caret sits after the operation that is being computed.
    const progress = project.features.findIndex((candidate) => candidate.id === feature.id);
    if (progress >= 0) useKernelStore.getState().setRebuildCursor(progress + 1);
    if (feature.type === 'sketch') {
      if (feature.plane.type === 'face') {
        const bodyId = feature.plane.bodyId ?? '';
        if (!bodyShapes.has(bodyId) || !faceSketchValid(feature, meshes[bodyId])) {
          featureErrors[feature.id] = 'INVALID_SKETCH_PLANE';
          blockedFeatureId = feature.id;
          break;
        }
      }
      sketchFrames[feature.id] = computeSketchFrame(
        feature,
        feature.plane.type === 'face' ? meshes[feature.plane.bodyId ?? ''] : undefined,
      );
      sketches.set(feature.id, feature);
      continue;
    }
    if (feature.type === 'import-mesh') {
      try {
        const parsed = await loadImportedMesh(feature.assetId, feature.format ?? 'stl');
        const bodyId = featureBodyId(feature.id);
        meshes[bodyId] = transformImportedMesh(parsed, feature);
        bodyOwner.set(bodyId, feature.id);
        meshStats[feature.id] = parsed.stats;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
        featureErrors[feature.id] = message === 'MISSING_ASSET' ? 'MISSING_ASSET' : 'IMPORT_FAILED';
        blockedFeatureId = feature.id;
        break;
      }
      continue;
    }

    if (feature.type === 'primitive') {
      try {
        const bodyId = featureBodyId(feature.id);
        const shapeId = `feat:${feature.id}`;
        await client.request<MakeBoxResult>({
          type: 'make-box',
          params: { shapeId, ...feature.params },
        });
        bodyShapes.set(bodyId, shapeId);
        bodyOwner.set(bodyId, feature.id);
        shapeIds.push(shapeId);
        const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
        if (epoch !== rebuildEpoch) return;
        meshes[bodyId] = mesh;
      } catch (error) {
        featureErrors[feature.id] = kernelErrorCode(error);
        blockedFeatureId = feature.id;
        break;
      }
      continue;
    }

    if (feature.type === 'delete-body') {
      bodyShapes.delete(feature.bodyId);
      delete meshes[feature.bodyId];
      continue;
    }

    if (feature.type === 'extrude') {
      // Bodies are whatever this rebuild reports; an operation that no longer
      // creates bodies (or fails) owns none.
      createdBodies.set(feature.id, []);
      try {
        await applyExtrude(feature, {
          sketches,
          sketchFrames,
          bodyShapes,
          bodyOwner,
          shapeIds,
          meshes,
          createdBodies,
          featureErrors,
          featureBodyErrors,
          featureObjectErrors,
          client,
          epoch,
        });
        // A per-body failure does not throw, but it still blocks the timeline:
        // later operations must not be built on a failed state.
        if (featureErrors[feature.id]) {
          blockedFeatureId = feature.id;
          break;
        }
      } catch (error) {
        featureErrors[feature.id] = kernelErrorCode(error);
        blockedFeatureId = feature.id;
        break;
      }
      continue;
    }

    featureErrors[feature.id] = 'NOT_IMPLEMENTED';
    blockedFeatureId = feature.id;
    break;
  }

  if (epoch !== rebuildEpoch) return;

  // Stats are kept per body and summed per operation, so selecting either shows
  // the numbers of what is actually on screen.
  const shapeStats: Record<string, ShapeStats> = {};
  for (const [bodyId, ownerId] of bodyOwner) {
    const shapeId = bodyShapes.get(bodyId);
    if (!shapeId) continue;
    const stats = await client.request<ShapeStats>({ type: 'topology', shapeId });
    shapeStats[bodyId] = stats;
    const total = shapeStats[ownerId] ?? { faces: 0, edges: 0, solids: 0 };
    shapeStats[ownerId] = {
      faces: total.faces + stats.faces,
      edges: total.edges + stats.edges,
      solids: total.solids + stats.solids,
    };
  }
  if (epoch !== rebuildEpoch) return;
  useKernelStore.getState().setRebuildCursor(null);

  useKernelStore
    .getState()
    .setScene(
      meshes,
      shapeStats,
      meshStats,
      shapeIds,
      featureErrors,
      featureBodyErrors,
      featureObjectErrors,
      sketchFrames,
      project.historyEnd,
    );
  useDocumentStore.getState().syncCreatedBodies(createdBodies, blockedFeatureId);

  for (const shapeId of kernel.shapeIds) {
    if (!shapeIds.includes(shapeId)) {
      void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
    }
  }
}

function kernelErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'OP_FAILED';
  if (error.name && error.name !== 'Error') return error.name;
  // Local checks throw `new Error('CODE')`; kernel failures carry their code in
  // the error name.
  return /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'OP_FAILED';
}

interface ExtrudeContext {
  sketches: Map<string, SketchFeature>;
  sketchFrames: Record<string, SketchFrame>;
  bodyShapes: Map<string, string>;
  bodyOwner: Map<string, string>;
  shapeIds: string[];
  meshes: Record<string, TessellationResult>;
  /** Bodies each creating operation is expected to own, keyed by operation. */
  createdBodies: Map<string, string[]>;
  featureErrors: Record<string, string>;
  featureBodyErrors: Record<string, Record<string, string>>;
  featureObjectErrors: Record<string, Record<string, string>>;
  client: ReturnType<typeof getKernelClient>;
  epoch: number;
}

async function applyExtrude(feature: ExtrudeFeature, context: ExtrudeContext): Promise<void> {
  const {
    sketches,
    sketchFrames,
    bodyShapes,
    bodyOwner,
    shapeIds,
    meshes,
    createdBodies,
    featureErrors,
    featureBodyErrors,
    featureObjectErrors,
    client,
    epoch,
  } = context;

  const faceRefs = feature.faceRefs ?? [];
  // An operation without objects builds nothing yet, which is not an error.
  if (!feature.sketchId && faceRefs.length === 0) return;

  let sketch: SketchFeature | undefined;
  let selected: ProfileRegion[] = [];
  if (feature.sketchId) {
    sketch = sketches.get(feature.sketchId);
    if (!sketch) throw new Error('MISSING_SKETCH');
    const profiles = sketchProfiles(sketch.entities);
    // Extruding the whole sketch means its outermost faces: nested faces are
    // already holes of their parent region.
    selected =
      feature.scope === 'all'
        ? profiles.filter((profile) => profile.depth === 0)
        : profiles.filter((profile) => feature.regions.includes(profile.id));
    if (selected.length === 0) throw new Error('NO_PROFILE');
  }

  const frame = sketch
    ? (sketchFrames[sketch.id] ?? computeSketchFrame(sketch))
    : null;
  const markBodyError = (bodyId: string, code: string) => {
    const errors = featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    featureBodyErrors[feature.id] = errors;
  };
  const bodyErrorCode = (bodyId: string) =>
    bodyOwner.has(bodyId) ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY';

  // A new body operation may produce several bodies. Every region and every
  // picked face becomes an independent solid, exactly as the user picked them.
  // Body ids use a stable slot, so replacing the first face of the operation
  // keeps that body's name and colour.
  if (feature.op === 'new') {
    interface NewBodyPart {
      key: string;
      profile?: ProfileRegion;
      ref?: BodyFaceRef;
    }
    const profileByRegion = new Map(selected.map((profile) => [profile.id, profile]));
    const refByKey = new Map(
      faceRefs.map((ref) => [`b:${ref.bodyId}#${ref.faceId}`, ref]),
    );
    const parts: NewBodyPart[] = [];
    const usedProfiles = new Set<string>();
    const usedRefs = new Set<string>();
    const addPart = (key: string) => {
      if (key.startsWith('s:')) {
        const regionId = key.slice(2).split('#')[1];
        const profile = regionId ? profileByRegion.get(regionId) : undefined;
        if (!profile || usedProfiles.has(profile.id)) return;
        usedProfiles.add(profile.id);
        parts.push({ key, profile });
        return;
      }
      if (key.startsWith('b:')) {
        const ref = refByKey.get(key);
        if (!ref || usedRefs.has(key)) return;
        usedRefs.add(key);
        parts.push({ key, ref });
      }
    };
    for (const key of feature.objectOrder ?? []) addPart(key);
    if (sketch) {
      for (const profile of selected) addPart(`s:${sketch.id}#${profile.id}`);
    }
    for (const ref of faceRefs) addPart(`b:${ref.bodyId}#${ref.faceId}`);

    // Faces touching along an edge belong to the same solid: extruding two
    // crescents and the lens between them must make one body, while the two
    // crescents alone make two. Group transitively before building.
    const groupByProfile = new Map<string, ProfileRegion[]>();
    for (const profile of selected) {
      if (groupByProfile.has(profile.id)) continue;
      const group: ProfileRegion[] = [profile];
      groupByProfile.set(profile.id, group);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of selected) {
          if (groupByProfile.has(candidate.id)) continue;
          const touches = group.some((entry) =>
            entry.edges.some((edge) => candidate.edges.includes(edge)),
          );
          if (!touches) continue;
          group.push(candidate);
          groupByProfile.set(candidate.id, group);
          changed = true;
        }
      }
    }

    const bodies: string[] = [];
    const emittedGroups = new Set<ProfileRegion[]>();
    let slot = 0;
    for (const part of parts) {
      if (part.profile) {
        const group = groupByProfile.get(part.profile.id) ?? [part.profile];
        if (emittedGroups.has(group)) continue;
        emittedGroups.add(group);
        const bodyId = extrudeBodyId(feature.id, `body-${slot}`);
        const shapeId = `${feature.id}:prism-${slot}`;
        await client.request({
          type: 'make-prism',
          params: {
            shapeId,
            origin: frame!.origin,
            xAxis: frame!.xAxis,
            yAxis: frame!.yAxis,
            regions: group.map((profile) => ({
              outer: profile.outer,
              holes: profile.holes,
            })),
            distances: extrudeDistances(feature, frame!.origin, frame!.normal, meshes),
          },
        });
        if (epoch !== rebuildEpoch) return;
        shapeIds.push(shapeId);
        bodyShapes.set(bodyId, shapeId);
        bodyOwner.set(bodyId, feature.id);
        const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
        if (epoch !== rebuildEpoch) return;
        meshes[bodyId] = mesh;
        bodies.push(bodyId);
        slot += 1;
        continue;
      }

      const ref = part.ref!;
      const sourceShapeId = bodyShapes.get(ref.bodyId);
      if (!sourceShapeId) {
        markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
        continue;
      }
      const bodyId = extrudeBodyId(feature.id, `body-${slot}`);
      const shapeId = `${feature.id}:face-${slot}`;
      await client.request({
        type: 'make-face-prism',
        params: {
          shapeId,
          sourceShapeId,
          faceId: Number(ref.faceId),
          normal: ref.normal,
          distances: extrudeDistances(feature, ref.origin, ref.normal, meshes),
        },
      });
      if (epoch !== rebuildEpoch) return;
      shapeIds.push(shapeId);
      bodyShapes.set(bodyId, shapeId);
      bodyOwner.set(bodyId, feature.id);
      const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      bodies.push(bodyId);
      slot += 1;
    }
    const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
    if (bodyErrors.length > 0) {
      featureErrors[feature.id] = bodyErrors[0]!;
    }
    createdBodies.set(feature.id, bodies);
    return;
  }

  // Every object produces its own tool solid. Keeping them separate lets an
  // "add" apply only the parts that actually touch a given body; cut/intersect
  // fuse them back into one tool below. The object key matches the Faces list,
  // so a part that cannot be applied can be reported on its own row.
  const toolParts: { shapeId: string; key: string }[] = [];
  for (const [index, profile] of selected.entries()) {
    const shapeId = `tool:${feature.id}:sketch-${index}`;
    await client.request({
      type: 'make-prism',
      params: {
        shapeId,
        origin: frame!.origin,
        xAxis: frame!.xAxis,
        yAxis: frame!.yAxis,
        regions: [{ outer: profile.outer, holes: profile.holes }],
        distances: extrudeDistances(feature, frame!.origin, frame!.normal, meshes),
      },
    });
    if (epoch !== rebuildEpoch) return;
    shapeIds.push(shapeId);
    toolParts.push({ shapeId, key: `s:${sketch!.id}#${profile.id}` });
  }
  for (const [index, ref] of faceRefs.entries()) {
    const sourceShapeId = bodyShapes.get(ref.bodyId);
    if (!sourceShapeId) {
      markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
      continue;
    }
    const shapeId = `tool:${feature.id}:face-${index}`;
    await client.request({
      type: 'make-face-prism',
      params: {
        shapeId,
        sourceShapeId,
        faceId: Number(ref.faceId),
        normal: ref.normal,
        distances: extrudeDistances(feature, ref.origin, ref.normal, meshes),
      },
    });
    if (epoch !== rebuildEpoch) return;
    shapeIds.push(shapeId);
    toolParts.push({ shapeId, key: `b:${ref.bodyId}#${ref.faceId}` });
  }
  if (toolParts.length === 0) throw new Error('NO_PROFILE');

  // Add handles parts individually (see the target loop); the other operations
  // share one fused tool.
  let toolShapeId = toolParts[0]!.shapeId;
  if (feature.op !== 'add') {
    for (const [index, part] of toolParts.slice(1).entries()) {
      const fusedId = `tool:${feature.id}:fused-${index}`;
      await client.request({
        type: 'boolean',
        params: {
          shapeId: fusedId,
          baseShapeId: toolShapeId,
          toolShapeId: part.shapeId,
          op: 'fuse',
        },
      });
      if (epoch !== rebuildEpoch) return;
      shapeIds.push(fusedId);
      toolShapeId = fusedId;
    }
  }

  // `scope` describes the regions being extruded, so bodies to combine with are
  // chosen separately: the ones listed on the feature, or every other body.
  const explicitTargets = feature.bodyIds.length > 0;
  const targets = explicitTargets
    ? feature.bodyIds
    : [...bodyShapes.keys()].filter((bodyId) => bodyOwner.get(bodyId) !== feature.id);
  if (targets.length === 0) throw new Error('NO_TARGET_BODY');

  let applied = 0;
  /** Parts that actually affected at least one explicitly chosen body. */
  const appliedParts = new Set<string>();
  for (const bodyId of targets) {
    const baseShapeId = bodyShapes.get(bodyId);
    if (!baseShapeId) {
      // Only an explicitly selected body is an error; with "all bodies" a mesh
      // or an empty body simply cannot participate.
      if (explicitTargets) markBodyError(bodyId, bodyErrorCode(bodyId));
      continue;
    }

    // Adding applies each tool part separately. A part that would create an
    // independent solid is skipped, so two faces on two bodies both receive
    // their own material instead of rejecting each other's disjoint parts.
    if (feature.op === 'add') {
      const initial = await client.request<ShapeStats>({
        type: 'topology',
        shapeId: baseShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      let currentShapeId = baseShapeId;
      let solidCount = initial.solids;
      let touched = false;

      for (const [index, part] of toolParts.entries()) {
        const resultShapeId = `${bodyId}:${feature.id}:part-${index}`;
        await client.request({
          type: 'boolean',
          params: {
            shapeId: resultShapeId,
            baseShapeId: currentShapeId,
            toolShapeId: part.shapeId,
            op: 'fuse',
          },
        });
        if (epoch !== rebuildEpoch) return;
        const after = await client.request<ShapeStats>({
          type: 'topology',
          shapeId: resultShapeId,
        });
        if (epoch !== rebuildEpoch) return;
        if (after.solids > solidCount) {
          void client.request({ type: 'dispose', shapeId: resultShapeId }).catch(() => undefined);
          continue;
        }
        shapeIds.push(resultShapeId);
        currentShapeId = resultShapeId;
        solidCount = after.solids;
        touched = true;
        if (explicitTargets) appliedParts.add(part.key);
      }

      if (!touched) {
        // An explicitly chosen body that no part touches cannot take the add.
        if (explicitTargets) markBodyError(bodyId, 'DISJOINT_UNION');
        continue;
      }

      bodyShapes.set(bodyId, currentShapeId);
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: currentShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      applied += 1;
      continue;
    }

    const resultShapeId = `${bodyId}:${feature.id}`;
    const booleanOp = feature.op === 'subtract' ? 'cut' : 'common';
    await client.request({
      type: 'boolean',
      params: {
        shapeId: resultShapeId,
        baseShapeId,
        toolShapeId,
        op: booleanOp,
      },
    });
    if (epoch !== rebuildEpoch) return;
    shapeIds.push(resultShapeId);
    bodyShapes.set(bodyId, resultShapeId);
    const mesh = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: resultShapeId,
    });
    if (epoch !== rebuildEpoch) return;
    meshes[bodyId] = mesh;
    applied += 1;
  }

  // A picked face that affects none of the explicitly chosen bodies would form
  // an independent body, so it is reported on its own Faces row.
  if (explicitTargets && feature.op === 'add') {
    const objectErrors = featureObjectErrors[feature.id] ?? {};
    for (const part of toolParts) {
      if (!appliedParts.has(part.key)) objectErrors[part.key] = 'DISJOINT_UNION';
    }
    if (Object.keys(objectErrors).length > 0) featureObjectErrors[feature.id] = objectErrors;
  }

  const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
  const objectErrors = Object.values(featureObjectErrors[feature.id] ?? {});
  if (applied === 0 || bodyErrors.length > 0 || objectErrors.length > 0) {
    // The operation block explains the first failure; every failing body and
    // object also carries its own icon. If every implicit target was skipped,
    // there is simply nothing to apply the extrusion to.
    featureErrors[feature.id] = bodyErrors[0] ?? objectErrors[0] ?? 'NO_TARGET_BODY';
  }
}

// Distances are signed along the normal. Flipping mirrors the primary direction,
// and the second direction always goes to the opposite side of it.
function throughAllAllowed(op: ExtrudeFeature['op']): boolean {
  return op === 'subtract' || op === 'intersect';
}

function extrudeDistances(
  feature: ExtrudeFeature,
  origin: readonly [number, number, number],
  normal: readonly [number, number, number],
  meshes: Record<string, TessellationResult>,
): number[] {
  const sign = feature.reversed ? -1 : 1;
  const distances: number[] = [];
  if (feature.end === 'symmetric') {
    const half = Math.abs(feature.distance);
    distances.push(-half, half);
    return distances;
  }
  // Older files can hold a through-all extent that the current operation does
  // not allow; it is treated as a blind extent because its control is hidden.
  const primaryEnd =
    feature.end === 'through-all' && !throughAllAllowed(feature.op) ? 'blind' : feature.end;
  if (primaryEnd === 'through-all') {
    distances.push(sign * throughAllDistance({ origin, normal }, meshes, sign));
  } else {
    distances.push(sign * Math.abs(feature.distance));
  }
  if (feature.secondDirection) {
    const secondEnd =
      feature.secondDirection.end === 'through-all' && !throughAllAllowed(feature.op)
        ? 'blind'
        : feature.secondDirection.end;
    const back =
      secondEnd === 'through-all'
        ? throughAllDistance({ origin, normal }, meshes, -sign)
        : Math.abs(feature.secondDirection.distance);
    distances.push(-sign * back);
  }
  return distances;
}

function throughAllDistance(
  frame: {
    origin: readonly [number, number, number];
    normal: readonly [number, number, number];
  },
  meshes: Record<string, TessellationResult>,
  direction: number,
): number {
  const [nx, ny, nz] = frame.normal;
  let far = 0;
  for (const mesh of Object.values(meshes)) {
    for (const corner of [mesh.bbox.min, mesh.bbox.max] as [number, number, number][]) {
      const offset =
        ((corner[0] - frame.origin[0]) * nx +
          (corner[1] - frame.origin[1]) * ny +
          (corner[2] - frame.origin[2]) * nz) *
        direction;
      far = Math.max(far, offset);
    }
  }
  return Math.max(10, far + 10);
}
