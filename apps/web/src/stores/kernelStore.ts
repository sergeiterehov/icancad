import type {
  HealthResult,
  KernelStatusEvent,
  ShapeStats,
  TessellationResult,
} from '@icancad/kernel';
import type { SketchFrame } from '@icancad/model';
import { create } from 'zustand';
import type { MeshStats } from '@icancad/io';
import type { KernelTask } from '../kernel/scheduler';

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error';

export function isModelRebuilding(state: {
  status: KernelStatus;
  tasks: KernelTask[];
}): boolean {
  return state.status !== 'ready' || state.tasks.some((task) => task.key === 'rebuild');
}

interface KernelState {
  status: KernelStatus;
  phase: KernelStatusEvent['phase'] | null;
  ratio: number | undefined;
  version: string | null;
  loadMs: number | null;
  error: string | null;
  meshes: Record<string, TessellationResult>;
  /** Frames computed when each sketch operation was evaluated. */
  sketchFrames: Record<string, SketchFrame>;
  /** Increments whenever a rebuild publishes a scene. */
  sceneVersion: number;
  sceneHistoryEnd: string | null;
  shapeStats: Record<string, ShapeStats>;
  meshStats: Record<string, MeshStats>;
  shapeIds: string[];
  featureErrors: Record<string, string>;
  /** Errors of individual body targets, keyed by operation then body. */
  featureBodyErrors: Record<string, Record<string, string>>;
  /** Errors of picked face objects, keyed by operation then `s:`/`b:` ref. */
  featureObjectErrors: Record<string, Record<string, string>>;
  tasks: KernelTask[];
  /** Caret position of the operation currently being rebuilt. */
  rebuildCursor: number | null;
  handleStatus: (event: KernelStatusEvent) => void;
  setReady: (health: HealthResult) => void;
  setError: (message: string) => void;
  setTasks: (tasks: KernelTask[]) => void;
  setRebuildCursor: (rebuildCursor: number | null) => void;
  setScene: (
    meshes: Record<string, TessellationResult>,
    shapeStats: Record<string, ShapeStats>,
    meshStats: Record<string, MeshStats>,
    shapeIds: string[],
    featureErrors: Record<string, string>,
    featureBodyErrors: Record<string, Record<string, string>>,
    featureObjectErrors: Record<string, Record<string, string>>,
    sketchFrames: Record<string, SketchFrame>,
    sceneHistoryEnd: string | null,
  ) => void;
  clearScene: () => void;
  clearFeatureError: (featureId: string) => void;
}

export const useKernelStore = create<KernelState>((set) => ({
  status: 'idle',
  phase: null,
  ratio: undefined,
  version: null,
  loadMs: null,
  error: null,
  meshes: {},
  sketchFrames: {},
  sceneVersion: 0,
  sceneHistoryEnd: null,
  shapeStats: {},
  meshStats: {},
  shapeIds: [],
  featureErrors: {},
  featureBodyErrors: {},
  featureObjectErrors: {},
  tasks: [],
  rebuildCursor: null,

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
  setRebuildCursor: (rebuildCursor) => set({ rebuildCursor }),

  setScene: (
    meshes,
    shapeStats,
    meshStats,
    shapeIds,
    featureErrors,
    featureBodyErrors,
    featureObjectErrors,
    sketchFrames,
    sceneHistoryEnd,
  ) =>
    set((state) => ({
      meshes,
      sketchFrames,
      sceneVersion: state.sceneVersion + 1,
      sceneHistoryEnd,
      shapeStats,
      meshStats,
      shapeIds,
      featureErrors,
      featureBodyErrors,
      featureObjectErrors,
    })),

  clearScene: () =>
    set((state) => ({
      meshes: {},
      sketchFrames: {},
      sceneVersion: state.sceneVersion + 1,
      sceneHistoryEnd: null,
      shapeStats: {},
      meshStats: {},
      shapeIds: [],
      featureErrors: {},
      featureBodyErrors: {},
      featureObjectErrors: {},
      rebuildCursor: null,
    })),
  clearFeatureError: (featureId) =>
    set((state) => {
      if (!state.featureErrors[featureId]) return state;
      const featureErrors = { ...state.featureErrors };
      delete featureErrors[featureId];
      return { featureErrors };
    }),
}));
