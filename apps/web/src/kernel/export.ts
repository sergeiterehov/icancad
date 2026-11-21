import type {
  ExportStepResult,
  TessellationQuality,
  TessellationResult,
} from '@icancad/kernel';
import type { BodyObject } from '@icancad/model';
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

/** One body as the STEP writer sees it. */
export interface StepBodyExport {
  /** Kernel shape of the body. */
  shapeId: string;
  name: string;
  /** `#rrggbb` from the object metadata. */
  color: string;
}

/**
 * Bodies STEP can carry, with their names and colours. Imported meshes have no
 * B-rep and are counted so the caller can say how many were left out; a solid
 * whose shape is not built yet is skipped silently, like the STL exporter does.
 */
export function stepBodies(
  bodies: readonly BodyObject[],
  shapes: Readonly<Record<string, string>>,
): { bodies: StepBodyExport[]; skipped: number } {
  const exported: StepBodyExport[] = [];
  let skipped = 0;
  for (const body of bodies) {
    if (body.kind === 'mesh') {
      skipped += 1;
      continue;
    }
    const shapeId = shapes[body.id];
    if (!shapeId) continue;
    exported.push({ shapeId, name: body.name, color: body.color });
  }
  return { bodies: exported, skipped };
}

/** Writes the bodies to one AP214 STEP file in the kernel queue. */
export function stepForExport(
  bodies: readonly StepBodyExport[],
  label: string,
): Promise<Uint8Array> {
  return kernelTaskQueue.enqueue({
    key: 'export',
    label,
    run: async () => {
      const result = await getKernelClient().request<ExportStepResult>({
        type: 'export-step',
        params: { bodies: [...bodies] },
      });
      return result.data;
    },
  });
}
