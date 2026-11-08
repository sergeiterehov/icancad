import type { MakeBoxResult, ShapeStats, TessellationResult } from '@icancad/kernel';
import { HISTORY_START, featureBodyId, type ImportMeshFeature, type Project } from '@icancad/model';
import type { MeshFormat, MeshStats, ParsedMesh } from '@icancad/io';
import { loadAsset } from '../persistence/db';
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
  const shapeStats: Record<string, ShapeStats> = {};
  const meshStats: Record<string, MeshStats> = {};
  const featureErrors: Record<string, string> = {};
  const shapeIds: string[] = [];

  for (const feature of activeFeatures) {
    if (epoch !== rebuildEpoch) return;
    if (feature.type === 'sketch') continue;
    if (feature.type === 'import-mesh') {
      try {
        const parsed = await loadImportedMesh(feature.assetId, feature.format ?? 'stl');
        meshes[featureBodyId(feature.id)] = transformImportedMesh(parsed, feature);
        meshStats[feature.id] = parsed.stats;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
        featureErrors[feature.id] = message === 'MISSING_ASSET' ? 'MISSING_ASSET' : 'IMPORT_FAILED';
      }
      continue;
    }

    if (feature.type !== 'primitive') {
      featureErrors[feature.id] = 'NOT_IMPLEMENTED';
      continue;
    }

    try {
      const box = await client.request<MakeBoxResult>({
        type: 'make-box',
        params: { shapeId: feature.id, ...feature.params },
      });
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: feature.id,
      });
      if (epoch !== rebuildEpoch) return;
      meshes[featureBodyId(feature.id)] = mesh;
      shapeStats[feature.id] = box.stats;
      shapeIds.push(feature.id);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      featureErrors[feature.id] = name && name !== 'Error' ? name : 'OP_FAILED';
    }
  }

  if (epoch !== rebuildEpoch) return;

  useKernelStore.getState().setScene(meshes, shapeStats, meshStats, shapeIds, featureErrors);

  for (const shapeId of kernel.shapeIds) {
    if (!shapeIds.includes(shapeId)) {
      void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
    }
  }
}
