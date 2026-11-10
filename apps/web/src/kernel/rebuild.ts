import type { MakeBoxResult, ShapeStats, TessellationResult } from '@icancad/kernel';
import { sketchProfiles, type ProfileRegion } from '@icancad/sketch';
import {
  HISTORY_START,
  extrudeBodyId,
  featureBodyId,
  type ExtrudeFeature,
  type ImportMeshFeature,
  type Project,
  type SketchFeature,
} from '@icancad/model';
import { sketchFrameOf } from '../sketch/sectionPlane';
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
  const shapeIds: string[] = [];
  /** Body id -> shape that currently represents it in the kernel. */
  const bodyShapes = new Map<string, string>();
  /** Body id -> operation that owns the body. */
  const bodyOwner = new Map<string, string>();
  const createdBodies = new Map<string, string[]>();
  const sketches = new Map<string, SketchFeature>();

  for (const feature of activeFeatures) {
    if (epoch !== rebuildEpoch) return;
    if (feature.type === 'sketch') {
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
          bodyShapes,
          bodyOwner,
          shapeIds,
          meshes,
          createdBodies,
          client,
          epoch,
        });
      } catch (error) {
        featureErrors[feature.id] = kernelErrorCode(error);
      }
      continue;
    }

    featureErrors[feature.id] = 'NOT_IMPLEMENTED';
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
    const total = shapeStats[ownerId] ?? { faces: 0, edges: 0 };
    shapeStats[ownerId] = {
      faces: total.faces + stats.faces,
      edges: total.edges + stats.edges,
    };
  }
  if (epoch !== rebuildEpoch) return;

  useKernelStore.getState().setScene(meshes, shapeStats, meshStats, shapeIds, featureErrors);
  useDocumentStore.getState().syncCreatedBodies(createdBodies);

  for (const shapeId of kernel.shapeIds) {
    if (!shapeIds.includes(shapeId)) {
      void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
    }
  }
}

function kernelErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return name && name !== 'Error' ? name : 'OP_FAILED';
}

interface ExtrudeContext {
  sketches: Map<string, SketchFeature>;
  bodyShapes: Map<string, string>;
  bodyOwner: Map<string, string>;
  shapeIds: string[];
  meshes: Record<string, TessellationResult>;
  /** Bodies each creating operation is expected to own, keyed by operation. */
  createdBodies: Map<string, string[]>;
  client: ReturnType<typeof getKernelClient>;
  epoch: number;
}

async function applyExtrude(feature: ExtrudeFeature, context: ExtrudeContext): Promise<void> {
  const { sketches, bodyShapes, bodyOwner, shapeIds, meshes, createdBodies, client, epoch } = context;
  // An operation without objects builds nothing yet, which is not an error.
  if (!feature.sketchId) return;
  const sketch = sketches.get(feature.sketchId);
  if (!sketch) throw new Error('MISSING_SKETCH');

  const profiles = sketchProfiles(sketch.entities);
  // Extruding the whole sketch means its outermost faces: nested faces are
  // already holes of their parent region.
  const selected =
    feature.scope === 'all'
      ? profiles.filter((profile) => profile.depth === 0)
      : profiles.filter((profile) => feature.regions.includes(profile.id));
  if (selected.length === 0) throw new Error('NO_PROFILE');

  const frame = sketchFrameOf(sketch);
  const distances: number[] = [];
  const forward =
    feature.end === 'through-all'
      ? throughAllDistance(frame, meshes, 1)
      : feature.end === 'symmetric'
        ? Math.abs(feature.distance) / 2
        : Math.abs(feature.distance);
  distances.push(forward);
  if (feature.end === 'symmetric') distances.push(-forward);
  if (feature.secondDirection) {
    const back =
      feature.secondDirection.end === 'through-all'
        ? throughAllDistance(frame, meshes, -1)
        : Math.abs(feature.secondDirection.distance);
    distances.push(-back);
  }

  const makePrism = (shapeId: string, profiles: ProfileRegion[]) =>
    client.request({
      type: 'make-prism',
      params: {
        shapeId,
        origin: frame.origin,
        xAxis: frame.xAxis,
        yAxis: frame.yAxis,
        regions: profiles.map((profile) => ({ outer: profile.outer, holes: profile.holes })),
        distances,
      },
    });

  // Creating bodies keeps every region separate: two circles that do not touch
  // are two bodies, not one body holding two solids.
  if (feature.op === 'new') {
    const bodies: string[] = [];
    for (const [index, profile] of selected.entries()) {
      const shapeId = `${feature.id}:prism-${profile.id}`;
      await makePrism(shapeId, [profile]);
      if (epoch !== rebuildEpoch) return;
      shapeIds.push(shapeId);
      const bodyId = extrudeBodyId(feature.id, profile.id);
      bodyShapes.set(bodyId, shapeId);
      bodyOwner.set(bodyId, feature.id);
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId,
      });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      bodies[index] = bodyId;
    }
    createdBodies.set(feature.id, bodies);
    return;
  }

  const toolShapeId = `tool:${feature.id}`;
  await makePrism(toolShapeId, selected);
  if (epoch !== rebuildEpoch) return;
  shapeIds.push(toolShapeId);

  const applyTo = (bodyId: string) => {
    const baseShapeId = bodyShapes.get(bodyId);
    if (!baseShapeId) return null;
    const resultShapeId = `${bodyId}:${feature.id}`;
    return { baseShapeId, resultShapeId };
  };

  // `scope` describes the regions being extruded, so bodies to combine with are
  // chosen separately: the ones listed on the feature, or every other body.
  const targets =
    feature.bodyIds.length > 0
      ? feature.bodyIds
      : [...bodyShapes.keys()].filter((bodyId) => bodyOwner.get(bodyId) !== feature.id);
  if (targets.length === 0) throw new Error('NO_TARGET_BODY');

  for (const bodyId of targets) {
    const shapes = applyTo(bodyId);
    if (!shapes) continue;
    const booleanOp = feature.op === 'add' ? 'fuse' : feature.op === 'subtract' ? 'cut' : 'common';
    await client.request({
      type: 'boolean',
      params: {
        shapeId: shapes.resultShapeId,
        baseShapeId: shapes.baseShapeId,
        toolShapeId,
        op: booleanOp,
      },
    });
    if (epoch !== rebuildEpoch) return;
    shapeIds.push(shapes.resultShapeId);
    bodyShapes.set(bodyId, shapes.resultShapeId);
    const mesh = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: shapes.resultShapeId,
    });
    if (epoch !== rebuildEpoch) return;
    meshes[bodyId] = mesh;
  }
}

function throughAllDistance(
  frame: { origin: [number, number, number]; normal: [number, number, number] },
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
