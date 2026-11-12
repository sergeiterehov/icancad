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

/** How an object differs between the model and the operation being edited. */
export type PreviewMarkKind = 'added' | 'modified' | 'removed';

export interface PreviewBodyMark {
  /** Body id; added bodies may not exist in the document yet. */
  id: string;
  kind: PreviewMarkKind;
  name: string;
  color: string;
  /** Tessellation of the body before the operation; 3D picking uses it. */
  baseMesh?: TessellationResult;
  /**
   * Draw `baseMesh` instead of the result, so an added part is represented only
   * by its translucent ghost while the original body keeps its exact look.
   */
  renderBase?: boolean;
  /**
   * Whether the body is drawn as a translucent phantom. A cut shows its result
   * solid so the removed material reads as a hole, so it stays opaque.
   */
  translucent?: boolean;
}

/** A translucent volume that only exists in the preview, such as a cut tool. */
export interface SceneGhost {
  id: string;
  mesh: TessellationResult;
  color: string;
  /**
   * Soft edges of the ghost: beyond the given plane the opacity fades out over
   * roughly 100 screen pixels, so a through cut does not end abruptly.
   */
  fade?: { axis: [number, number, number]; start: number }[];
}

/** Live preview of the operation that is being edited. */
export interface ScenePreview {
  featureId: string;
  bodies: PreviewBodyMark[];
  ghosts: SceneGhost[];
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
  shapeStats: Record<string, ShapeStats>;
  meshStats: Record<string, MeshStats>;
  shapeIds: string[];
  featureErrors: Record<string, string>;
  /** Errors of individual body targets, keyed by operation then body. */
  featureBodyErrors: Record<string, Record<string, string>>;
  /** Errors of picked face objects, keyed by operation then `s:`/`b:` ref. */
  featureObjectErrors: Record<string, Record<string, string>>;
  /** Operation preview, or null when the scene shows the document as is. */
  preview: ScenePreview | null;
  /** Operation whose evaluation produced each body's current shape. */
  bodyOperations: Record<string, string>;
  /** Operation that created each face of a body, in shape order. */
  faceOperations: Record<string, string[]>;
  /**
   * Edge treatment sizes the kernel could apply, keyed by operation. A request
   * above the limit is reduced instead of failing, and the inspector says so.
   */
  featureLimits: Record<string, { requested: number; applied: number }>;
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
    preview: ScenePreview | null,
  ) => void;
  setBodyOperations: (bodyOperations: Record<string, string>) => void;
  setFaceOperations: (faceOperations: Record<string, string[]>) => void;
  setFeatureLimits: (featureLimits: Record<string, { requested: number; applied: number }>) => void;
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
  shapeStats: {},
  meshStats: {},
  shapeIds: [],
  featureErrors: {},
  featureBodyErrors: {},
  featureObjectErrors: {},
  preview: null,
  bodyOperations: {},
  faceOperations: {},
  featureLimits: {},
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
    preview,
  ) =>
    set((state) => ({
      meshes,
      sketchFrames,
      sceneVersion: state.sceneVersion + 1,
      shapeStats,
      meshStats,
      shapeIds,
      featureErrors,
      featureBodyErrors,
      featureObjectErrors,
      preview,
    })),

  setBodyOperations: (bodyOperations) => set({ bodyOperations }),

  setFaceOperations: (faceOperations) => set({ faceOperations }),

  setFeatureLimits: (featureLimits) => set({ featureLimits }),

  clearScene: () =>
    set((state) => ({
      meshes: {},
      sketchFrames: {},
      sceneVersion: state.sceneVersion + 1,
      shapeStats: {},
      meshStats: {},
      shapeIds: [],
      featureErrors: {},
      featureBodyErrors: {},
      featureObjectErrors: {},
      preview: null,
      bodyOperations: {},
      faceOperations: {},
      featureLimits: {},
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
