import type {
  HealthResult,
  KernelStatusEvent,
  ShapeStats,
  TessellationResult,
} from '@icancad/kernel';
import type { SketchFrame, Vec3 } from '@icancad/model';
import { create } from 'zustand';
import type { MeshStats } from '@icancad/io';
import type { Feature } from '@icancad/model';
import type { KernelTask } from '../kernel/scheduler';

export type KernelStatus = 'idle' | 'loading' | 'ready' | 'error';

export function isModelRebuilding(state: { status: KernelStatus; tasks: KernelTask[] }): boolean {
  return state.status !== 'ready' || state.tasks.some((task) => task.key === 'rebuild');
}

/** Sum of the last measured operation times, ignoring suppressed operations. */
export function timelineDuration(
  features: readonly Feature[],
  operationMs: Readonly<Record<string, number>>,
): number {
  return features.reduce(
    (total, feature) => (feature.suppressed ? total : total + (operationMs[feature.id] ?? 0)),
    0,
  );
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
  /** Shape the body had before the operation, which `baseMesh` came from. */
  baseShapeId?: string;
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
  /**
   * The mark only says which mesh to pick against; the body keeps its style and
   * the tree does not report it as changed.
   */
  silent?: boolean;
  /** The tree gets an added row, but the viewport draws the delta as a ghost. */
  ghostOnly?: boolean;
}

/** A translucent volume that only exists in the preview, such as a cut tool. */
export interface SceneGhost {
  id: string;
  mesh: TessellationResult;
  color: string;
  /** Opacity of the delta volume; the operation ghosts keep the default. */
  opacity?: number;
  /**
   * Placement of the volume, as a row-major 3x4 affine (`a11 a12 a13 a14 a21 …
   * a34`). An array draws one repeated volume many times, so the tessellation is
   * shared and only its placement changes.
   */
  matrix?: number[];
  /**
   * Soft edges of the ghost: beyond the given plane the opacity fades out over
   * roughly 100 screen pixels, so a through cut does not end abruptly.
   */
  fade?: { axis: [number, number, number]; start: number }[];
}

/** New faces of an edge treatment, split by what they do to the material. */
export interface PreviewFaceMark {
  bodyId: string;
  /** Faces of the removed material. */
  red: number[];
  /** Faces of the added material. */
  green: number[];
}

