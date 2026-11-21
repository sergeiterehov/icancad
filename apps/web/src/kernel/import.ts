import type { ImportStepResult, InspectStepResult } from '@icancad/kernel';
import { loadAsset } from '../persistence/db';
import { getKernelClient } from './client';
import { kernelTaskQueue } from './scheduler';

const importedStepCache = new Map<string, Promise<Uint8Array>>();

/** Reads the bodies a STEP file carries, without building them. */
export function inspectStep(data: Uint8Array, label: string): Promise<InspectStepResult> {
  return kernelTaskQueue.enqueue({
    key: 'import',
    label,
    run: () =>
      getKernelClient().request<InspectStepResult>({
        type: 'inspect-step',
        params: { data },
      }),
  });
}

/** Bytes of an imported STEP file; the asset never changes after import. */
export function loadImportedStep(assetId: string): Promise<Uint8Array> {
  const cached = importedStepCache.get(assetId);
  if (cached) return cached;
  const promise = (async () => {
    const blob = await loadAsset(assetId);
    if (!blob) throw new Error('MISSING_ASSET');
    return new Uint8Array(await blob.arrayBuffer());
  })();
  importedStepCache.set(assetId, promise);
  promise.catch(() => importedStepCache.delete(assetId));
  return promise;
}

/** Builds a STEP file into kernel shapes; called by the rebuild. */
export function importStepToKernel(data: Uint8Array, prefix: string): Promise<ImportStepResult> {
  return getKernelClient().request<ImportStepResult>({
    type: 'import-step',
    params: { data, prefix },
  });
}
