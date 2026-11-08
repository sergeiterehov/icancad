import type { HealthResult, KernelStatusEvent, ShapeStats, TessellationResult } from '@icancad/kernel';
import { create } from 'zustand';
import type { KernelTask } from '../kernel/scheduler';

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error';

interface KernelState {
  status: KernelStatus;
  phase: KernelStatusEvent['phase'] | null;
  ratio: number | undefined;
  version: string | null;
  loadMs: number | null;
  error: string | null;
  meshes: Record<string, TessellationResult>;
  shapeStats: Record<string, ShapeStats>;
  shapeIds: string[];
  featureErrors: Record<string, string>;
  tasks: KernelTask[];
  handleStatus: (event: KernelStatusEvent) => void;
  setReady: (health: HealthResult) => void;
  setError: (message: string) => void;
  setTasks: (tasks: KernelTask[]) => void;
  setScene: (
    meshes: Record<string, TessellationResult>,
    shapeStats: Record<string, ShapeStats>,
    shapeIds: string[],
    featureErrors: Record<string, string>,
  ) => void;
  clearScene: () => void;
}

export const useKernelStore = create<KernelState>((set) => ({
  status: 'idle',
  phase: null,
  ratio: undefined,
  version: null,
  loadMs: null,
  error: null,
  meshes: {},
  shapeStats: {},
  shapeIds: [],
  featureErrors: {},
  tasks: [],

  handleStatus: (event) => {
    if (event.phase === 'loading-occt') {
      set({ status: 'loading', phase: event.phase, ratio: event.ratio, error: null });
    } else if (event.phase === 'ready') {
      set({
        status: 'ready',
        phase: event.phase,
        ratio: 1,
        version: event.occtVersion ?? null,
        loadMs: event.loadMs ?? null,
        error: null,
      });
    } else {
      set({ status: 'error', phase: event.phase, error: event.message ?? 'KERNEL_LOAD_FAILED' });
    }
  },

  setReady: (health) =>
    set({
      status: 'ready',
      phase: 'ready',
      ratio: 1,
      version: health.occtVersion,
      loadMs: health.loadMs,
      error: null,
    }),

  setError: (message) => set({ status: 'error', phase: 'error', error: message }),

  setTasks: (tasks) => set({ tasks }),

  setScene: (meshes, shapeStats, shapeIds, featureErrors) =>
    set({ meshes, shapeStats, shapeIds, featureErrors }),

  clearScene: () => set({ meshes: {}, shapeStats: {}, shapeIds: [], featureErrors: {} }),
}));