/** Live preview of the operation that is being edited. */
export interface ScenePreview {
  featureId: string;
  bodies: PreviewBodyMark[];
  ghosts: SceneGhost[];
  /** Faces the operation creates, coloured while it is being edited. */
  faceMarks?: PreviewFaceMark[];
  /**
   * Centre of the volume an array repeats. Its handles start there: the step
   * arrow grows along the repeat direction, the count grip moves by one step.
   */
  arraySeed?: { featureId: string; origin: Vec3 };
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
  /** Projected sketch entities whose source is gone, keyed by sketch feature. */
  projectionLost: Record<string, string[]>;
  /** Increments whenever a rebuild publishes a scene. */
  sceneVersion: number;
  /** Wall-clock time of each operation, keyed by feature id. */
  operationMs: Record<string, number>;
  shapeStats: Record<string, ShapeStats>;
  meshStats: Record<string, MeshStats>;
  /**
   * Kernel shape each body is drawn from. The viewport picks against a mesh, so
   * anything it needs measured exactly — the middle of a face, say — has to be
   * asked of the shape the mesh came from.
   */
  bodyShapes: Record<string, string>;
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
  /**
   * A partial model is on screen because an operation is taking long. The
   * viewport draws the busy wave while this is true, and it stays on until the
   * whole rebuild ends once any operation crossed the threshold.
   */
  longOperation: boolean;
  /** Bumped every time a partial state replaces the model on screen. */
  interimSceneVersion: number;
  handleStatus: (event: KernelStatusEvent) => void;
  setReady: (health: HealthResult) => void;
  setError: (message: string) => void;
  setTasks: (tasks: KernelTask[]) => void;
  setRebuildCursor: (rebuildCursor: number | null) => void;
  setOperationMs: (featureId: string, ms: number) => void;
  setLongOperation: (longOperation: boolean) => void;
  /** Marks a partial scene as the current face of a long rebuild. */
  markInterimScene: () => void;
  setScene: (
    meshes: Record<string, TessellationResult>,
    shapeStats: Record<string, ShapeStats>,
    meshStats: Record<string, MeshStats>,
    bodyShapes: Record<string, string>,
    featureErrors: Record<string, string>,
    featureBodyErrors: Record<string, Record<string, string>>,
    featureObjectErrors: Record<string, Record<string, string>>,
    sketchFrames: Record<string, SketchFrame>,
    projectionLost: Record<string, string[]>,
    preview: ScenePreview | null,
  ) => void;
  /**
   * Replaces the drawn copies of the operation being edited, without a rebuild.
   * An array's copies are one measured volume placed many times, so a drag only
   * changes where they sit.
   */
  setPreviewGhosts: (featureId: string, ghosts: SceneGhost[]) => void;
  /**
   * Drops the draft of the operation being edited. A rebuild that could not
   * finish leaves the scene at its last good state, and the draft would then be
   * drawn over a model it no longer belongs to.
   */
  clearPreview: () => void;
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
  projectionLost: {},
  sceneVersion: 0,
  operationMs: {},
  shapeStats: {},
  meshStats: {},
  bodyShapes: {},
  featureErrors: {},
  featureBodyErrors: {},
  featureObjectErrors: {},
  preview: null,
  bodyOperations: {},
  faceOperations: {},
  featureLimits: {},
  tasks: [],
  rebuildCursor: null,
  longOperation: false,
  interimSceneVersion: 0,

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
  setOperationMs: (featureId, ms) =>
    set((state) => ({ operationMs: { ...state.operationMs, [featureId]: ms } })),
  setLongOperation: (longOperation) => set({ longOperation }),
  markInterimScene: () =>
    set((state) => ({
      longOperation: true,
      interimSceneVersion: state.interimSceneVersion + 1,
    })),

  setScene: (
    meshes,
    shapeStats,
    meshStats,
    bodyShapes,
    featureErrors,
    featureBodyErrors,
    featureObjectErrors,
    sketchFrames,
    projectionLost,
    preview,
  ) =>
    set((state) => ({
      meshes,
      sketchFrames,
      projectionLost,
      sceneVersion: state.sceneVersion + 1,
      shapeStats,
      meshStats,
      bodyShapes,
      featureErrors,
      featureBodyErrors,
      featureObjectErrors,
      preview,
    })),

  setBodyOperations: (bodyOperations) => set({ bodyOperations }),

  setPreviewGhosts: (featureId, ghosts) =>
    set((state) =>
      state.preview && state.preview.featureId === featureId
        ? { preview: { ...state.preview, ghosts } }
        : state,
    ),

  clearPreview: () => set((state) => (state.preview ? { preview: null } : state)),

  setFaceOperations: (faceOperations) => set({ faceOperations }),

  setFeatureLimits: (featureLimits) => set({ featureLimits }),

  clearScene: () =>
    set((state) => ({
      meshes: {},
      sketchFrames: {},
      projectionLost: {},
      sceneVersion: state.sceneVersion + 1,
      operationMs: {},
      shapeStats: {},
      meshStats: {},
      bodyShapes: {},
      featureErrors: {},
      featureBodyErrors: {},
      featureObjectErrors: {},
      preview: null,
      bodyOperations: {},
      faceOperations: {},
      featureLimits: {},
      rebuildCursor: null,
      longOperation: false,
    })),
  clearFeatureError: (featureId) =>
    set((state) => {
      if (!state.featureErrors[featureId]) return state;
      const featureErrors = { ...state.featureErrors };
      delete featureErrors[featureId];
      return { featureErrors };
    }),
}));
