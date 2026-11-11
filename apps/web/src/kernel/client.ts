import { KernelClient, type HealthResult } from '@icancad/kernel';
import { useKernelStore } from '../stores/kernelStore';
import { abortRebuild, resetRebuildCache } from './rebuild';
import { kernelTaskQueue } from './scheduler';

let client: KernelClient | null = null;
let bootPromise: Promise<void> | null = null;
let tasksBound = false;

export function getKernelClient(): KernelClient {
  if (!client) {
    client = new KernelClient(
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
        name: 'icancad-kernel',
      }),
    );
    client.onStatus = (event) => useKernelStore.getState().handleStatus(event);
  }
  return client;
}

export function bootKernel(): Promise<void> {
  if (!tasksBound) {
    tasksBound = true;
    kernelTaskQueue.subscribe((tasks) => useKernelStore.getState().setTasks(tasks));
  }
  if (!bootPromise) {
    useKernelStore.getState().handleStatus({ type: 'status', phase: 'loading-occt' });
    bootPromise = (async () => {
      try {
        const health = await getKernelClient().request<HealthResult>({ type: 'health' });
        useKernelStore.getState().setReady(health);
      } catch (error) {
        useKernelStore
          .getState()
          .setError(error instanceof Error ? error.message : String(error));
      }
    })();
  }
  return bootPromise;
}

export function cancelKernelWork(): void {
  const cancelled = kernelTaskQueue.cancel();
  if (cancelled === 0) return;
  abortRebuild();
  client?.terminate();
  client = null;
  bootPromise = null;
  resetRebuildCache();
  useKernelStore.getState().clearScene();
  void bootKernel();
}

export function retryKernel(): Promise<void> {
  kernelTaskQueue.cancel();
  abortRebuild();
  client?.terminate();
  client = null;
  bootPromise = null;
  resetRebuildCache();
  useKernelStore.getState().clearScene();
  return bootKernel();
}
