import type { MakeBoxResult, ShapeStats, TessellationResult } from '@icancad/kernel';
import { HISTORY_START, featureBodyId, type Project } from '@icancad/model';
import { useKernelStore } from '../stores/kernelStore';
import { getKernelClient } from './client';
import { kernelTaskQueue } from './scheduler';

let rebuildEpoch = 0;

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
  const featureErrors: Record<string, string> = {};
  const shapeIds: string[] = [];

  for (const feature of activeFeatures) {
    if (epoch !== rebuildEpoch) return;
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

  useKernelStore.getState().setScene(meshes, shapeStats, shapeIds, featureErrors);

  for (const shapeId of kernel.shapeIds) {
    if (!shapeIds.includes(shapeId)) {
      void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
    }
  }
}
