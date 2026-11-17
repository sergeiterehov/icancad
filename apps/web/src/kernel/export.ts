import type { TessellationQuality, TessellationResult } from '@icancad/kernel';
import { useKernelStore } from '../stores/kernelStore';
import { getKernelClient } from './client';
import { kernelTaskQueue } from './scheduler';

/**
 * Tessellates the current shapes at the quality chosen for an export. It runs
 * in the kernel queue, so an export never interleaves with a rebuild; imported
 * meshes have no B-rep and are passed through as they are.
 */
export function meshesForExport(
  bodyIds: readonly string[],
  quality: TessellationQuality,
  label: string,
): Promise<TessellationResult[]> {
  return kernelTaskQueue.enqueue({
    key: 'export',
    label,
    run: async () => {
      const client = getKernelClient();
      const kernel = useKernelStore.getState();
      const meshes: TessellationResult[] = [];
      for (const bodyId of bodyIds) {
        const shapeId = kernel.bodyShapes[bodyId];
        if (shapeId) {
          meshes.push(
            await client.request<TessellationResult>({ type: 'tessellate', shapeId, quality }),
          );
          continue;
        }
        const mesh = kernel.meshes[bodyId];
        if (mesh) meshes.push(mesh);
      }
      return meshes;
    },
  });
}
