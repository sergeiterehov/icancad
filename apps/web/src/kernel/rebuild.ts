import type {
  EdgeTreatmentResult,
  MakeBoxResult,
  ShapeStats,
  ShellResult,
  SplitSolid,
  SplitSolidsResult,
  TessellationResult,
} from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { sketchProfiles, type ProfileRegion } from '@icancad/sketch';
import {
  HISTORY_START,
  BODY_COLORS,
  defaultRevolve,
  extrudeBodyId,
  arrayBodyId,
  featureBodyId,
  isMeshObject,
  shellBodyId,
  type ArrayDirection,
  type ArrayFeature,
  type BooleanFeature,
  type Resolved,
  type BodyFaceRef,
  type EdgeTreatmentFeature,
  type ExtrudeFeature,
  type ImportMeshFeature,
  type ResolvedFeature,
  type ResolvedModel,
  type RevolveSpec,
  type ShellFeature,
  type SketchEntity,
  type SketchFeature,
  type SketchFrame,
  type TransformFeature,
} from '@icancad/model';
import { computeSketchFrame, faceSketchValid } from '../sketch/sectionPlane';
import { resolveRevolveAxis, revolveAngles } from '../sketch/revolveAxis';
import { projectionEntityIds, resolveSketchProjections } from '../sketch/projection';
import { projectionMoved, solveReprojectedSketch } from '../sketch/reproject';
import { solveSketch } from '../sketch/client';
import { constraintsSatisfied } from '../sketch/constraintModel';
import type { MeshFormat, MeshStats, ParsedMesh } from '@icancad/io';
import { loadAsset } from '../persistence/db';
import { nextBodyNumber, useDocumentStore } from '../stores/documentStore';
import { resolvedModel } from '../stores/formulaStore';
import { useUiStore } from '../stores/uiStore';
import {
  useKernelStore,
  type PreviewBodyMark,
  type PreviewFaceMark,
  type SceneGhost,
  type ScenePreview,
} from '../stores/kernelStore';
import { parseMeshInWorker } from '../io/client';
import { i18n } from '../i18n';
import { primitiveKernelParams } from '../primitive/params';
import { primitivePreview } from '../primitive/preview';
import { getKernelClient, retryKernel } from './client';
import { importStepToKernel, loadImportedStep } from './import';
import { importedMeshScale, scaledMeshStats } from './importUnits';
import { faceRegion, pointInMesh } from '../quick/geometry';
import { resolveShellFaceRef } from '../quick/shell';
import { resolveEdgeRef } from './topologyLookup';
import { edgeTreatmentLimit } from './edgeTreatment';
import { resolveFaceRef } from './topologyLookup';
import {
  pickReferenceBody,
  profileSamples,
  signedToBodyOffset,
  toBodyPlan,
  traceProfile,
  type ToBodyPlan,
} from './extrudeToBody';
import { KernelTaskCancelledError, kernelTaskQueue } from './scheduler';
import { addEmbedFor, UNION_EMBED } from './embed';
import { splitAssignment, splitBodyId } from './splitBodies';
import { RebuildCache, type RebuildCheckpoint } from './checkpoints';
import { arrayPositionCount, IDENTITY_MATRIX, type Matrix3x4 } from './array';
import {
  meshBounds,
  sketchBounds,
  transformMatrix,
  transformPivot,
  transformRotation,
  transformSketchGeometry,
  type TargetBounds,
} from './transformPlacement';
import {
  arrayDirections,
  arrayPlacementMatrices as arrayPlacements,
  clampArrayCount,
  directionMatrices,
  type ArrayPlacementContext,
} from './arrayPlacement';

let rebuildEpoch = 0;
const importedMeshCache = new Map<string, Promise<ParsedMesh>>();

/** Kernel shapes this pipeline created; shapes nobody references are disposed. */
const liveShapes = new Set<string>();

/** Smallest size worth building; below it the treatment is invisible. */
const MIN_TREATMENT_SIZE = 0.01;
/** An operation that runs longer than this shows the state it is building on. */
const LONG_OPERATION_MS = 2000;
/**
 * How long a preview may compute before the scene in front of it is published
 * for interaction. A quick preview keeps its last picture instead of blinking
 * through the input state.
 */
const PREVIEW_BASE_DELAY_MS = 120;
/**
 * How close to the profile plane a tool still counts as touching it. A tool
 * always starts on the plane; tessellation moves its vertices by rounding only.
 */
const PLANE_TOLERANCE = 1e-3;

/**
 * The mesh estimate is the exact geometric ceiling, which is also the size the
 * kernel rejects. A hair below it keeps the preview on the first try.
 */
const ESTIMATE_MARGIN = 0.999;

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

function transformImportedMesh(
  mesh: ParsedMesh,
  feature: Resolved<ImportMeshFeature>,
): { mesh: TessellationResult; stats: MeshStats } {
  const scale = importedMeshScale(feature);
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

  const bounds: MeshStats['bounds'] =
    mesh.positions.length > 0
      ? { min, max }
      : { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    mesh: {
      positions,
      normals,
      indices: mesh.indices,
      faceIds: new Uint32Array(positions.length / 3),
      triangleCount: mesh.stats.triangleCount,
      vertexCount: positions.length / 3,
      bbox: bounds,
      // Imported meshes are not B-reps, so they have no selectable edges.
      edges: [],
    },
    stats: scaledMeshStats(mesh.stats, scale, bounds),
  };
}

/**
 * Everything an operation inherits from the ones before it. Snapshots of this
 * state are what makes moving the timeline cursor instant.
 */
interface RebuildState {
  bodyShapes: Map<string, string>;
  bodyOwner: Map<string, string>;
  /** Operation whose evaluation last produced each body's shape. */
  bodySource: Map<string, string>;
  /** Which operation created each face of a body, in shape order. */
  faceOwners: Map<string, string[]>;
  /** Tessellated triangles of each body, keyed by body id. */
  meshes: Record<string, TessellationResult>;
  /** Face/edge/solid counts of each body shape, keyed by body id. */
  bodyStats: Record<string, ShapeStats>;
  meshStats: Record<string, MeshStats>;
  /** Bodies each creating operation owns, keyed by operation id. */
  createdBodies: Map<string, string[]>;
  /** Bodies an operation consumed; the document drops their refs afterwards. */
  consumedBodies: Set<string>;
  /** Sketch id -> frame frozen when that operation was evaluated. */
  sketchFrames: Record<string, SketchFrame>;
  sketches: Map<string, Resolved<SketchFeature>>;
  /**
   * Sketches an operation moved: their geometry as it is from that point on.
   * The frame lives in `sketchFrames`; this is what the 3D view draws.
   */
  sketchOverrides: Map<string, SketchEntity[]>;
  /** Pivot a transform measured, so its handles start where the operation does. */
  transformPivots: Map<string, { origin: Vec3; radius: number }>;
  /** Tools a modifying extrude applied, keyed by operation id, for arrays. */
  featureTools: Map<string, ArrayToolSource>;
  /** Bodies each operation changed in place: the shape before and after it. */
  featureChanges: Map<string, Map<string, { before: string; after: string }>>;
  /** Shape each body had when its creating operation made it. */
  featureCreatedShapes: Map<string, Map<string, string>>;
  /** Sketch entity ids whose projection source is gone, per sketch. */
  projectionLost: Record<string, string[]>;
  featureErrors: Record<string, string>;
  featureBodyErrors: Record<string, Record<string, string>>;
  featureObjectErrors: Record<string, Record<string, string>>;
  /** Size the kernel applied to each edge treatment, keyed by operation. */
  featureLimits: Record<string, { requested: number; applied: number }>;
  /** New faces of each edge treatment, split into removed and added material. */
  featureFaceMarks: Record<string, PreviewFaceMark[]>;
  /** The first failed operation: nothing after it is built. */
  blockedFeatureId: string | null;
}

/**
 * What an extrude applied to the model, kept so an array can repeat the
 * operation itself (ADR 0029): its tool solids, the bodies it changed and how.
 */
interface ArrayToolSource {
  parts: string[];
  op: 'add' | 'subtract' | 'intersect';
  targets: string[];
  /** An add may skip a part that would become a separate solid. */
  disjointCheck: boolean;
}

/** One picked operation, in the form the array replays it. */
interface ArrayFeatureSource {
  featureId: string;
  /** Bodies the operation made, with the shape they had right after it. */
  created: Array<{ bodyId: string; shapeId: string }>;
  /** The tool of an extrude that changed existing bodies. */
  tool?: ArrayToolSource;
  /** In-place changes of existing bodies: the shape before and after. */
  changes?: Map<string, { before: string; after: string }>;
  /** Position in the history; replay follows it. */
  order: number;
}

/** A volume drawn for one placement of a repetition. */
interface GhostCopy {
  /** Stable name: which stamp it is and where it is placed. */
  id?: string;
  mesh: TessellationResult;
  matrix?: Matrix3x4;
}

/** The shape a cut subtracts, shown as a translucent ghost while editing. */
interface GhostCollector {
  mesh?: TessellationResult;
  fade?: { axis: [number, number, number]; start: number }[];
  /** Material an add brings, one volume per body it touches. */
  additions?: TessellationResult[];
  /** Material an array adds, drawn once per copy. */
  added?: GhostCopy[];
  /** Material an array removes, drawn once per copy. */
  removed?: GhostCopy[];
  /** Centre of the volume the array repeats, where its handles start. */
  arrayOrigin?: Vec3;
}

interface EvalContext {
  client: ReturnType<typeof getKernelClient>;
  epoch: number;
  project: ResolvedModel;
  /** Sketches whose constraint values come from formulas. */
  drivenSketches?: ReadonlySet<string>;
  ghost?: GhostCollector;
}

// Snapshots belong to one model: switching models must not throw away the
// history the other model already calculated.
const rebuildCaches = new Map<string, RebuildCache<RebuildState>>();

function rebuildCacheFor(modelId: string): RebuildCache<RebuildState> {
  let cache = rebuildCaches.get(modelId);
  if (!cache) {
    cache = new RebuildCache<RebuildState>();
    rebuildCaches.set(modelId, cache);
  }
  return cache;
}

// Tessellations are rebuilt whenever an operation is evaluated, so identity
// alone cannot tell whether a body actually changed. The signature is cached
// per tessellation to keep previews cheap.
const meshSignatures = new WeakMap<TessellationResult, string>();

function meshSignature(mesh: TessellationResult): string {
  const cached = meshSignatures.get(mesh);
  if (cached !== undefined) return cached;
  let hash = 2166136261;
  for (let index = 0; index < mesh.positions.length; index += 1) {
    hash ^= Math.round(mesh.positions[index]! * 1e4) | 0;
    hash = Math.imul(hash, 16777619);
  }
  const signature = `${mesh.triangleCount}:${hash}`;
  meshSignatures.set(mesh, signature);
  return signature;
}

function emptyState(): RebuildState {
  return {
    bodyShapes: new Map(),
    bodyOwner: new Map(),
    bodySource: new Map(),
    faceOwners: new Map(),
    meshes: {},
    bodyStats: {},
    meshStats: {},
    createdBodies: new Map(),
    consumedBodies: new Set(),
    sketchFrames: {},
    sketches: new Map(),
    sketchOverrides: new Map(),
    transformPivots: new Map(),
    featureTools: new Map(),
    featureChanges: new Map(),
    featureCreatedShapes: new Map(),
    projectionLost: {},
    featureErrors: {},
    featureBodyErrors: {},
    featureObjectErrors: {},
    featureLimits: {},
    featureFaceMarks: {},
    blockedFeatureId: null,
  };
}

function cloneErrors(
  errors: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const clone: Record<string, Record<string, string>> = {};
  for (const [key, value] of Object.entries(errors)) clone[key] = { ...value };
  return clone;
}

function cloneLists(lists: Record<string, string[]>): Record<string, string[]> {
  const clone: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(lists)) clone[key] = [...value];
  return clone;
}

function cloneState(state: RebuildState): RebuildState {
  return {
    bodyShapes: new Map(state.bodyShapes),
    bodyOwner: new Map(state.bodyOwner),
    bodySource: new Map(state.bodySource),
    faceOwners: new Map(state.faceOwners),
    // Tessellations and statistics are immutable values shared between
    // snapshots; only the containers are copied.
    meshes: { ...state.meshes },
    bodyStats: { ...state.bodyStats },
    meshStats: { ...state.meshStats },
    createdBodies: new Map(
      [...state.createdBodies].map(([featureId, bodyIds]) => [featureId, [...bodyIds]]),
    ),
    consumedBodies: new Set(state.consumedBodies),
    sketchFrames: { ...state.sketchFrames },
    sketches: new Map(state.sketches),
    sketchOverrides: new Map(state.sketchOverrides),
    transformPivots: new Map(state.transformPivots),
    featureTools: new Map(
      [...state.featureTools].map(([featureId, tool]) => [
        featureId,
        { ...tool, parts: [...tool.parts], targets: [...tool.targets] },
      ]),
    ),
    featureChanges: new Map(
      [...state.featureChanges].map(([featureId, changes]) => [
        featureId,
        new Map([...changes].map(([bodyId, change]) => [bodyId, { ...change }])),
      ]),
    ),
    featureCreatedShapes: new Map(
      [...state.featureCreatedShapes].map(([featureId, shapes]) => [featureId, new Map(shapes)]),
    ),
    projectionLost: cloneLists(state.projectionLost),
    featureErrors: { ...state.featureErrors },
    featureBodyErrors: cloneErrors(state.featureBodyErrors),
    featureObjectErrors: cloneErrors(state.featureObjectErrors),
    featureLimits: { ...state.featureLimits },
    featureFaceMarks: { ...state.featureFaceMarks },
    blockedFeatureId: state.blockedFeatureId,
  };
}

function trackShape(shapeId: string): string {
  liveShapes.add(shapeId);
  return shapeId;
}

/**
 * Remembers what one operation changed: the bodies it made exist only after
 * it, and every body whose shape it replaced points at both shapes. An array
 * repeats that change without knowing which operation made it (ADR 0029).
 */
function captureFeatureShapes(
  state: RebuildState,
  featureId: string,
  beforeShapes: Map<string, string>,
): void {
  let changes: Map<string, { before: string; after: string }> | undefined;
  for (const [bodyId, before] of beforeShapes) {
    const after = state.bodyShapes.get(bodyId);
    if (!after || after === before) continue;
    (changes ??= new Map()).set(bodyId, { before, after });
  }
  if (changes) state.featureChanges.set(featureId, changes);

  const created = state.createdBodies.get(featureId);
  if (!created || created.length === 0) return;
  const shapes = new Map<string, string>();
  for (const bodyId of created) {
    const shapeId = state.bodyShapes.get(bodyId);
    if (shapeId) shapes.set(bodyId, shapeId);
  }
  if (shapes.size > 0) state.featureCreatedShapes.set(featureId, shapes);
}

/** Drops every snapshot. The worker was restarted, so its shapes are gone too. */
export function resetRebuildCache(): void {
  rebuildCaches.clear();
  arrayStampCache.clear();
  liveShapes.clear();
}

export function abortRebuild(): void {
  rebuildEpoch += 1;
  const kernel = useKernelStore.getState();
  kernel.setRebuildCursor(null);
  kernel.setLongOperation(false);
  kernel.setBuildProgress(null);
}

/**
 * Ends the working rebuild at its next check. The worker answers one request at
 * a time, so this cannot start the newer build sooner; it only stops the old one
 * from doing work nobody will see.
 */
function supersedeRebuild(): void {
  rebuildEpoch += 1;
  // The scene may be the input of the operation that was just replaced; keep
  // it out of reach until the newer build publishes its own.
  useKernelStore.getState().setInteractiveReady(false);
}

export function rebuildScene(
  project: ResolvedModel,
  label: string,
  options?: {
    fromIndex?: number;
    expressionErrors?: ReadonlySet<string>;
    drivenSketches?: ReadonlySet<string>;
  },
): Promise<void> {
  if (useKernelStore.getState().status !== 'ready') return Promise.resolve();
  // Read at enqueue time so the preview matches the project being rebuilt.
  const previewFeatureId = useDocumentStore.getState().editingFeatureId;
  const fromIndex = options?.fromIndex;
  return kernelTaskQueue.enqueue({
    key: 'rebuild',
    label,
    supersede: supersedeRebuild,
    run: async () => {
      try {
        await runRebuild(
          project,
          previewFeatureId,
          fromIndex,
          false,
          options?.expressionErrors,
          options?.drivenSketches,
        );
        rebuildFailures = 0;
      } catch (error) {
        handleRebuildFailure(error);
        throw error;
      }
    },
  });
}

/**
 * How many rebuilds in a row could not finish. One failure is enough to restart
 * the kernel, a second one is reported instead of restarting it in a loop.
 */
let rebuildFailures = 0;

/**
 * A rebuild that throws leaves the scene published by the previous one, so the
 * draft of the operation being edited has to go: it would be drawn on top of a
 * model it no longer belongs to (a ghost cube over the cube itself). The worker
 * is restarted once, because a build that fails outside a single operation is
 * usually a kernel state that cannot recover on its own.
 */
function handleRebuildFailure(error: unknown): void {
  const kernel = useKernelStore.getState();
  kernel.clearPreview();
  kernel.setLongOperation(false);
  kernel.setBuildProgress(null);
  kernel.setInteractiveReady(true);
  if (error instanceof KernelTaskCancelledError) return;
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? error.name : '';
  // Only kernel answers are worth a restart: an exception of our own would fail
  // the same way after it.
  if (!/^[A-Z][A-Z_]+$/.test(code)) return;
  rebuildFailures += 1;
  if (rebuildFailures === 1) {
    void retryKernel();
    return;
  }
  useKernelStore.getState().setError(message);
}

/**
 * Forces the model to be recalculated from the given operation on, ignoring the
 * cached states captured after it.
 */
export function rebuildFrom(featureId: string): void {
  const project = resolvedModel();
  if (!project) return;
  const index = project.features.findIndex((feature) => feature.id === featureId);
  if (index < 0) return;
  rebuildCacheFor(project.id).invalidateFrom(index);
  // A rebuild that is already running may store snapshots we just dropped, so
  // the start point is passed explicitly instead of relying on the cache.
  void rebuildScene(project, i18n.t('status.rebuild'), { fromIndex: index }).catch(() => undefined);
}

/**
 * Puts a partially built model on screen while a long operation runs. It is a
 * normal scene, only with the busy flag on: the viewport draws it and sweeps the
 * wave over its bodies. A state without any body has nothing to show, so the
 * skeleton keeps its place instead.
 */
function publishInterimState(state: RebuildState): boolean {
  if (Object.keys(state.meshes).length === 0) return false;
  const kernel = useKernelStore.getState();
  kernel.setScene(
    state.meshes,
    aggregateStats(state),
    state.meshStats,
    Object.fromEntries(state.bodyShapes),
    state.featureErrors,
    state.featureBodyErrors,
    state.featureObjectErrors,
    state.sketchFrames,
    state.projectionLost,
    null,
    state.consumedBodies,
  );
  kernel.setSketchOverrides(Object.fromEntries(state.sketchOverrides));
  kernel.markInterimScene();
  return true;
}

async function runRebuild(
  project: ResolvedModel,
  previewFeatureId: string | null,
  fromIndex?: number,
  recovered = false,
  expressionErrors?: ReadonlySet<string>,
  drivenSketches?: ReadonlySet<string>,
): Promise<void> {
  const epoch = ++rebuildEpoch;
  const client = getKernelClient();
  const features = project.features;

  // An edited operation is evaluated against its own input state, so the
  // rebuild stops in front of it no matter where the user's cursor sits.
  const previewIndex =
    previewFeatureId === null
      ? -1
      : features.findIndex((feature) => feature.id === previewFeatureId);
  const endIndex =
    previewIndex >= 0
      ? previewIndex - 1
      : project.historyEnd === null
        ? features.length - 1
        : project.historyEnd === HISTORY_START
          ? -1
          : features.findIndex((feature) => feature.id === project.historyEnd);

  // Reuse the newest snapshot whose history is still identical. Editing an
  // operation replaces its feature object, so every snapshot from it on is
  // discarded automatically.
  const reuseUntil = fromIndex === undefined ? endIndex : Math.min(endIndex, fromIndex - 1);
  const rebuildCache = rebuildCacheFor(project.id);
  const cached = rebuildCache.find(features, reuseUntil);
  const startIndex = cached ? cached.index + 1 : 0;
  const state = cached ? cloneState(cached.state) : emptyState();
  const produced: RebuildCheckpoint<RebuildState>[] = [];

  const progressTotal = endIndex + 1;
  const kernel = useKernelStore.getState();
  // Until the model in front of the edited operation is on screen there is
  // nothing to pick; the operation's own preview does not change that.
  kernel.setInteractiveReady(false);
  kernel.setBuildProgress(progressTotal > 0 ? { done: startIndex, total: progressTotal } : null);
  kernel.setRebuildCursor(startIndex);

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (epoch !== rebuildEpoch) return;
    const feature = features[index];
    if (!feature) break;
    // The dashed caret sits after the operation that is being computed.
    useKernelStore.getState().setRebuildCursor(index + 1);
    useKernelStore.getState().setBuildProgress({ done: index, total: progressTotal });
    if (expressionErrors?.has(feature.id)) {
      state.featureErrors[feature.id] = 'EXPRESSION_ERROR';
      state.blockedFeatureId = feature.id;
      break;
    }
    if (!feature.suppressed) {
      // The input shapes are what an array repeats a later modification from,
      // so they are read before the operation replaces them.
      const beforeShapes = new Map(state.bodyShapes);
      // A long operation shows the model it is building on; when it finishes,
      // the same swap shows its result so the step is visibly done.
      const snapshot = cloneState(state);
      let long = false;
      const timer = setTimeout(() => {
        if (epoch !== rebuildEpoch) return;
        long = true;
        publishInterimState(snapshot);
      }, LONG_OPERATION_MS);
      const startedAt = performance.now();
      try {
        await evaluateFeature(feature, state, { client, epoch, project, drivenSketches });
      } finally {
        clearTimeout(timer);
        const took = performance.now() - startedAt;
        // The timer may lose the race with a kernel answer that arrives just
        // after two seconds; the operation was long either way.
        if (took >= LONG_OPERATION_MS) long = true;
        useKernelStore.getState().setOperationMs(feature.id, took);
      }
      if (epoch !== rebuildEpoch) return;
      if (!state.featureErrors[feature.id]) {
        captureFeatureShapes(state, feature.id, beforeShapes);
      }
      // A failed step leaves the state before it on screen; only a step that
      // produced a model earns the second swap.
      if (long && !state.featureErrors[feature.id]) publishInterimState(state);
      if (state.blockedFeatureId) break;
    }
    produced.push({ index, prefix: features.slice(0, index + 1), state: cloneState(state) });
    useKernelStore.getState().setBuildProgress({ done: index + 1, total: progressTotal });
  }

  if (epoch !== rebuildEpoch) return;

  // The operation being edited is evaluated on top of the cursor state so the
  // user sees its result, while every later operation stays rolled back.
  const base = state;
  const previewFeature = previewIndex >= 0 ? features[previewIndex] : undefined;
  // A stamp only describes the array that is being edited: any other evaluation
  // means the history under it may have moved, so it is measured again.
  keepArrayStamp(previewFeature?.type === 'array' ? previewFeature.id : null);
  let published = base;
  let preview: ScenePreview | null = null;

  /**
   * The model before the edited operation, published as soon as it is built.
   * Its geometry is what a picker targets, so the user never waits for the
   * operation's own deltas; the preview replaces this scene when it is ready.
   */
  const publishBaseScene = () => {
    // A build the user has already left must not make its stale scene
    // interactive under the newer one.
    if (epoch !== rebuildEpoch) return;
    const store = useKernelStore.getState();
    store.setScene(
      base.meshes,
      aggregateStats(base),
      base.meshStats,
      Object.fromEntries(base.bodyShapes),
      base.featureErrors,
      base.featureBodyErrors,
      base.featureObjectErrors,
      base.sketchFrames,
      base.projectionLost,
      null,
      base.consumedBodies,
    );
    store.setBodyOperations(Object.fromEntries(base.bodySource));
    store.setFaceOperations(faceOperationsOf(base));
    store.setSketchOverrides(Object.fromEntries(base.sketchOverrides));
    store.setFeatureLimits(base.featureLimits);
    store.setInteractiveReady(true);
  };

  if (
    previewFeature &&
    previewIndex === endIndex + 1 &&
    !base.blockedFeatureId &&
    !expressionErrors?.has(previewFeature.id)
  ) {
    if (previewFeature.type === 'primitive') {
      // A primitive in edit mode is a delta: a cheap overlay mesh instead of a
      // kernel body, so it ignores sections and stays above the model.
      if (!previewFeature.suppressed) preview = primitivePreview(previewFeature, project);
    } else {
      const ghost: GhostCollector = {};
      // Opening the settings of an operation that was already evaluated just
      // reuses its snapshot: only real edits force a recalculation. A cut has to
      // be evaluated again because its tool volume is only tessellated for the
      // preview.
      // A cut shows the removed volume; an add shows the material it will add.
      // Both need the tool solid only the preview tessellates. An array draws
      // one ghost per copy, and a boolean builds its delta from the result, so
      // both are always evaluated again for the preview: a cached snapshot has
      // no ghost in it, and entering the operation has to show the delta before
      // the user touches a parameter.
      const needsGhost =
        (previewFeature.type === 'array' && !previewFeature.suppressed) ||
        (previewFeature.type === 'boolean' && !previewFeature.suppressed) ||
        (previewFeature.type === 'extrude' &&
          (previewFeature.op === 'subtract' || previewFeature.op === 'add'));
      const cachedPreview = needsGhost ? null : rebuildCache.find(features, previewIndex);
      if (cachedPreview && cachedPreview.index === previewIndex) {
        published = cachedPreview.state;
        preview = buildPreview(previewFeature, base, published, ghost, project);
      } else {
        const next = cloneState(base);
        if (!previewFeature.suppressed) {
          // The pre-operation scene goes on screen if the preview takes long
          // enough to notice, so picking its geometry never waits for this
          // operation while a quick preview keeps the last picture.
          const baseTimer = setTimeout(publishBaseScene, PREVIEW_BASE_DELAY_MS);
          const beforeShapes = new Map(next.bodyShapes);
          const startedAt = performance.now();
          try {
            await evaluateFeature(previewFeature, next, { client, epoch, project, ghost });
          } finally {
            clearTimeout(baseTimer);
            useKernelStore
              .getState()
              .setOperationMs(previewFeature.id, performance.now() - startedAt);
          }
          if (epoch !== rebuildEpoch) return;
          if (!next.featureErrors[previewFeature.id]) {
            captureFeatureShapes(next, previewFeature.id, beforeShapes);
          }
          // An array's preview only draws copies of the repeated volume, it does
          // not build them, and an add's preview only draws the material it
          // brings: both states are the one in front of the operation, so they
          // must not be stored as the state after it.
          const previewOnly =
            previewFeature.type === 'array' ||
            (previewFeature.type === 'extrude' && previewFeature.op === 'add');
          if (!next.blockedFeatureId && !previewOnly) {
            produced.push({
              index: previewIndex,
              prefix: features.slice(0, previewIndex + 1),
              state: cloneState(next),
            });
          }
        }
        published = next;
        preview = buildPreview(previewFeature, base, next, ghost, project);
      }
    }
  }

  if (epoch !== rebuildEpoch) return;
  useKernelStore.getState().setRebuildCursor(null);

  // A snapshot can name a shape the kernel no longer has, after a crash or a
  // disposal it did not expect. Starting over without any snapshot rebuilds
  // everything in one clean pass; doing it once is enough, and a real failure
  // of the model comes back the second time.
  if (!recovered && cached && Object.values(state.featureErrors).includes('SHAPE_NOT_FOUND')) {
    rebuildCacheFor(project.id).clear();
    arrayStampCache.clear();
    return runRebuild(project, previewFeatureId, 0, true);
  }

  // Removed objects stay on screen while the deletion is previewed.
  const scene = preview ? withRemovedBodies(published, base) : published;
  const shapeStats = aggregateStats(scene);

  useKernelStore.getState().setScene(
    scene.meshes,
    shapeStats,
    scene.meshStats,
    Object.fromEntries(scene.bodyShapes),
    scene.featureErrors,
    scene.featureBodyErrors,
    scene.featureObjectErrors,
    scene.sketchFrames,
    scene.projectionLost,
    preview,
    // The edited operation's own consumption must not hide its inputs while
    // they are being configured; the base state is the model in front of it.
    base.consumedBodies,
  );
  // Which operation produced each body's current shape, so a face can lead back
  // to the operation that made it.
  const done = useKernelStore.getState();
  done.setBodyOperations(Object.fromEntries(scene.bodySource));
  done.setFaceOperations(faceOperationsOf(scene));
  done.setSketchOverrides(Object.fromEntries(scene.sketchOverrides));
  done.setFeatureLimits(scene.featureLimits);
  done.setBuildProgress(null);
  done.setInteractiveReady(true);

  for (const checkpoint of produced) rebuildCache.store(checkpoint);
  useDocumentStore.getState().syncCreatedBodies(base.createdBodies, base.blockedFeatureId);
  // The interim bodies stay on screen until the document owns them, so the
  // finished scene never blinks from a synthetic body to the real one.
  useKernelStore.getState().setLongOperation(false);

  disposeUnusedShapes(client);
}

function withRemovedBodies(state: RebuildState, base: RebuildState): RebuildState {
  const merged = cloneState(state);
  for (const bodyId of Object.keys(base.meshes)) {
    if (!merged.meshes[bodyId]) merged.meshes[bodyId] = base.meshes[bodyId]!;
  }
  for (const [bodyId, stats] of Object.entries(base.bodyStats)) {
    if (!merged.bodyStats[bodyId]) merged.bodyStats[bodyId] = stats;
  }
  return merged;
}

/** Which operation owns each face, read from the names the kernel gave it. */
function faceOperationsOf(state: RebuildState): Record<string, string[]> {
  const owners: Record<string, string[]> = {};
  for (const [bodyId, mesh] of Object.entries(state.meshes)) {
    owners[bodyId] = mesh.faceOwners ?? state.faceOwners.get(bodyId) ?? [];
  }
  return owners;
}

function aggregateStats(state: RebuildState): Record<string, ShapeStats> {
  const stats: Record<string, ShapeStats> = { ...state.bodyStats };
  for (const [bodyId, ownerId] of state.bodyOwner) {
    const body = state.bodyStats[bodyId];
    if (!body) continue;
    const total = stats[ownerId] ?? { faces: 0, edges: 0, solids: 0 };
    stats[ownerId] = {
      faces: total.faces + body.faces,
      edges: total.edges + body.edges,
      solids: total.solids + body.solids,
    };
  }
  return stats;
}

function buildPreview(
  feature: ResolvedFeature,
  base: RebuildState,
  after: RebuildState,
  ghost: GhostCollector,
  project: ResolvedModel,
): ScenePreview {
  const bodies: PreviewBodyMark[] = [];
  let nextNumber = nextBodyNumber(project);
  let colorIndex = project.bodies.filter((body) => !isMeshObject(body)).length;
  const describe = (bodyId: string): { name: string; color: string } => {
    const metadata = project.metadata[bodyId];
    return {
      name: metadata?.name ?? `${i18n.t('inspector.body')} ${nextNumber++}`,
      color: metadata?.color ?? BODY_COLORS[colorIndex++ % BODY_COLORS.length] ?? '#6ea8fe',
    };
  };

  // The body a boolean produce is real material, so it stays opaque. What the
  // operation changes is the ghost drawn on top of it: removed material for a
  // cut, added material for a join.
  // An array keeps its bodies solid and shows the material it repeats as a
  // ghost per copy, so the seeds stay in their own style.
  const keepsBodySolid =
    feature.type === 'transform' ||
    feature.type === 'array' ||
    feature.type === 'boolean' ||
    (feature.type === 'extrude' &&
      (feature.op === 'subtract' || feature.op === 'add' || feature.op === 'intersect'));
  // A transform moves the bodies it owns: the moved shape is the real result,
  // so it is drawn solid and picked where it now stands instead of at the pose
  // it had before the operation.
  const movedByTransform = feature.type === 'transform';
  // Meshes cover solid bodies and imported meshes alike.
  for (const bodyId of Object.keys(after.meshes)) {
    const before = base.meshes[bodyId];
    const now = after.meshes[bodyId];
    if (!now) continue;
    if (!before) {
      // With Keep the source bodies stay and the operation only makes copies:
      // the delta is what the user configured, so the copies stay out of the
      // viewport (the tree still lists them). A union is drawn the same way:
      // the base body plus the green addition, not a fused body on top of it.
      const ghostOnly =
        feature.type === 'boolean' && (feature.keepBodies === true || feature.op === 'union');
      bodies.push({
        id: bodyId,
        kind: 'added',
        ...describe(bodyId),
        ...(ghostOnly ? { ghostOnly: true } : {}),
      });
      continue;
    }
    if (before === now) continue;
    // A boolean against a body the tool misses still produces a new shape;
    // only a changed tessellation counts as a modification.
    if (meshSignature(before) === meshSignature(now)) continue;
    // A union shows the target as it was and the green ghost adds to it; a cut
    // shows the result itself, so the hole reads as real geometry.
    const renderBase =
      feature.type === 'boolean' && feature.op === 'union' && feature.keepBodies !== true;
    bodies.push({
      id: bodyId,
      kind: 'modified',
      ...describe(bodyId),
      ...(renderBase ? { renderBase: true } : {}),
      ...(movedByTransform ? {} : { baseMesh: before }),
      // The mesh a pick lands on is the one before the operation, so its shape
      // is the one to measure when the operation has moved the body.
      ...(base.bodyShapes.get(bodyId) ? { baseShapeId: base.bodyShapes.get(bodyId)! } : {}),
      ...(keepsBodySolid ||
      feature.type === 'edge-treatment' ||
      (feature.type === 'shell' && feature.direction === 'inward')
        ? { translucent: false }
        : {}),
      // A treatment keeps its body as it is: the mark is only there so picking
      // still targets the input shape, and the colour matches the real result.
      ...(feature.type === 'edge-treatment' ? { silent: true } : {}),
    });
  }
  for (const bodyId of Object.keys(base.meshes)) {
    if (after.meshes[bodyId]) continue;
    const baseMesh = base.meshes[bodyId];
    bodies.push({
      id: bodyId,
      kind: 'removed',
      ...describe(bodyId),
      ...(baseMesh ? { baseMesh } : {}),
      ...(base.bodyShapes.get(bodyId) ? { baseShapeId: base.bodyShapes.get(bodyId)! } : {}),
      // A boolean shows what it adds or removes through its delta alone; the
      // whole consumed body would bury the model under a red wash. The tree
      // still lists it as removed.
      ...(feature.type === 'boolean' ? { hidden: true } : {}),
    });
  }

  const ghosts: SceneGhost[] = [];
  if (ghost.mesh) {
    const isAdd =
      (feature.type === 'extrude' && feature.op === 'add') ||
      (feature.type === 'boolean' && feature.op === 'union');
    ghosts.push({
      id: `ghost:${feature.id}`,
      mesh: ghost.mesh,
      color: isAdd ? '#22c55e' : '#ef4444',
      ...(ghost.fade ? { fade: ghost.fade } : {}),
      // The removed volume of an intersection shares the space with the red
      // phantoms of the bodies it consumes, so both become twice as faint.
      ...(feature.type === 'boolean' && feature.op === 'intersect' ? { opacity: 0.2 } : {}),
    });
  }
  for (const [index, mesh] of (ghost.additions ?? []).entries()) {
    ghosts.push({
      id: `ghost:${feature.id}:addition:${index}`,
      mesh,
      color: '#22c55e',
    });
  }
  for (const [index, copy] of (ghost.added ?? []).entries()) {
    ghosts.push({
      id: copy.id ?? `ghost:${feature.id}:added:${index}`,
      mesh: copy.mesh,
      color: ARRAY_ADDED_COLOR,
      ...(copy.matrix ? { matrix: [...copy.matrix] } : {}),
    });
  }
  for (const [index, copy] of (ghost.removed ?? []).entries()) {
    ghosts.push({
      id: copy.id ?? `ghost:${feature.id}:removed:${index}`,
      mesh: copy.mesh,
      color: ARRAY_REMOVED_COLOR,
      ...(copy.matrix ? { matrix: [...copy.matrix] } : {}),
    });
  }

  return {
    featureId: feature.id,
    bodies,
    ghosts,
    ...(ghost.arrayOrigin
      ? { arraySeed: { featureId: feature.id, origin: ghost.arrayOrigin } }
      : {}),
    ...(feature.type === 'transform' && after.transformPivots.has(feature.id)
      ? { transformPivot: { featureId: feature.id, ...after.transformPivots.get(feature.id)! } }
      : {}),
    ...(after.featureFaceMarks[feature.id]
      ? { faceMarks: after.featureFaceMarks[feature.id] }
      : {}),
  };
}

function disposeUnusedShapes(client: ReturnType<typeof getKernelClient>): void {
  // Caches of deleted models go away with their snapshots.
  const modelIds = new Set(
    useDocumentStore.getState().project.superObjects.map((superObject) => superObject.id),
  );
  for (const modelId of rebuildCaches.keys()) {
    if (!modelIds.has(modelId)) rebuildCaches.delete(modelId);
  }
  const keep = new Set<string>();
  // Cached snapshots must stay continuable: their body shapes remain alive.
  for (const cache of rebuildCaches.values()) {
    for (const checkpoint of cache.all()) {
      for (const shapeId of checkpoint.state.bodyShapes.values()) keep.add(shapeId);
      // An array re-applies the tools of an earlier extrude, so they have to
      // outlive the body snapshots that no longer name them.
      for (const tool of checkpoint.state.featureTools.values()) {
        for (const part of tool.parts) keep.add(part);
      }
      // An array compares a body with the shape it had before an operation, so
      // both sides of every recorded change stay alive as well.
      for (const changes of checkpoint.state.featureChanges.values()) {
        for (const change of changes.values()) {
          keep.add(change.before);
          keep.add(change.after);
        }
      }
      for (const shapes of checkpoint.state.featureCreatedShapes.values()) {
        for (const shapeId of shapes.values()) keep.add(shapeId);
      }
    }
  }
  for (const shapeId of [...liveShapes]) {
    if (keep.has(shapeId)) continue;
    liveShapes.delete(shapeId);
    void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
  }
}

async function evaluateFeature(
  feature: ResolvedFeature,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch } = context;

  if (feature.type === 'sketch') {
    if (feature.plane.type === 'face') {
      const bodyId = feature.plane.bodyId ?? '';
      if (!state.bodyShapes.has(bodyId) || !faceSketchValid(feature, state.meshes[bodyId])) {
        state.featureErrors[feature.id] = 'INVALID_SKETCH_PLANE';
        state.blockedFeatureId = feature.id;
        return;
      }
    }
    const frame = computeSketchFrame(
      feature,
      feature.plane.type === 'face' ? state.meshes[feature.plane.bodyId ?? ''] : undefined,
      // A name that is briefly gone — an operation being edited, a preview —
      // keeps the frame the last rebuild used instead of jumping to a pose.
      state.sketchFrames[feature.id],
    );
    state.sketchFrames[feature.id] = frame;
    // Projected geometry follows the bodies as they exist at this point of the
    // history; the stored entities remain the snapshot for a lost link.
    const resolved = resolveSketchProjections(feature, frame, (bodyId) => state.meshes[bodyId]);
    // A projection that moved drags the constrained geometry with it: the sketch
    // is solved again, projected curves held in place, so changing a projected
    // feature earlier in the history recomputes this sketch instead of leaving
    // its constraints broken.
    let entities = resolved.entities;
    if (projectionMoved(feature.entities, entities, new Set(projectionEntityIds(feature)))) {
      const solved = await solveReprojectedSketch(feature, entities);
      if (solved.conflict) state.featureErrors[feature.id] = 'CONSTRAINT_CONFLICT';
      else if (solved.entities) entities = solved.entities;
    }
    // A driven dimension is a number only after the formula resolves; the
    // stored entities are the snapshot from the last solve, so the sketch is
    // solved again with the resolved constraints.
    if (
      context.drivenSketches?.has(feature.id) &&
      feature.constraints.length > 0 &&
      !constraintsSatisfied(feature.constraints, entities)
    ) {
      const solved = await solveSketch(entities, feature.constraints, [], {
        derived: [...projectionEntityIds(feature)],
      });
      if (solved.conflicting.length > 0) state.featureErrors[feature.id] = 'CONSTRAINT_CONFLICT';
      else entities = solved.entities;
    }
    state.sketches.set(
      feature.id,
      entities === feature.entities ? feature : { ...feature, entities },
    );
    if (resolved.lostEntityIds.length > 0)
      state.projectionLost[feature.id] = resolved.lostEntityIds;
    else delete state.projectionLost[feature.id];
    return;
  }

  if (feature.type === 'import-mesh') {
    try {
      const parsed = await loadImportedMesh(feature.assetId, feature.format ?? 'stl');
      const bodyId = featureBodyId(feature.id);
      const transformed = transformImportedMesh(parsed, feature);
      state.meshes[bodyId] = transformed.mesh;
      state.bodyOwner.set(bodyId, feature.id);
      state.bodySource.set(bodyId, feature.id);
      state.meshStats[feature.id] = transformed.stats;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
      state.featureErrors[feature.id] =
        message === 'MISSING_ASSET' ? 'MISSING_ASSET' : 'IMPORT_FAILED';
      state.blockedFeatureId = feature.id;
    }
    return;
  }

  if (feature.type === 'import-step') {
    try {
      const data = await loadImportedStep(feature.assetId);
      if (epoch !== rebuildEpoch) return;
      const result = await importStepToKernel(data, `feat:${feature.id}`, feature.id);
      if (epoch !== rebuildEpoch) return;
      const bodyIds: string[] = [];
      for (let index = 0; index < result.bodies.length; index += 1) {
        const body = result.bodies[index]!;
        const bodyId = featureBodyId(feature.id, index);
        const shapeId = trackShape(body.shapeId);
        const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
        if (epoch !== rebuildEpoch) return;
        state.bodyShapes.set(bodyId, shapeId);
        state.bodyOwner.set(bodyId, feature.id);
        state.bodySource.set(bodyId, feature.id);
        state.bodyStats[bodyId] = body.stats;
        state.meshes[bodyId] = mesh;
        ownAllFaces(state.faceOwners, bodyId, body.stats.faces, feature.id);
        bodyIds.push(bodyId);
      }
      state.createdBodies.set(feature.id, bodyIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
      state.featureErrors[feature.id] =
        message === 'MISSING_ASSET' ? 'MISSING_ASSET' : 'IMPORT_FAILED';
      state.blockedFeatureId = feature.id;
    }
    return;
  }

  if (feature.type === 'primitive') {
    try {
      const bodyId = featureBodyId(feature.id);
      const shapeId = trackShape(`feat:${feature.id}`);
      const result = await client.request<MakeBoxResult>({
        type: 'make-primitive',
        params: primitiveKernelParams(feature, shapeId),
      });
      if (epoch !== rebuildEpoch) return;
      const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
      if (epoch !== rebuildEpoch) return;
      state.bodyShapes.set(bodyId, shapeId);
      state.bodyOwner.set(bodyId, feature.id);
      state.bodySource.set(bodyId, feature.id);
      state.bodyStats[bodyId] = result.stats;
      state.meshes[bodyId] = mesh;
      ownAllFaces(state.faceOwners, bodyId, result.stats.faces, feature.id);
      // An array can repeat what an operation made, and a primitive makes its
      // body through the rebuild just like an extrude does.
      state.createdBodies.set(feature.id, [bodyId]);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
    }
    return;
  }

  if (feature.type === 'delete-body') {
    state.bodyShapes.delete(feature.bodyId);
    state.bodyOwner.delete(feature.bodyId);
    delete state.bodyStats[feature.bodyId];
    delete state.meshes[feature.bodyId];
    return;
  }

  if (feature.type === 'extrude') {
    // Bodies are whatever this rebuild reports; an operation that no longer
    // creates bodies (or fails) owns none.
    state.createdBodies.set(feature.id, []);
    try {
      await applyExtrude(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    // A per-body failure does not throw, but it still blocks the timeline:
    // later operations must not be built on a failed state.
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  if (feature.type === 'edge-treatment') {
    state.createdBodies.set(feature.id, []);
    try {
      await applyEdgeTreatment(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  if (feature.type === 'shell') {
    state.createdBodies.set(feature.id, []);
    try {
      await applyShell(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  if (feature.type === 'array') {
    state.createdBodies.set(feature.id, []);
    try {
      await applyArray(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  if (feature.type === 'boolean') {
    state.createdBodies.set(feature.id, []);
    try {
      await applyBoolean(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  if (feature.type === 'transform') {
    try {
      await applyTransform(feature, state, context);
    } catch (error) {
      state.featureErrors[feature.id] = kernelErrorCode(error);
      state.blockedFeatureId = feature.id;
      return;
    }
    if (state.featureErrors[feature.id]) state.blockedFeatureId = feature.id;
    return;
  }

  state.featureErrors[feature.id] = 'NOT_IMPLEMENTED';
  state.blockedFeatureId = feature.id;
}

function kernelErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'OP_FAILED';
  if (error.name && error.name !== 'Error') return error.name;
  // Local checks throw `new Error('CODE')`; kernel failures carry their code in
  // the error name.
  return /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'OP_FAILED';
}

/** Every face of a freshly built body belongs to the operation that built it. */
function ownAllFaces(owners: Map<string, string[]>, bodyId: string, faces: number, id: string) {
  owners.set(
    bodyId,
    Array.from({ length: Math.max(0, faces) }, () => id),
  );
}

async function applyExtrude(
  feature: Resolved<ExtrudeFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch, ghost } = context;
  const {
    sketches,
    sketchFrames,
    bodyShapes,
    bodyOwner,
    bodySource,
    faceOwners,
    meshes,
    bodyStats,
    createdBodies,
    featureErrors,
    featureBodyErrors,
    featureObjectErrors,
  } = state;

  const faceRefs = feature.faceRefs ?? [];
  // An operation without objects builds nothing yet, which is not an error.
  if (!feature.sketchId && faceRefs.length === 0) return;

  let sketch: Resolved<SketchFeature> | undefined;
  let selected: ProfileRegion[] = [];
  if (feature.sketchId) {
    sketch = sketches.get(feature.sketchId);
    if (!sketch) throw new Error('MISSING_SKETCH');
    const profiles = sketchProfiles(sketch.entities);
    // Extruding the whole sketch means its outermost faces: nested faces are
    // already holes of their parent region.
    selected =
      feature.scope === 'all'
        ? profiles.filter((profile) => profile.depth === 0)
        : profiles.filter((profile) => feature.regions.includes(profile.id));
    if (selected.length === 0) throw new Error('NO_PROFILE');
  }

  const frame = sketch ? (sketchFrames[sketch.id] ?? computeSketchFrame(sketch)) : null;
  // A revolve turns its inputs around a picked line; without that line there is
  // nothing to turn them around.
  const revolve: Resolved<RevolveSpec> | undefined =
    feature.method === 'revolve' ? (feature.revolve ?? defaultRevolve()) : undefined;
  const revolveAxis = revolve
    ? resolveRevolveAxis(revolve.axis, {
        meshes,
        sketches: [...sketches.values()],
        frames: sketchFrames,
      })
    : null;
  if (revolve && !revolveAxis) throw new Error('REVOLVE_AXIS_MISSING');
  const revolveAnglesRad = revolve
    ? (() => {
        const angles = revolveAngles(revolve);
        if (Math.abs(angles.end - angles.start) < 1e-6) throw new Error('REVOLVE_NO_ANGLE');
        return {
          startAngle: (angles.start * Math.PI) / 180,
          endAngle: (angles.end * Math.PI) / 180,
        };
      })()
    : null;

  /** How a sketch region or a face becomes a solid: pulled or turned. */
  const profileRequest = (
    shapeId: string,
    plane: { origin: Vec3; xAxis: Vec3; yAxis: Vec3; normal: Vec3 },
    regions: ProfileRegion[],
    plan: ToBodyPlan | null,
    embed: number,
  ) =>
    revolveAxis && revolveAnglesRad
      ? {
          type: 'make-revolve' as const,
          params: {
            shapeId,
            name: feature.id,
            origin: plane.origin,
            xAxis: plane.xAxis,
            yAxis: plane.yAxis,
            regions: regions.map((profile) => ({
              key: profile.id,
              outer: profile.outer,
              holes: profile.holes,
            })),
            axis: revolveAxis,
            ...revolveAnglesRad,
          },
        }
      : {
          type: 'make-prism' as const,
          params: {
            shapeId,
            name: feature.id,
            origin: plane.origin,
            xAxis: plane.xAxis,
            yAxis: plane.yAxis,
            regions: regions.map((profile) => ({
              key: profile.id,
              outer: profile.outer,
              holes: profile.holes,
            })),
            distances: extrudeDistances(feature, plane.origin, plane.normal, meshes, plan),
            // Only a tool that stands on material reaches behind its plane; a
            // sweep into the body already overlaps it.
            ...(embed > 0 ? { embed } : {}),
          },
        };

  const faceRequest = (
    shapeId: string,
    sourceShapeId: string,
    faceId: number,
    pose: { origin: Vec3; normal: Vec3 },
    embed: boolean,
    plan: ToBodyPlan | null,
  ) =>
    revolveAxis && revolveAnglesRad
      ? {
          type: 'make-face-revolve' as const,
          params: {
            shapeId,
            name: feature.id,
            sourceShapeId,
            faceId,
            axis: revolveAxis,
            ...revolveAnglesRad,
          },
        }
      : {
          type: 'make-face-prism' as const,
          params: {
            shapeId,
            name: feature.id,
            sourceShapeId,
            faceId,
            normal: pose.normal,
            distances: extrudeDistances(feature, pose.origin, pose.normal, meshes, plan),
            embed,
          },
        };

  const markBodyError = (bodyId: string, code: string) => {
    const errors = featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    featureBodyErrors[feature.id] = errors;
  };
  const bodyErrorCode = (bodyId: string) =>
    bodyOwner.has(bodyId) ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY';

  // "To body" has no free distance: the sweep looks for the body it ends on and
  // the tools are trimmed by it. "First" ends on the face that looks at the
  // profile, "last" on the far face of the body (ADR 0035).
  const toBodyKind =
    feature.end === 'to-body' && feature.method === 'extrude'
      ? (feature.toBody?.kind ?? 'first')
      : null;
  // The inspector stores a size and the way it ends on the face; the sign that
  // tells the trim which side of the face to take follows from the two.
  const toBodyOffset = signedToBodyOffset(
    feature.toBodyOffset ?? 0,
    toBodyKind ?? 'first',
    feature.toBody?.mode,
  );

  interface ToBodyReference {
    bodyId: string;
    shapeId: string;
    plan: ToBodyPlan;
    direction: Vec3;
    /** A point of the profile plane: what a tool "touches" is measured from it. */
    origin: Vec3;
  }

  const toBodyReference = (origin: Vec3, normal: Vec3, samples: Vec3[]): ToBodyReference | null => {
    if (!toBodyKind) return null;
    const direction = signedDirection(normal, feature.reversed ? -1 : 1);
    const hits = traceProfile(meshes, samples, direction);
    const bodyId = pickReferenceBody(hits, toBodyKind, feature.toBody?.bodyId);
    const shapeId = bodyId ? bodyShapes.get(bodyId) : undefined;
    if (!bodyId || !shapeId) throw new Error('TO_BODY_MISSING');
    // A union has to share material with the body it joins: the face it lands on
    // is passed by a hair, exactly like an added blind extrusion.
    const embed = feature.op === 'add' ? UNION_EMBED : 0;
    const plan = toBodyPlan(hits, bodyId, toBodyKind, toBodyOffset, embed);
    if (!plan) throw new Error('TO_BODY_EMPTY');
    return { bodyId, shapeId, plan, direction, origin };
  };

  /**
   * Trims one tool of a "to body" extent against its reference body. The gap is
   * made by moving the body's surface along its own normals, so the tool ends the
   * same distance from the body wherever the profile meets it, and the end
   * follows any curvature instead of being cut by a plane.
   */
  const trimToBody = async (
    shapeId: string,
    reference: ToBodyReference,
    startsInside: boolean,
  ): Promise<string> => {
    const { plan, direction, origin } = reference;
    const boolean = async (
      resultId: string,
      baseShapeId: string,
      toolShapeId: string,
      op: 'cut' | 'common' | 'fuse',
    ) => {
      await client.request({
        type: 'boolean',
        params: { shapeId: resultId, name: feature.id, baseShapeId, toolShapeId, op },
      });
    };
    /**
     * The body with its surface moved along its own normals. An offset, not a
     * translation: the distance from the tool's end to the body is then the same
     * everywhere, including where the surface runs along the sweep.
     */
    const offsetBody = async (suffix: string, distance: number): Promise<string> => {
      if (distance === 0) return reference.shapeId;
      const offsetId = trackShape(`${shapeId}:${suffix}`);
      await client.request({
        type: 'offset-shape',
        params: {
          shapeId: offsetId,
          name: `${feature.id}/${suffix}`,
          sourceShapeId: reference.shapeId,
          distance,
        },
      });
      return offsetId;
    };
    /**
     * Drops what the prism keeps behind the reference body. Cutting the body out
     * of a prism that passes it leaves that sliver as its own solid, cut off by
     * the body: only the parts that reach the profile plane belong to the tool.
     */
    const atPlane = async (shapeId: string, suffix: string): Promise<string> => {
      const stats = await client.request<ShapeStats>({ type: 'topology', shapeId });
      if (epoch !== rebuildEpoch) return shapeId;
      if (stats.solids < 2) return shapeId;
      const prefix = `${shapeId}:${suffix}`;
      for (let index = 0; index < stats.solids; index += 1) {
        trackShape(`${prefix}:solid-${index}`);
      }
      const split = await client.request<SplitSolidsResult>({
        type: 'split-solids',
        params: { shapeId, prefix },
      });
      if (epoch !== rebuildEpoch) return shapeId;
      const kept: string[] = [];
      for (const solid of split.solids) {
        const mesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: solid.shapeId,
        });
        if (epoch !== rebuildEpoch) return shapeId;
        if (reachesPlane(mesh, origin, direction)) kept.push(solid.shapeId);
      }
      if (kept.length === 0) throw new Error('TO_BODY_EMPTY');
      let result = kept[0]!;
      for (const piece of kept.slice(1)) {
        const fusedId = trackShape(`${shapeId}:${suffix}-fused`);
        await boolean(fusedId, result, piece, 'fuse');
        result = fusedId;
      }
      return result;
    };
    /** What the profile sweeps through up to the ending face. */
    const regionTo = async (suffix: string, bodySuffix: string, distance: number) => {
      const bodyId = await offsetBody(bodySuffix, distance);
      if (epoch !== rebuildEpoch) return shapeId;
      const regionId = trackShape(`${shapeId}:${suffix}`);
      await boolean(regionId, shapeId, bodyId, startsInside ? 'common' : 'cut');
      return regionId;
    };
    try {
      const frontId = await atPlane(await regionTo('front', 'body', plan.offset), 'front-kept');
      if (epoch !== rebuildEpoch) return shapeId;
      if (!plan.whole) {
        if (plan.outerOffset === undefined) return frontId;
        // A layer is what the sweep covers up to the face minus what it covers
        // up to that face moved outwards: a shell of that thickness on the body.
        const outerId = await regionTo('outer', 'outer-body', plan.outerOffset);
        if (epoch !== rebuildEpoch) return shapeId;
        const layerId = trackShape(`${shapeId}:layer`);
        await boolean(layerId, frontId, outerId, 'cut');
        if (epoch !== rebuildEpoch) return shapeId;
        return layerId;
      }
      // The column from the profile to the far face: the part in front of the
      // body plus the material of the body itself.
      const faceId = await offsetBody('face', plan.offset);
      if (epoch !== rebuildEpoch) return shapeId;
      const materialId = trackShape(`${shapeId}:material`);
      await boolean(materialId, shapeId, faceId, 'common');
      if (epoch !== rebuildEpoch) return shapeId;
      const resultId = trackShape(`${shapeId}:to-body`);
      await boolean(resultId, frontId, materialId, 'fuse');
      if (epoch !== rebuildEpoch) return shapeId;
      return resultId;
    } catch {
      // A boolean against the reference body that leaves nothing — or a surface
      // the kernel cannot offset — is the extent missing the body, not a kernel
      // failure worth reporting as one.
      throw new Error('TO_BODY_EMPTY');
    }
  };

  /** Whether the profile itself sits in material, which flips "cut" to "common". */
  const startsInsideBody = (bodyId: string, samples: readonly Vec3[]): boolean => {
    const mesh = meshes[bodyId];
    if (!mesh || samples.length === 0) return false;
    const inside = samples.filter((point) => pointInMesh(mesh, point)).length;
    return inside * 2 > samples.length;
  };

  const buildProfileShape = async (
    shapeId: string,
    plane: { origin: Vec3; xAxis: Vec3; yAxis: Vec3; normal: Vec3 },
    regions: ProfileRegion[],
  ): Promise<string> => {
    const samples = profileSamples(regions, plane);
    const reference = toBodyReference(plane.origin, plane.normal, samples);
    // The embed belongs to a union tool whose first sweep goes along the normal;
    // a reversed or symmetric first sweep is handled by the signed distances.
    const firstDistance = extrudeDistances(
      feature,
      plane.origin,
      plane.normal,
      meshes,
      reference?.plan ?? null,
    )[0];
    const embed =
      !revolve && feature.op === 'add' && firstDistance !== undefined && firstDistance > 0
        ? addEmbedFor(samples, plane.normal, meshes)
        : 0;
    await client.request(profileRequest(shapeId, plane, regions, reference?.plan ?? null, embed));
    if (epoch !== rebuildEpoch) return shapeId;
    if (!reference) return shapeId;
    return trimToBody(shapeId, reference, startsInsideBody(reference.bodyId, samples));
  };

  const buildFaceShape = async (
    shapeId: string,
    sourceShapeId: string,
    faceId: number,
    pose: { origin: Vec3; normal: Vec3 },
    embed: boolean,
    bodyId: string,
  ): Promise<string> => {
    const mesh = meshes[bodyId];
    const samples = mesh ? faceSamples(mesh, faceId) : [];
    const reference = toBodyReference(pose.origin, pose.normal, samples);
    await client.request(
      faceRequest(shapeId, sourceShapeId, faceId, pose, embed, reference?.plan ?? null),
    );
    if (epoch !== rebuildEpoch) return shapeId;
    if (!reference) return shapeId;
    return trimToBody(shapeId, reference, startsInsideBody(reference.bodyId, samples));
  };

  // A new body operation may produce several bodies. Every region and every
  // picked face becomes an independent solid, exactly as the user picked them.
  // Body ids use a stable slot, so replacing the first face of the operation
  // keeps that body's name and colour.
  if (feature.op === 'new') {
    interface NewBodyPart {
      key: string;
      profile?: ProfileRegion;
      ref?: BodyFaceRef;
    }
    const profileByRegion = new Map(selected.map((profile) => [profile.id, profile]));
    const refByKey = new Map(faceRefs.map((ref) => [`b:${ref.name}`, ref]));
    const parts: NewBodyPart[] = [];
    const usedProfiles = new Set<string>();
    const usedRefs = new Set<string>();
    const addPart = (key: string) => {
      if (key.startsWith('s:')) {
        const regionId = key.slice(2).split('#')[1];
        const profile = regionId ? profileByRegion.get(regionId) : undefined;
        if (!profile || usedProfiles.has(profile.id)) return;
        usedProfiles.add(profile.id);
        parts.push({ key, profile });
        return;
      }
      if (key.startsWith('b:')) {
        const ref = refByKey.get(key);
        if (!ref || usedRefs.has(key)) return;
        usedRefs.add(key);
        parts.push({ key, ref });
      }
    };
    for (const key of feature.objectOrder ?? []) addPart(key);
    if (sketch) {
      for (const profile of selected) addPart(`s:${sketch.id}#${profile.id}`);
    }
    for (const ref of faceRefs) addPart(`b:${ref.name}`);

    // Faces touching along an edge belong to the same solid: extruding two
    // crescents and the lens between them must make one body, while the two
    // crescents alone make two. Group transitively before building.
    const groupByProfile = new Map<string, ProfileRegion[]>();
    for (const profile of selected) {
      if (groupByProfile.has(profile.id)) continue;
      const group: ProfileRegion[] = [profile];
      groupByProfile.set(profile.id, group);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of selected) {
          if (groupByProfile.has(candidate.id)) continue;
          const touches = group.some((entry) =>
            entry.edges.some((edge) => candidate.edges.includes(edge)),
          );
          if (!touches) continue;
          group.push(candidate);
          groupByProfile.set(candidate.id, group);
          changed = true;
        }
      }
    }

    const bodies: string[] = [];
    const emittedGroups = new Set<ProfileRegion[]>();
    let slot = 0;
    for (const part of parts) {
      if (part.profile) {
        const group = groupByProfile.get(part.profile.id) ?? [part.profile];
        if (emittedGroups.has(group)) continue;
        emittedGroups.add(group);
        const bodyId = extrudeBodyId(feature.id, `body-${slot}`);
        const shapeId = await buildProfileShape(
          trackShape(`${feature.id}:prism-${slot}`),
          frame!,
          group,
        );
        if (epoch !== rebuildEpoch) return;
        bodyShapes.set(bodyId, shapeId);
        bodyOwner.set(bodyId, feature.id);
        bodySource.set(bodyId, feature.id);
        const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
        if (epoch !== rebuildEpoch) return;
        meshes[bodyId] = mesh;
        bodyStats[bodyId] = await client.request<ShapeStats>({ type: 'topology', shapeId });
        if (epoch !== rebuildEpoch) return;
        ownAllFaces(faceOwners, bodyId, bodyStats[bodyId]!.faces, feature.id);
        bodies.push(bodyId);
        slot += 1;
        continue;
      }

      const ref = part.ref!;
      const resolved = resolveFaceRef({ bodyShapes, meshes, bodyStats }, ref);
      if (!resolved) {
        markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
        continue;
      }
      const sourceShapeId = bodyShapes.get(resolved.bodyId);
      if (!sourceShapeId) {
        markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
        continue;
      }
      const bodyId = extrudeBodyId(feature.id, `body-${slot}`);
      const shapeId = await buildFaceShape(
        trackShape(`${feature.id}:face-${slot}`),
        sourceShapeId,
        resolved.faceId,
        ref,
        false,
        resolved.bodyId,
      );
      if (epoch !== rebuildEpoch) return;
      bodyShapes.set(bodyId, shapeId);
      bodyOwner.set(bodyId, feature.id);
      bodySource.set(bodyId, feature.id);
      const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      bodyStats[bodyId] = await client.request<ShapeStats>({ type: 'topology', shapeId });
      if (epoch !== rebuildEpoch) return;
      ownAllFaces(faceOwners, bodyId, bodyStats[bodyId]!.faces, feature.id);
      bodies.push(bodyId);
      slot += 1;
    }
    const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
    if (bodyErrors.length > 0) {
      featureErrors[feature.id] = bodyErrors[0]!;
    }
    createdBodies.set(feature.id, bodies);
    return;
  }

  // Every object produces its own tool solid. Keeping them separate lets an
  // "add" apply only the parts that actually touch a given body; cut/intersect
  // fuse them back into one tool below. The object key matches the Faces list,
  // so a part that cannot be applied can be reported on its own row.
  const toolParts: { shapeId: string; key: string }[] = [];
  const refBodyRemap = new Map<string, string>();
  // `scope` describes the regions being extruded, so bodies to combine with are
  // chosen separately: the ones listed on the feature, or every other body.
  const explicitTargetsEarly = feature.bodyIds.length > 0;
  // Parts are only needed apart when they end up as separate bodies, or when an
  // add must report per region. Everything else goes through one kernel call:
  // it fuses the regions and merges the walls they share, which a chain of
  // booleans leaves behind as internal faces that make later cuts miss.
  const separateParts = feature.op === 'add' && explicitTargetsEarly;
  if (selected.length > 0 && !separateParts) {
    const shapeId = await buildProfileShape(
      trackShape(`tool:${feature.id}:sketch`),
      frame!,
      selected,
    );
    if (epoch !== rebuildEpoch) return;
    toolParts.push({ shapeId, key: `s:${sketch!.id}#*` });
  } else {
    for (const [index, profile] of selected.entries()) {
      const shapeId = await buildProfileShape(
        trackShape(`tool:${feature.id}:sketch-${index}`),
        frame!,
        [profile],
      );
      if (epoch !== rebuildEpoch) return;
      toolParts.push({ shapeId, key: `s:${sketch!.id}#${profile.id}` });
    }
  }
  for (const [index, ref] of faceRefs.entries()) {
    const resolved = resolveFaceRef({ bodyShapes, meshes, bodyStats }, ref);
    if (!resolved) {
      markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
      continue;
    }
    const sourceShapeId = bodyShapes.get(resolved.bodyId);
    if (!sourceShapeId) {
      markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
      continue;
    }
    // A face a previous boolean moved to another body keeps its identity, so
    // the target list follows it instead of adding to a body it left behind.
    if (!refBodyRemap.has(ref.bodyId)) refBodyRemap.set(ref.bodyId, resolved.bodyId);
    const shapeId = await buildFaceShape(
      trackShape(`tool:${feature.id}:face-${index}`),
      sourceShapeId,
      resolved.faceId,
      ref,
      feature.op === 'add',
      resolved.bodyId,
    );
    if (epoch !== rebuildEpoch) return;
    toolParts.push({ shapeId, key: `b:${ref.name}` });
  }
  if (toolParts.length === 0) throw new Error('NO_PROFILE');

  const explicitTargets = explicitTargetsEarly;

  // An add to picked bodies handles parts individually, so a part that misses
  // its body can be skipped (see the target loop); every other case shares one
  // fused tool, which costs one boolean with the body instead of one per part.
  let toolShapeId = toolParts[0]!.shapeId;
  if (feature.op !== 'add' || !explicitTargets) {
    for (const [index, part] of toolParts.slice(1).entries()) {
      const fusedId = trackShape(`tool:${feature.id}:fused-${index}`);
      await client.request({
        type: 'boolean',
        params: {
          shapeId: fusedId,
          name: feature.id,
          baseShapeId: toolShapeId,
          toolShapeId: part.shapeId,
          op: 'fuse',
        },
      });
      if (epoch !== rebuildEpoch) return;
      toolShapeId = fusedId;
    }
  }

  const targets = explicitTargets
    ? [...new Set(feature.bodyIds.map((bodyId) => refBodyRemap.get(bodyId) ?? bodyId))]
    : [...bodyShapes.keys()].filter((bodyId) => bodyOwner.get(bodyId) !== feature.id);
  if (targets.length === 0) throw new Error('NO_TARGET_BODY');

  // An array of this operation repeats these tools at its own placements. The
  // source already built them, so it only has to say what it applied and where.
  state.featureTools.set(feature.id, {
    parts:
      feature.op === 'add' && explicitTargets
        ? toolParts.map((part) => part.shapeId)
        : [toolShapeId],
    op: feature.op,
    targets: [...targets],
    disjointCheck: feature.op === 'add' && explicitTargets,
  });

  // The volume a cut removes is shown in the preview even though the resulting
  // body no longer contains it.
  if (ghost && feature.op === 'subtract') {
    ghost.mesh = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: toolShapeId,
    });
    if (epoch !== rebuildEpoch) return;
    // A revolve has no through-all extent, so its ghost never fades.
    if (frame && !revolve) {
      const fade: { axis: [number, number, number]; start: number }[] = [];
      const sign = feature.reversed ? -1 : 1;
      const primary = signedDirection(frame.normal, sign);
      // The ghost fades only after the material ends: everything up to the
      // model's far point stays as solid as a blind cut.
      if (feature.end === 'through-all') {
        fade.push({ axis: primary, start: modelSupport(meshes, primary) });
      }
      if (feature.secondDirection?.end === 'through-all') {
        const secondary = signedDirection(frame.normal, -sign);
        fade.push({ axis: secondary, start: modelSupport(meshes, secondary) });
      }
      if (fade.length > 0) ghost.fade = fade;
    }
  }

  // An add preview shows only the material the operation brings. The common
  // volume says whether the tool touches the body at all (an add that misses it
  // forks a second solid and is an error), and one cut then yields the green
  // delta. Neither step needs the union the full rebuild will perform.
  if (ghost && feature.op === 'add') {
    const parts = explicitTargets ? toolParts.map((part) => part.shapeId) : [toolShapeId];
    const additions: TessellationResult[] = [];
    const appliedParts = new Set<string>();
    for (const bodyId of targets) {
      const baseShapeId = bodyShapes.get(bodyId);
      if (!baseShapeId) {
        if (explicitTargets) markBodyError(bodyId, bodyErrorCode(bodyId));
        continue;
      }
      let touched = false;
      for (const [index, part] of parts.entries()) {
        const commonId = trackShape(`${feature.id}:preview-common:${bodyId}:${index}`);
        try {
          await client.request({
            type: 'boolean',
            params: {
              shapeId: commonId,
              baseShapeId: part,
              toolShapeId: baseShapeId,
              op: 'common',
            },
          });
        } catch {
          liveShapes.delete(commonId);
          void client.request({ type: 'dispose', shapeId: commonId }).catch(() => undefined);
          continue;
        }
        if (epoch !== rebuildEpoch) return;
        const common = await client.request<ShapeStats>({ type: 'topology', shapeId: commonId });
        if (epoch !== rebuildEpoch) return;
        if (common.faces === 0 || common.solids === 0) {
          liveShapes.delete(commonId);
          void client.request({ type: 'dispose', shapeId: commonId }).catch(() => undefined);
          continue;
        }
        touched = true;
        if (explicitTargets) appliedParts.add(toolParts[index]!.key);
        const deltaId = trackShape(`${feature.id}:preview-add:${bodyId}:${index}`);
        try {
          await client.request({
            type: 'boolean',
            params: { shapeId: deltaId, baseShapeId: part, toolShapeId: baseShapeId, op: 'cut' },
          });
        } catch {
          continue;
        }
        if (epoch !== rebuildEpoch) return;
        const delta = await client.request<ShapeStats>({ type: 'topology', shapeId: deltaId });
        if (epoch !== rebuildEpoch) return;
        if (delta.faces === 0 || delta.solids === 0) {
          liveShapes.delete(deltaId);
          void client.request({ type: 'dispose', shapeId: deltaId }).catch(() => undefined);
          continue;
        }
        const mesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: deltaId,
        });
        if (epoch !== rebuildEpoch) return;
        additions.push(mesh);
      }
      if (!touched) markBodyError(bodyId, 'DISJOINT_UNION');
    }
    if (additions.length > 0) ghost.additions = additions;
    if (explicitTargets) {
      const objectErrors = featureObjectErrors[feature.id] ?? {};
      for (const part of toolParts) {
        if (!appliedParts.has(part.key)) objectErrors[part.key] = 'DISJOINT_UNION';
      }
      if (Object.keys(objectErrors).length > 0) featureObjectErrors[feature.id] = objectErrors;
    }
    const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
    if (bodyErrors.length > 0) featureErrors[feature.id] = bodyErrors[0]!;
    return;
  }

  let applied = 0;
  /** Parts that actually affected at least one explicitly chosen body. */
  const appliedParts = new Set<string>();
  for (const bodyId of targets) {
    const baseShapeId = bodyShapes.get(bodyId);
    if (!baseShapeId) {
      // Only an explicitly selected body is an error; with "all bodies" a mesh
      // or an empty body simply cannot participate.
      if (explicitTargets) markBodyError(bodyId, bodyErrorCode(bodyId));
      continue;
    }

    // Adding to picked bodies applies each tool part separately. A part that
    // would create an independent solid is skipped, so two faces on two bodies
    // both receive their own material instead of rejecting each other's
    // disjoint parts. An add to every body uses the fused tool below.
    if (feature.op === 'add' && explicitTargets) {
      const initial = await client.request<ShapeStats>({
        type: 'topology',
        shapeId: baseShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      let currentShapeId = baseShapeId;
      let solidCount = initial.solids;
      let touched = false;

      for (const [index, part] of toolParts.entries()) {
        const resultShapeId = trackShape(`${bodyId}:${feature.id}:part-${index}`);
        const fused = await client.request<MakeBoxResult>({
          type: 'boolean',
          params: {
            shapeId: resultShapeId,
            name: feature.id,
            baseShapeId: currentShapeId,
            toolShapeId: part.shapeId,
            op: 'fuse',
            trackFaces: true,
          },
        });
        if (epoch !== rebuildEpoch) return;
        const after = fused.stats;
        if (after.solids > solidCount) {
          liveShapes.delete(resultShapeId);
          void client.request({ type: 'dispose', shapeId: resultShapeId }).catch(() => undefined);
          continue;
        }
        // Each part adds to the previous result, so its map applies to the
        // owners the chain has accumulated so far.
        if (fused.facesFromBase) {
          const previous = faceOwners.get(bodyId) ?? [];
          faceOwners.set(
            bodyId,
            fused.facesFromBase.map((from) =>
              from >= 0 ? (previous[from] ?? feature.id) : feature.id,
            ),
          );
        }
        currentShapeId = resultShapeId;
        solidCount = after.solids;
        touched = true;
        if (explicitTargets) appliedParts.add(part.key);
      }

      if (!touched) {
        // An explicitly chosen body that no part touches cannot take the add.
        if (explicitTargets) markBodyError(bodyId, 'DISJOINT_UNION');
        continue;
      }

      bodyShapes.set(bodyId, currentShapeId);
      bodySource.set(bodyId, feature.id);
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: currentShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      bodyStats[bodyId] = await client.request<ShapeStats>({
        type: 'topology',
        shapeId: currentShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      applied += 1;
      continue;
    }

    const resultShapeId = trackShape(`${bodyId}:${feature.id}`);
    const booleanOp = feature.op === 'add' ? 'fuse' : feature.op === 'subtract' ? 'cut' : 'common';
    const request = (shapeId: string, base: string, tool: string) =>
      client.request<MakeBoxResult>({
        type: 'boolean',
        params: {
          shapeId,
          name: feature.id,
          baseShapeId: base,
          toolShapeId: tool,
          op: booleanOp,
          trackFaces: true,
        },
      });
    let operated: MakeBoxResult;
    try {
      operated = await request(resultShapeId, baseShapeId, toolShapeId);
    } catch (error) {
      // One tool made of several parts can fail as a whole — the parts share
      // walls, and OCCT gives up on such a boolean — while every part on its
      // own is a small, reliable operation. Apply them one at a time instead.
      // The parts are built here, one region at a time: the fused tool is the
      // fragile one, and a region on its own is what the user saw work.
      let current = baseShapeId;
      let last: MakeBoxResult | null = null;
      const applyPart = async (tool: string, index: number): Promise<void> => {
        const stepId = trackShape(`${bodyId}:${feature.id}:part-${index}`);
        try {
          const step = await request(stepId, current, tool);
          if (epoch !== rebuildEpoch) return;
          current = stepId;
          last = step;
        } catch {
          // A part that cannot be applied is dropped, the rest still apply.
        }
      };
      if (selected.length > 0) {
        for (const [index, profile] of selected.entries()) {
          const toolId = await buildProfileShape(
            trackShape(`${feature.id}:single-tool-${index}`),
            frame!,
            [profile],
          );
          if (epoch !== rebuildEpoch) return;
          await applyPart(toolId, index);
          if (epoch !== rebuildEpoch) return;
        }
      } else {
        for (const [index, part] of toolParts.entries()) {
          await applyPart(part.shapeId, index);
          if (epoch !== rebuildEpoch) return;
        }
      }
      if (!last) throw error;
      operated = last;
    }
    if (epoch !== rebuildEpoch) return;
    // A union that leaves its new material as a separate solid added nothing:
    // it must not fork the body into bodies the user never asked for.
    const solidsBefore = bodyStats[bodyId]?.solids ?? 1;
    if (feature.op === 'add' && operated.stats.solids > solidsBefore) {
      markBodyError(bodyId, 'DISJOINT_UNION');
      continue;
    }
    const outputShapeId = operated.shapeId;
    // Which operation owns each face of the compound result. Splitting it must
    // not lose this: a face that moves to a new body keeps its operation.
    const previousOwners = faceOwners.get(bodyId) ?? [];
    const compoundOwners = (
      operated.facesFromBase ?? Array.from({ length: Math.max(0, operated.stats.faces) }, () => -1)
    ).map((from) => (from >= 0 ? (previousOwners[from] ?? feature.id) : feature.id));

    // A cut through the whole cross-section leaves a compound of separate
    // solids. Each one becomes a body: the largest keeps this one, the rest are
    // new independent bodies with stable ids.
    const splitPrefix = `${resultShapeId}:split`;
    // Register the expected shapes before the request, so a rebuild that is
    // aborted mid-split can still dispose them.
    if (operated.stats.solids > 1) {
      for (let index = 0; index < operated.stats.solids; index += 1) {
        trackShape(`${splitPrefix}:solid-${index}`);
      }
    }
    const split =
      operated.stats.solids > 1
        ? await client.request<SplitSolidsResult>({
            type: 'split-solids',
            params: { shapeId: outputShapeId, prefix: splitPrefix },
          })
        : null;
    if (epoch !== rebuildEpoch) return;
    const assignment = split ? splitAssignment(split.solids) : null;
    const originalOwner = bodyOwner.get(bodyId) ?? feature.id;
    if (assignment) {
      const extras: Array<{ bodyId: string; solid: SplitSolid; created: boolean }> = [];
      for (const solid of assignment.extras) {
        const mesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: solid.shapeId,
        });
        if (epoch !== rebuildEpoch) return;
        const defining = [...(mesh.faceNames ?? [])].sort()[0] ?? 'piece';
        extras.push({
          bodyId: splitBodyId(feature.id, bodyId, defining),
          solid,
          created: true,
        });
      }
      const pieces: Array<{ bodyId: string; solid: SplitSolid; created: boolean }> = [
        { bodyId, solid: assignment.main, created: false },
        ...extras,
      ];
      for (const piece of pieces) {
        bodyShapes.set(piece.bodyId, piece.solid.shapeId);
        bodyOwner.set(piece.bodyId, piece.created ? feature.id : originalOwner);
        bodySource.set(piece.bodyId, feature.id);
        faceOwners.set(
          piece.bodyId,
          piece.solid.facesFromShape.map((from) => compoundOwners[from] ?? feature.id),
        );
        const pieceMesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: piece.solid.shapeId,
        });
        if (epoch !== rebuildEpoch) return;
        meshes[piece.bodyId] = pieceMesh;
        bodyStats[piece.bodyId] = await client.request<ShapeStats>({
          type: 'topology',
          shapeId: piece.solid.shapeId,
        });
        if (epoch !== rebuildEpoch) return;
      }
      const splitPrefix = `${feature.id}:split:${bodyId}:`;
      createdBodies.set(feature.id, [
        ...(createdBodies.get(feature.id) ?? []).filter((id) => !id.startsWith(splitPrefix)),
        ...pieces.filter((piece) => piece.created).map((piece) => piece.bodyId),
      ]);
    } else {
      bodyShapes.set(bodyId, outputShapeId);
      bodySource.set(bodyId, feature.id);
      faceOwners.set(bodyId, compoundOwners);
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: outputShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      meshes[bodyId] = mesh;
      bodyStats[bodyId] = await client.request<ShapeStats>({
        type: 'topology',
        shapeId: resultShapeId,
      });
      if (epoch !== rebuildEpoch) return;
      // A body that is whole again loses the bodies its cut had split off.
      const splitPrefix = `${feature.id}:split:${bodyId}:`;
      createdBodies.set(
        feature.id,
        (createdBodies.get(feature.id) ?? []).filter((id) => !id.startsWith(splitPrefix)),
      );
    }
    applied += 1;
  }

  // A picked face that affects none of the explicitly chosen bodies would form
  // an independent body, so it is reported on its own Faces row.
  if (explicitTargets && feature.op === 'add') {
    const objectErrors = featureObjectErrors[feature.id] ?? {};
    for (const part of toolParts) {
      if (!appliedParts.has(part.key)) objectErrors[part.key] = 'DISJOINT_UNION';
    }
    if (Object.keys(objectErrors).length > 0) featureObjectErrors[feature.id] = objectErrors;
  }

  const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
  const objectErrors = Object.values(featureObjectErrors[feature.id] ?? {});
  if (applied === 0 || bodyErrors.length > 0 || objectErrors.length > 0) {
    // The operation block explains the first failure; every failing body and
    // object also carries its own icon. If every implicit target was skipped,
    // there is simply nothing to apply the extrusion to.
    featureErrors[feature.id] = bodyErrors[0] ?? objectErrors[0] ?? 'NO_TARGET_BODY';
  }
}

/**
 * A chamfer or a fillet applies to the rim of picked faces and to picked edges,
 * one body at a time. The stored refs are poses, so a body renumbered by an
 * earlier operation still finds its edges.
 */
async function applyEdgeTreatment(
  feature: Resolved<EdgeTreatmentFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch } = context;
  const {
    bodyShapes,
    meshes,
    bodyStats,
    bodySource,
    faceOwners,
    featureBodyErrors,
    featureObjectErrors,
  } = state;

  // An operation without inputs is being configured, not failing.
  if (feature.faceRefs.length === 0 && feature.edgeRefs.length === 0) return;

  const markBodyError = (bodyId: string, code: string) => {
    const errors = featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    featureBodyErrors[feature.id] = errors;
  };
  const markObjectError = (key: string, code: string) => {
    const errors = featureObjectErrors[feature.id] ?? {};
    errors[key] = code;
    featureObjectErrors[feature.id] = errors;
  };

  const groups = new Map<string, { faceIds: number[]; edgeIds: string[] }>();
  const groupOf = (bodyId: string) => {
    let group = groups.get(bodyId);
    if (!group) {
      group = { faceIds: [], edgeIds: [] };
      groups.set(bodyId, group);
    }
    return group;
  };
  for (const ref of feature.faceRefs) {
    const resolved = resolveFaceRef({ bodyShapes, meshes, bodyStats }, ref);
    if (!resolved) {
      markObjectError(
        `face:${ref.name}`,
        bodyShapes.has(ref.bodyId) ? 'TARGET_FAILED' : 'UNKNOWN_BODY',
      );
      continue;
    }
    groupOf(resolved.bodyId).faceIds.push(resolved.faceId);
  }
  for (const ref of feature.edgeRefs) {
    const resolved = resolveEdgeRef({ bodyShapes, meshes }, ref);
    if (!resolved) {
      markObjectError(
        `edge:${ref.name}`,
        bodyShapes.has(ref.bodyId) ? 'TARGET_FAILED' : 'UNKNOWN_BODY',
      );
      continue;
    }
    groupOf(resolved.bodyId).edgeIds.push(resolved.edgeId);
  }

  let applied = Infinity;
  let appliedAny = false;
  for (const [bodyId, group] of groups) {
    const sourceShapeId = bodyShapes.get(bodyId);
    if (!sourceShapeId) {
      markBodyError(bodyId, 'UNKNOWN_BODY');
      continue;
    }
    if (group.faceIds.length === 0 && group.edgeIds.length === 0) continue;
    // The mesh gives a cheap ceiling, so an oversized request costs one build
    // instead of a search. The kernel reports what it really used.
    const mesh = meshes[bodyId];
    const estimate = mesh ? edgeTreatmentLimit(mesh, group) : null;
    const size =
      estimate === null
        ? feature.size
        : Math.min(feature.size, Math.max(MIN_TREATMENT_SIZE, estimate * ESTIMATE_MARGIN));
    const resultShapeId = trackShape(`${bodyId}:${feature.id}`);
    let result: EdgeTreatmentResult;
    try {
      result = await client.request<EdgeTreatmentResult>({
        type: 'edge-treatment',
        params: {
          shapeId: resultShapeId,
          name: feature.id,
          sourceShapeId,
          kind: feature.kind,
          faceIds: group.faceIds,
          edgeIds: group.edgeIds,
          size,
        },
      });
    } catch (error) {
      // The kernel answers for the whole request, so no single edge is named:
      // the block carries the failure and the rows stay unmarked.
      markBodyError(bodyId, kernelErrorCode(error));
      // Nothing of this operation is on the body any more, so the colours of
      // an earlier attempt would lie about what is there.
      dropFaceMarks(state, feature.id, bodyId);
      continue;
    }
    if (epoch !== rebuildEpoch) return;

    // Treated faces are the operation's; the ones the kernel left untouched
    // keep the operation that made them.
    const previousOwners = faceOwners.get(bodyId) ?? [];
    faceOwners.set(
      bodyId,
      result.facesFromBase.map((from) =>
        from >= 0 ? (previousOwners[from] ?? feature.id) : feature.id,
      ),
    );
    bodyShapes.set(bodyId, resultShapeId);
    bodySource.set(bodyId, feature.id);
    bodyStats[bodyId] = result.stats;
    const meshAfter = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: resultShapeId,
    });
    if (epoch !== rebuildEpoch) return;
    meshes[bodyId] = meshAfter;
    applied = Math.min(applied, result.applied);
    appliedAny = true;
    // The new faces say what the operation did: the ones cut into the material
    // are red, the ones added where there was nothing are green.
    state.featureFaceMarks[feature.id] = [
      ...(state.featureFaceMarks[feature.id] ?? []).filter((mark) => mark.bodyId !== bodyId),
      classifyTreatmentFaces(bodyId, mesh, meshAfter, result.facesFromBase),
    ];
  }

  if (appliedAny) {
    state.featureLimits[feature.id] = { requested: feature.size, applied };
  }
  for (const bodyId of Object.keys(featureBodyErrors[feature.id] ?? {})) {
    dropFaceMarks(state, feature.id, bodyId);
  }
  const bodyErrors = Object.values(featureBodyErrors[feature.id] ?? {});
  const objectErrors = Object.values(featureObjectErrors[feature.id] ?? {});
  if (!appliedAny || bodyErrors.length > 0 || objectErrors.length > 0) {
    state.featureErrors[feature.id] = bodyErrors[0] ?? objectErrors[0] ?? 'TARGET_FAILED';
  }
}

/**
 * Hollows bodies in place (`inward`) or gives each of them a new covering body
 * (`outward`). Faces left open are resolved like any other stored face ref, so
 * a body renumbered by an earlier operation still finds them.
 */
/**
 * The most copies one array may make, seed included. Every copy is a kernel
 * shape and a tessellation, so a runaway count would freeze the rebuild.
 */
/**
 * The most copies one array may make, seed included. Every copy is a kernel
 * shape and a tessellation, so a runaway count would freeze the rebuild.
 */
const MAX_ARRAY_POSITIONS = 200;

/** Everything the placements of a direction are read from. */
function placementContext(state: RebuildState): ArrayPlacementContext {
  return {
    meshes: state.meshes,
    sketches: [...state.sketches.values()],
    frames: state.sketchFrames,
  };
}

/**
 * The placements of one direction, the seed (`0`) first. A direction that
 * cannot be resolved is an error of the whole operation: silently repeating
 * the seed would look like the array did nothing.
 */
function arrayDirectionMatrices(
  direction: Resolved<ArrayDirection>,
  state: RebuildState,
): Matrix3x4[] {
  return directionMatrices(direction, placementContext(state));
}

/**
 * Repeats the picked bodies, or the bodies the picked operations made. Every
 * copy is a body of its own; the seed stays where it is. Directions nest: the
 * second one repeats the whole result of the first, which is what turns a row
 * into a grid or bends it around an axis (ADR 0029).
 */
async function applyArray(
  feature: Resolved<ArrayFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch, ghost } = context;
  const { bodyShapes, bodyOwner, bodySource, faceOwners, meshes, bodyStats, createdBodies } = state;

  // Operations are replayed in build order. An operation that made bodies
  // contributes those bodies at their creation shape; one that changed bodies
  // in place contributes the material it added and the material it removed.
  const featureOrder = new Map(
    context.project.features.map((candidate, index) => [candidate.id, index]),
  );
  const sources: ArrayFeatureSource[] = [];
  if (feature.target === 'geometry') {
    for (const featureId of feature.featureIds) {
      const order = featureOrder.get(featureId);
      if (order === undefined) continue;
      const operation = context.project.features[order]!;
      const createdShapes = state.featureCreatedShapes.get(featureId);
      const created = createdShapes
        ? [...createdShapes].map(([bodyId, shapeId]) => ({ bodyId, shapeId }))
        : [];
      const source: ArrayFeatureSource = { featureId, created, order };
      const tool = state.featureTools.get(featureId);
      if (operation.type === 'extrude' && operation.op !== 'new' && tool) {
        source.tool = tool;
      } else {
        const changes = state.featureChanges.get(featureId);
        if (changes && changes.size > 0) source.changes = changes;
      }
      if (source.created.length > 0 || source.tool || source.changes) sources.push(source);
    }
    sources.sort((a, b) => a.order - b.order);
    // Nothing picked yet is a configuration in progress, not a failure: the
    // array is waiting for the picker. A picked operation that produces nothing
    // is a real error, because the user asked for it and got nothing.
    if (sources.length === 0) {
      if (feature.featureIds.length > 0) state.featureErrors[feature.id] = 'NO_TARGET_BODY';
      return;
    }
  } else {
    const created = feature.bodyIds.flatMap((bodyId) => {
      const shapeId = bodyShapes.get(bodyId);
      return shapeId ? [{ bodyId, shapeId }] : [];
    });
    if (created.length > 0) sources.push({ featureId: '', created, order: 0 });
    // Same rule for bodies: an empty list is being filled, a picked body that is
    // no longer there is a failure.
    else if (feature.bodyIds.length > 0) {
      state.featureErrors[feature.id] = 'NO_TARGET_BODY';
      return;
    }
  }
  // An operation without inputs is being configured, not failing.
  if (sources.length === 0 || feature.directions.length === 0) return;

  const counts = feature.directions.map((direction) => clampArrayCount(direction.count));
  if (arrayPositionCount(counts) > MAX_ARRAY_POSITIONS) {
    throw new Error('ARRAY_TOO_LARGE');
  }
  const perDirection = feature.directions.map((direction) =>
    arrayDirectionMatrices(direction, state),
  );
  // The seed is the combination where every direction sits at its first copy.
  const placements = arrayPlacements(counts, perDirection);

  // While the array is being configured nothing is replayed: the copies are the
  // stamp the picked operations repeat, drawn at every placement. The stamp is
  // computed once, so count, step and direction answer at once.
  if (ghost) {
    await previewArray(feature, state, context, sources, placements);
    return;
  }

  // The list is attached before the copies are built, so a failure halfway
  // still reports the copies that did appear instead of leaving them unnamed.
  const newBodies: string[] = [];
  createdBodies.set(feature.id, newBodies);
  const markBodyError = (bodyId: string, code: string) => {
    const errors = state.featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    state.featureBodyErrors[feature.id] = errors;
  };

  // A copy that could not join its body stays a body of its own, and a later
  // change of the source belongs to that copy, not to the body it came from.
  const separateCopies = new Map<string, string>();
  const targetBodyOf = (bodyId: string, placementKey: string): string =>
    separateCopies.get(`${bodyId}|${placementKey}`) ?? bodyId;

  const copyBody = async (
    bodyId: string,
    shapeId: string,
    placement: { key: string; matrix: Matrix3x4 },
    sourceIndex: number,
  ): Promise<void> => {
    const copyId = arrayBodyId(feature.id, bodyId, placement.key);
    // A body can be picked through two operations of the same run; one copy is
    // enough, and the later operation keeps working on it.
    if (bodyShapes.has(copyId)) return;
    const copyShapeId = trackShape(`${bodyId}:${feature.id}:${sourceIndex}:${placement.key}`);
    try {
      const result = await client.request<MakeBoxResult>({
        type: 'transform-shape',
        params: {
          shapeId: copyShapeId,
          sourceShapeId: shapeId,
          matrix: placement.matrix,
          nameScope: `${feature.id}/${placement.key}`,
          owner: feature.id,
        },
      });
      if (epoch !== rebuildEpoch) return;
      bodyOwner.set(copyId, feature.id);
      settle(copyId, copyShapeId, result.stats);
      ownAllFaces(faceOwners, copyId, result.stats.faces, feature.id);
      newBodies.push(copyId);
    } catch (error) {
      markBodyError(bodyId, kernelErrorCode(error));
    }
  };

  const takeOwners = (bodyId: string, facesFromBase: number[] | undefined) => {
    if (!facesFromBase) return;
    const previousOwners = faceOwners.get(bodyId) ?? [];
    faceOwners.set(
      bodyId,
      facesFromBase.map((from) => (from >= 0 ? (previousOwners[from] ?? feature.id) : feature.id)),
    );
  };

  // A copy of an operation is applied to a body many times; meshing the body
  // after every placement costs more than the booleans themselves and nobody
  // looks at the intermediate shapes. Each body is meshed once, when the whole
  // array is in place.
  const dirtyBodies = new Set<string>();
  const settle = (bodyId: string, shapeId: string, stats?: ShapeStats) => {
    bodyShapes.set(bodyId, shapeId);
    bodySource.set(bodyId, feature.id);
    if (stats) bodyStats[bodyId] = stats;
    dirtyBodies.add(bodyId);
  };
  // Solid counts come from the statistics the rebuild already holds, so no
  // placement asks the kernel for them again.
  const solidCounts = new Map<string, number>();
  const solidsOf = (bodyId: string): number => {
    const known = solidCounts.get(bodyId);
    if (known !== undefined) return known;
    const count = bodyStats[bodyId]?.solids ?? 0;
    solidCounts.set(bodyId, count);
    return count;
  };
  const settleMeshes = async (): Promise<boolean> => {
    for (const bodyId of dirtyBodies) {
      const shapeId = bodyShapes.get(bodyId);
      if (!shapeId) continue;
      const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
      if (epoch !== rebuildEpoch) return false;
      meshes[bodyId] = mesh;
    }
    return true;
  };

  const disposeShape = (shapeId: string) => {
    liveShapes.delete(shapeId);
    void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
  };

  // What an operation did to a body, as material it added and material it
  // removed. The difference is the same for every copy, so it is cut out of the
  // input and output shapes once, not once per placement.
  const deltasOf = async (
    source: ArrayFeatureSource,
    sourceIndex: number,
  ): Promise<Array<{ bodyId: string; added?: string; removed?: string }> | null> => {
    if (!source.changes) return [];
    const deltas: Array<{ bodyId: string; added?: string; removed?: string }> = [];
    for (const [bodyId, change] of source.changes) {
      const addedId = trackShape(`delta:${feature.id}:${sourceIndex}:${bodyId}:add`);
      const removedId = trackShape(`delta:${feature.id}:${sourceIndex}:${bodyId}:remove`);
      try {
        const added = await client.request<MakeBoxResult>({
          type: 'boolean',
          params: {
            shapeId: addedId,
            name: feature.id,
            baseShapeId: change.after,
            toolShapeId: change.before,
            op: 'cut',
          },
        });
        if (epoch !== rebuildEpoch) return null;
        const removed = await client.request<MakeBoxResult>({
          type: 'boolean',
          params: {
            shapeId: removedId,
            name: feature.id,
            baseShapeId: change.before,
            toolShapeId: change.after,
            op: 'cut',
          },
        });
        if (epoch !== rebuildEpoch) return null;
        const delta: { bodyId: string; added?: string; removed?: string } = { bodyId };
        if (added.stats.solids > 0) delta.added = addedId;
        if (removed.stats.solids > 0) delta.removed = removedId;
        if (delta.added || delta.removed) deltas.push(delta);
      } catch (error) {
        markBodyError(bodyId, kernelErrorCode(error));
      }
    }
    return deltas;
  };

  for (const [sourceIndex, source] of sources.entries()) {
    const deltas = await deltasOf(source, sourceIndex);
    if (deltas === null) return;

    type PlacedTool = { sourceShapeId: string; matrix: Matrix3x4; key: string };
    const collect = (map: Map<string, PlacedTool[]>, targetId: string, tool: PlacedTool): void => {
      const list = map.get(targetId) ?? [];
      list.push(tool);
      map.set(targetId, list);
    };

    /**
     * One boolean for the whole array on one body: every placed tool goes into
     * one call, which is several times faster than a placement at a time and
     * meshes the result once instead of per copy. With `guarded`, a result that
     * gained a solid is refused: the placement landed in empty space, and the
     * caller drops it by applying the tools one at a time.
     */
    const applyBatch = async (
      targetId: string,
      tools: readonly PlacedTool[],
      op: 'fuse' | 'cut' | 'common',
      label: string,
      guarded: boolean,
    ): Promise<'done' | 'loose' | 'failed'> => {
      const resultShapeId = trackShape(`${targetId}:${feature.id}:${sourceIndex}:${label}:all`);
      try {
        const result = await client.request<MakeBoxResult>({
          type: 'boolean-all',
          params: {
            shapeId: resultShapeId,
            name: feature.id,
            baseShapeId: bodyShapes.get(targetId)!,
            tools: tools.map((tool) => ({
              sourceShapeId: tool.sourceShapeId,
              matrix: [...tool.matrix],
              key: tool.key,
            })),
            op,
            trackFaces: true,
          },
        });
        if (epoch !== rebuildEpoch) return 'failed';
        if (guarded && result.stats.solids > solidsOf(targetId)) {
          disposeShape(resultShapeId);
          return 'loose';
        }
        solidCounts.set(targetId, result.stats.solids);
        takeOwners(targetId, result.facesFromBase);
        settle(targetId, resultShapeId, result.stats);
        return 'done';
      } catch (error) {
        markBodyError(targetId, kernelErrorCode(error));
        disposeShape(resultShapeId);
        return 'failed';
      }
    };

    /** The same tools applied one placement at a time, skipping loose solids. */
    const applyOneByOne = async (
      targetId: string,
      tools: readonly PlacedTool[],
      op: 'fuse' | 'cut' | 'common',
      label: string,
    ): Promise<void> => {
      let current = bodyShapes.get(targetId)!;
      let solidCount = solidsOf(targetId);
      let resulting: ShapeStats | undefined;
      let touched = false;
      for (const [index, tool] of tools.entries()) {
        const toolId = trackShape(`tool:${feature.id}:${sourceIndex}:${label}:${index}:copy`);
        const resultShapeId = trackShape(
          `${targetId}:${feature.id}:${sourceIndex}:${label}:${index}`,
        );
        try {
          await client.request({
            type: 'transform-shape',
            params: {
              shapeId: toolId,
              sourceShapeId: tool.sourceShapeId,
              matrix: tool.matrix,
              nameScope: `${feature.id}/${label}/${index}`,
              owner: feature.id,
            },
          });
          if (epoch !== rebuildEpoch) return;
          const result = await client.request<MakeBoxResult>({
            type: 'boolean',
            params: {
              shapeId: resultShapeId,
              name: feature.id,
              baseShapeId: current,
              toolShapeId: toolId,
              op,
              trackFaces: true,
            },
          });
          if (epoch !== rebuildEpoch) return;
          if (result.stats.solids > solidCount) {
            disposeShape(resultShapeId);
            continue;
          }
          solidCount = result.stats.solids;
          solidCounts.set(targetId, solidCount);
          takeOwners(targetId, result.facesFromBase);
          current = resultShapeId;
          resulting = result.stats;
          touched = true;
        } catch (error) {
          markBodyError(targetId, kernelErrorCode(error));
          return;
        }
      }
      if (touched) settle(targetId, current, resulting);
    };

    /** One batch, with the one-at-a-time fallback for guarded operations. */
    const apply = async (
      targetId: string,
      tools: readonly PlacedTool[],
      op: 'fuse' | 'cut' | 'common',
      label: string,
      guarded: boolean,
    ): Promise<void> => {
      if (tools.length === 0) return;
      const outcome = await applyBatch(targetId, tools, op, label, guarded);
      if (epoch !== rebuildEpoch || outcome !== 'loose') return;
      await applyOneByOne(targetId, tools, op, label);
    };

    // A body the picked operation made is repeated as material, not as a body:
    // repeating a primitive adds the primitive where the copies land, which is
    // what the copies of a preview look like — volumes added to the model. A
    // copy that lands on nothing has nothing to join, so it stays a body of its
    // own.
    if (source.created.length > 0 && placements.length > 0) {
      for (const entry of source.created) {
        if (feature.target === 'bodies') {
          // Repeating a body gives bodies: the copies are what was picked.
          for (const placement of placements) {
            await copyBody(entry.bodyId, entry.shapeId, placement, sourceIndex);
            if (epoch !== rebuildEpoch) return;
            separateCopies.set(
              `${entry.bodyId}|${placement.key}`,
              arrayBodyId(feature.id, entry.bodyId, placement.key),
            );
          }
          continue;
        }
        const seedId = entry.bodyId;
        if (!bodyShapes.has(seedId)) {
          markBodyError(seedId, meshes[seedId] ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY');
          continue;
        }
        const tools = placements.map((placement) => ({
          sourceShapeId: entry.shapeId,
          matrix: placement.matrix,
          key: placement.key,
        }));
        const outcome = await applyBatch(seedId, tools, 'fuse', `repeat:${seedId}`, true);
        if (epoch !== rebuildEpoch) return;
        if (outcome !== 'loose') continue;
        // Some copy stands on its own. Which one is only known by trying, so
        // each placement is decided in turn: joined where it lands on the body,
        // a body of its own where it lands on nothing.
        for (const placement of placements) {
          const copyId = arrayBodyId(feature.id, seedId, placement.key);
          const placedId = trackShape(`tool:${feature.id}:${sourceIndex}:repeat:${placement.key}`);
          const resultId = trackShape(
            `${seedId}:${feature.id}:${sourceIndex}:repeat:${placement.key}`,
          );
          try {
            const placed = await client.request<MakeBoxResult>({
              type: 'transform-shape',
              params: {
                shapeId: placedId,
                sourceShapeId: entry.shapeId,
                matrix: placement.matrix,
                nameScope: `${feature.id}/${placement.key}`,
                owner: feature.id,
              },
            });
            if (epoch !== rebuildEpoch) return;
            const fused = await client.request<MakeBoxResult>({
              type: 'boolean',
              params: {
                shapeId: resultId,
                name: feature.id,
                baseShapeId: bodyShapes.get(seedId)!,
                toolShapeId: placedId,
                op: 'fuse',
                trackFaces: true,
              },
            });
            if (epoch !== rebuildEpoch) return;
            if (fused.stats.solids > solidsOf(seedId)) {
              disposeShape(resultId);
              bodyOwner.set(copyId, feature.id);
              settle(copyId, placedId, placed.stats);
              ownAllFaces(faceOwners, copyId, placed.stats.faces, feature.id);
              newBodies.push(copyId);
              separateCopies.set(`${seedId}|${placement.key}`, copyId);
              continue;
            }
            solidCounts.set(seedId, fused.stats.solids);
            takeOwners(seedId, fused.facesFromBase);
            settle(seedId, resultId, fused.stats);
          } catch (error) {
            markBodyError(seedId, kernelErrorCode(error));
            return;
          }
        }
      }
    }

    if (source.tool) {
      const booleanOp =
        source.tool.op === 'add' ? 'fuse' : source.tool.op === 'subtract' ? 'cut' : 'common';
      // Placements that apply to the same body share one call; a copy that could
      // not join its body is a target of its own.
      const byTarget = new Map<string, PlacedTool[]>();
      for (const bodyId of source.tool.targets) {
        for (const placement of placements) {
          const targetId = targetBodyOf(bodyId, placement.key);
          if (!bodyShapes.has(targetId)) {
            markBodyError(bodyId, meshes[targetId] ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY');
            continue;
          }
          for (const part of source.tool.parts) {
            collect(byTarget, targetId, {
              sourceShapeId: part,
              matrix: placement.matrix,
              key: placement.key,
            });
          }
        }
      }
      for (const [targetId, tools] of byTarget) {
        await apply(targetId, tools, booleanOp, `tool:${sourceIndex}`, source.tool.disjointCheck);
        if (epoch !== rebuildEpoch) return;
      }
    }

    // A change is repeated by the material it added and the material it
    // removed; both are the same for every placement, so a body takes one call
    // per kind. A placement never overlaps its neighbours, so applying every
    // addition and then every removal is the same as doing both per placement.
    for (const delta of deltas) {
      const addedByTarget = new Map<string, PlacedTool[]>();
      const removedByTarget = new Map<string, PlacedTool[]>();
      for (const placement of placements) {
        const targetId = targetBodyOf(delta.bodyId, placement.key);
        if (!bodyShapes.has(targetId)) {
          markBodyError(delta.bodyId, meshes[targetId] ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY');
          continue;
        }
        if (delta.added) {
          collect(addedByTarget, targetId, {
            sourceShapeId: delta.added,
            matrix: placement.matrix,
            key: placement.key,
          });
        }
        if (delta.removed) {
          collect(removedByTarget, targetId, {
            sourceShapeId: delta.removed,
            matrix: placement.matrix,
            key: placement.key,
          });
        }
      }
      const targets = new Set([...addedByTarget.keys(), ...removedByTarget.keys()]);
      for (const targetId of targets) {
        await apply(
          targetId,
          addedByTarget.get(targetId) ?? [],
          'fuse',
          `delta:${sourceIndex}:add`,
          true,
        );
        if (epoch !== rebuildEpoch) return;
        await apply(
          targetId,
          removedByTarget.get(targetId) ?? [],
          'cut',
          `delta:${sourceIndex}:cut`,
          false,
        );
        if (epoch !== rebuildEpoch) return;
      }
    }
  }

  if (!(await settleMeshes())) return;

  const bodyErrors = Object.values(state.featureBodyErrors[feature.id] ?? {});
  if (bodyErrors.length > 0) state.featureErrors[feature.id] = bodyErrors[0]!;
}

/** Colour of the material an array adds; removed material is red. */
const ARRAY_ADDED_COLOR = '#22c55e';
const ARRAY_REMOVED_COLOR = '#ef4444';

/** A volume one repetition of an array repeats, and whether it adds material. */
interface ArrayStamp {
  mesh: TessellationResult;
  kind: 'added' | 'removed';
}

/**
 * What an array repeats, kept while its settings are edited: the tessellation
 * of the repeated volume and the centre its handles start from. Only the
 * selection of what is repeated can change it, so dragging count or step never
 * goes back to the kernel.
 */
interface ArrayStampEntry {
  /** What the stamp was measured from; another answer means it is stale. */
  key: string;
  stamps: ArrayStamp[];
  origin: Vec3;
}

const arrayStampCache = new Map<string, ArrayStampEntry>();

/** Keeps the stamp of the array that is being edited and forgets every other. */
function keepArrayStamp(featureId: string | null): void {
  for (const key of [...arrayStampCache.keys()]) {
    if (key !== featureId) arrayStampCache.delete(key);
  }
}

/** What the stamp was measured from: the picked sources and their shapes. */
function arrayStampKey(feature: ArrayFeature, sources: readonly ArrayFeatureSource[]): string {
  return JSON.stringify({
    target: feature.target,
    bodyIds: feature.bodyIds,
    featureIds: feature.featureIds,
    sources: sources.map((source) => ({
      featureId: source.featureId,
      created: source.created.map((entry) => `${entry.bodyId}>${entry.shapeId}`),
      tool: source.tool
        ? { op: source.tool.op, parts: [...source.tool.parts], targets: [...source.tool.targets] }
        : null,
      changes: source.changes
        ? [...source.changes].map(
            ([bodyId, change]) => `${bodyId}>${change.before}>${change.after}`,
          )
        : null,
    })),
  });
}

/**
 * Copies of the repeated volume, drawn while the array is being configured.
 * Nothing is replayed: the seed bodies stay as they are and every placement
 * carries the same tessellation. The stamp itself is measured once per
 * selection, so the settings answer at once.
 */
async function previewArray(
  feature: Resolved<ArrayFeature>,
  state: RebuildState,
  context: EvalContext,
  sources: readonly ArrayFeatureSource[],
  placements: ReadonlyArray<{ key: string; matrix: Matrix3x4 }>,
): Promise<void> {
  const ghost = context.ghost;
  if (!ghost) return;
  // The copies appear as soon as there is something to repeat, even while the
  // list is still being filled: a picked operation that contributed nothing is
  // a question in progress, not a failure, so it turns red only once the
  // picking ends.
  const picking =
    useUiStore.getState().pickingArrayOperations === feature.id ||
    useUiStore.getState().pickingArrayBodies === feature.id;
  const stamp = await arrayStamp(feature, state, context, sources);
  if (!stamp) return;
  if (stamp.stamps.length === 0) {
    if (!picking) state.featureErrors[feature.id] = 'NO_TARGET_BODY';
    return;
  }
  for (const copy of arrayCopyGhosts(feature, stamp.stamps, placements)) {
    const list = copy.kind === 'added' ? (ghost.added ??= []) : (ghost.removed ??= []);
    list.push(copy);
  }
  ghost.arrayOrigin = stamp.origin;
}

/** One volume per stamp per placement, named after both. */
function arrayCopyGhosts(
  feature: Resolved<ArrayFeature>,
  stamps: readonly ArrayStamp[],
  placements: ReadonlyArray<{ matrix: Matrix3x4 }>,
): Array<{ id: string; kind: ArrayStamp['kind']; mesh: TessellationResult; matrix: Matrix3x4 }> {
  const copies: Array<{
    id: string;
    kind: ArrayStamp['kind'];
    mesh: TessellationResult;
    matrix: Matrix3x4;
  }> = [];
  for (const [stampIndex, stamp] of stamps.entries()) {
    for (const [placementIndex, placement] of placements.entries()) {
      copies.push({
        // A copy keeps its name between two evaluations, so redrawing it only
        // moves the volume it already had.
        id: `ghost:${feature.id}:${stamp.kind}:${stampIndex}:${placementIndex}`,
        kind: stamp.kind,
        mesh: stamp.mesh,
        matrix: placement.matrix,
      });
    }
  }
  return copies;
}

/**
 * The copies of an array, drawn from the stamp that is already measured and
 * with no rebuild in between: a handle drag only moves the placements, so the
 * copies follow the pointer. The directions are resolved from the stores, which
 * hold the same meshes and sketch frames the last rebuild worked on.
 */
export function previewArrayCopies(
  feature: Resolved<ArrayFeature>,
): { ghosts: SceneGhost[]; origin: Vec3 } | null {
  const stamp = arrayStampCache.get(feature.id);
  if (!stamp || stamp.stamps.length === 0) return null;
  if (feature.directions.length === 0) return null;
  const kernel = useKernelStore.getState();
  const model = resolvedModel();
  if (!model) return null;
  let placements: Array<{ key: string; matrix: Matrix3x4 }>;
  try {
    placements = arrayDirections(feature.directions, {
      meshes: kernel.meshes,
      sketches: model.features.filter(
        (candidate): candidate is Extract<ResolvedFeature, { type: 'sketch' }> =>
          candidate.type === 'sketch',
      ),
      frames: kernel.sketchFrames,
    }).placements;
  } catch {
    // A direction that cannot be resolved is reported by the rebuild itself.
    return null;
  }
  const ghosts = arrayCopyGhosts(feature, stamp.stamps, placements).map((copy) => ({
    id: copy.id,
    mesh: copy.mesh,
    color: copy.kind === 'added' ? ARRAY_ADDED_COLOR : ARRAY_REMOVED_COLOR,
    matrix: [...copy.matrix],
  }));
  return { ghosts, origin: stamp.origin };
}

/** The stamp of an array, measured once and reused while the selection holds. */
async function arrayStamp(
  feature: Resolved<ArrayFeature>,
  state: RebuildState,
  context: EvalContext,
  sources: readonly ArrayFeatureSource[],
): Promise<ArrayStampEntry | null> {
  const { client, epoch } = context;
  const key = arrayStampKey(feature, sources);
  const cached = arrayStampCache.get(feature.id);
  if (cached && cached.key === key) return cached;

  const tessellate = async (shapeId: string): Promise<TessellationResult | null> => {
    try {
      return await client.request<TessellationResult>({ type: 'tessellate', shapeId });
    } catch {
      // A volume that cannot be tessellated is left out of the preview.
      return null;
    }
  };
  const dispose = (shapeId: string) => {
    liveShapes.delete(shapeId);
    void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
  };

  const stamps: ArrayStamp[] = [];
  const push = async (shapeId: string, kind: ArrayStamp['kind']): Promise<boolean> => {
    const mesh = await tessellate(shapeId);
    if (epoch !== rebuildEpoch) return false;
    if (mesh) stamps.push({ mesh, kind });
    return true;
  };

  for (const [index, source] of sources.entries()) {
    // Bodies the operation made are repeated whole, as new bodies.
    for (const entry of source.created) {
      if (!(await push(entry.shapeId, 'added'))) return null;
    }
    // An extrude that changes a body repeats the tool it cuts or adds with.
    if (source.tool) {
      for (const part of source.tool.parts) {
        if (!(await push(part, source.tool.op === 'add' ? 'added' : 'removed'))) return null;
      }
    }
    // Anything else is repeated by the material it added and removed.
    if (source.changes) {
      for (const [bodyId, change] of source.changes) {
        const sides = [
          { kind: 'added' as const, base: change.after, tool: change.before },
          { kind: 'removed' as const, base: change.before, tool: change.after },
        ];
        for (const side of sides) {
          const shapeId = trackShape(`stamp:${feature.id}:${index}:${bodyId}:${side.kind}`);
          try {
            const result = await client.request<MakeBoxResult>({
              type: 'boolean',
              params: {
                shapeId,
                baseShapeId: side.base,
                toolShapeId: side.tool,
                op: 'cut',
              },
            });
            if (epoch !== rebuildEpoch) return null;
            if (result.stats.solids > 0 && !(await push(shapeId, side.kind))) return null;
          } catch {
            // A body whose change cannot be measured is not repeated in the
            // preview; the rebuild reports the real failure when it is applied.
          } finally {
            dispose(shapeId);
          }
        }
      }
    }
  }

  const origin = stampCenter(stamps);
  const entry: ArrayStampEntry = { key, stamps, origin };
  arrayStampCache.set(feature.id, entry);
  return entry;
}

/** Centre of the volumes a repetition repeats, where the handles start. */
function stampCenter(stamps: readonly ArrayStamp[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const stamp of stamps) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], stamp.mesh.bbox.min[axis]);
      max[axis] = Math.max(max[axis], stamp.mesh.bbox.max[axis]);
    }
  }
  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/**
 * Moves, turns and scales the picked bodies and sketches as one (ADR 0037).
 * A body keeps its id and its face owners: the copy has the same topology at
 * another pose, so later references to its faces and edges still resolve. A
 * sketch is moved as its result — its frame turns and its geometry scales —
 * and the sketch feature itself is left as the user drew it.
 */
async function applyTransform(
  feature: Resolved<TransformFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch } = context;
  const { bodyShapes, bodySource, meshes, bodyStats, sketchFrames, sketches } = state;
  state.createdBodies.set(feature.id, []);

  const bodyIds = [...new Set(feature.bodyIds)];
  const sketchIds = [...new Set(feature.sketchIds)];
  // Nothing picked yet is configuration in progress, not a failure.
  if (bodyIds.length === 0 && sketchIds.length === 0) return;

  const markBodyError = (bodyId: string, code: string) => {
    const errors = state.featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    state.featureBodyErrors[feature.id] = errors;
  };
  const markSketchError = (sketchId: string, code: string) => {
    const errors = state.featureObjectErrors[feature.id] ?? {};
    errors[`sketch:${sketchId}`] = code;
    state.featureObjectErrors[feature.id] = errors;
  };

  // The pivot is measured on the state before the operation, so it does not
  // drift while the transform itself is being dragged.
  const bounds: TargetBounds[] = [];
  const bodyTargets: Array<{ bodyId: string; shapeId: string }> = [];
  for (const bodyId of bodyIds) {
    const shapeId = bodyShapes.get(bodyId);
    const mesh = meshes[bodyId];
    if (!shapeId || !mesh) {
      markBodyError(bodyId, mesh ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY');
      continue;
    }
    bodyTargets.push({ bodyId, shapeId });
    bounds.push(meshBounds(mesh));
  }

  const sketchTargets: Array<{ sketch: Resolved<SketchFeature>; frame: SketchFrame }> = [];
  for (const sketchId of sketchIds) {
    const sketch = sketches.get(sketchId);
    const frame = sketchFrames[sketchId];
    if (!sketch || !frame) {
      markSketchError(sketchId, 'MISSING_SKETCH');
      continue;
    }
    // An empty sketch has no result to move; it is not an error either.
    const box = sketchBounds(frame, sketch.entities);
    if (!box) continue;
    sketchTargets.push({ sketch, frame });
    bounds.push(box);
  }

  // The selection turns and scales around one point: the centre of everything
  // it holds.
  const pivot = transformPivot(bounds);
  if (!pivot) {
    state.featureErrors[feature.id] = 'NO_TARGET_BODY';
    return;
  }
  state.transformPivots.set(feature.id, pivot);
  const matrix = transformMatrix(feature.transform, pivot.origin);
  const rotation = transformRotation(feature.transform.rotation);

  let moved = 0;
  for (const target of bodyTargets) {
    const shapeId = trackShape(`${target.bodyId}:${feature.id}:transform`);
    try {
      const result = await client.request<MakeBoxResult>({
        type: 'transform-shape',
        params: { shapeId, sourceShapeId: target.shapeId, matrix: [...matrix] },
      });
      if (epoch !== rebuildEpoch) return;
      const mesh = await client.request<TessellationResult>({ type: 'tessellate', shapeId });
      if (epoch !== rebuildEpoch) return;
      bodyShapes.set(target.bodyId, shapeId);
      bodySource.set(target.bodyId, feature.id);
      bodyStats[target.bodyId] = result.stats;
      meshes[target.bodyId] = mesh;
      // `bodyOwner` and `faceOwners` stay as they are: the moved copy has the
      // same faces in the same order, so pictures of them still point at the
      // operations that made them.
      moved += 1;
    } catch (error) {
      markBodyError(target.bodyId, kernelErrorCode(error));
    }
  }

  for (const target of sketchTargets) {
    const result = transformSketchGeometry(
      target.frame,
      target.sketch.entities,
      feature.transform.scale,
      rotation,
      matrix,
    );
    sketches.set(target.sketch.id, { ...target.sketch, entities: result.entities });
    sketchFrames[target.sketch.id] = result.frame;
    // The 3D view draws the sketch from the document, so the moved geometry is
    // handed over explicitly; the frame alone would only move its plane.
    state.sketchOverrides.set(target.sketch.id, result.entities);
    moved += 1;
  }

  const bodyErrors = Object.values(state.featureBodyErrors[feature.id] ?? {});
  const objectErrors = Object.values(state.featureObjectErrors[feature.id] ?? {});
  if (moved === 0) state.featureErrors[feature.id] = 'NO_TARGET_BODY';
  else if (bodyErrors.length > 0) state.featureErrors[feature.id] = bodyErrors[0]!;
  else if (objectErrors.length > 0) state.featureErrors[feature.id] = objectErrors[0]!;
}

async function applyShell(
  feature: Resolved<ShellFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch } = context;
  const { bodyShapes, bodyOwner, bodySource, faceOwners, meshes, bodyStats, createdBodies } = state;

  const targets = new Set<string>(feature.bodyIds ?? []);
  const openings = new Map<string, number[]>();
  const markBodyError = (bodyId: string, code: string) => {
    const errors = state.featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    state.featureBodyErrors[feature.id] = errors;
  };
  const bodyErrorCode = (bodyId: string) =>
    bodyShapes.has(bodyId) ? 'TARGET_FAILED' : meshes[bodyId] ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY';

  for (const ref of feature.removeFaces ?? []) {
    const resolved = resolveShellFaceRef({ bodyShapes, meshes, bodyStats }, ref);
    if (!resolved) {
      markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
      continue;
    }
    const faces = openings.get(resolved.bodyId) ?? [];
    if (!faces.includes(resolved.faceId)) faces.push(resolved.faceId);
    openings.set(resolved.bodyId, faces);
    targets.add(resolved.bodyId);
  }

  if (targets.size === 0 && (feature.removeFaces ?? []).length === 0) return;

  const newBodies: string[] = [];
  let applied = Infinity;
  let appliedAny = false;

  for (const bodyId of targets) {
    const sourceShapeId = bodyShapes.get(bodyId);
    if (!sourceShapeId) {
      markBodyError(bodyId, bodyErrorCode(bodyId));
      continue;
    }
    // Inward wall thickness can never exceed half of the body across its
    // smallest side; starting below that keeps OCCT out of a degenerate offset.
    const mesh = meshes[bodyId];
    const extent = mesh
      ? Math.min(
          mesh.bbox.max[0] - mesh.bbox.min[0],
          mesh.bbox.max[1] - mesh.bbox.min[1],
          mesh.bbox.max[2] - mesh.bbox.min[2],
        )
      : 0;
    const ceiling = feature.direction === 'inward' && extent > 0 ? extent / 2 : feature.thickness;
    const thickness = Math.min(feature.thickness, ceiling);
    const resultShapeId = trackShape(`${bodyId}:${feature.id}:shell`);
    let result: ShellResult;
    try {
      result = await client.request<ShellResult>({
        type: 'shell',
        params: {
          shapeId: resultShapeId,
          name: feature.id,
          sourceShapeId,
          removeFaceIds: openings.get(bodyId) ?? [],
          thickness,
          offset: feature.direction === 'outward' ? Math.max(0, feature.offset ?? 0) : 0,
          direction: feature.direction,
          reown: feature.direction === 'outward',
        },
      });
    } catch (error) {
      markBodyError(bodyId, kernelErrorCode(error));
      continue;
    }
    if (epoch !== rebuildEpoch) return;

    const meshAfter = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: resultShapeId,
    });
    if (epoch !== rebuildEpoch) return;

    if (feature.direction === 'inward') {
      bodyShapes.set(bodyId, resultShapeId);
      bodySource.set(bodyId, feature.id);
      bodyStats[bodyId] = result.stats;
      meshes[bodyId] = meshAfter;
      // The wall keeps the outside of the body: those faces stay owned by the
      // operation that made them, and only the new cavity belongs to the shell.
      const previousOwners = faceOwners.get(bodyId) ?? [];
      const kept = result.facesFromBase;
      if (kept && kept.length === result.stats.faces && kept.some((from) => from >= 0)) {
        faceOwners.set(
          bodyId,
          kept.map((from) => (from >= 0 ? (previousOwners[from] ?? feature.id) : feature.id)),
        );
      } else {
        ownAllFaces(faceOwners, bodyId, result.stats.faces, feature.id);
      }
    } else {
      const newBodyId = shellBodyId(feature.id, bodyId);
      bodyShapes.set(newBodyId, resultShapeId);
      bodyOwner.set(newBodyId, feature.id);
      bodySource.set(newBodyId, feature.id);
      bodyStats[newBodyId] = result.stats;
      meshes[newBodyId] = meshAfter;
      ownAllFaces(faceOwners, newBodyId, result.stats.faces, feature.id);
      newBodies.push(newBodyId);
    }
    applied = Math.min(applied, result.applied);
    appliedAny = true;
  }

  createdBodies.set(feature.id, newBodies);

  if (appliedAny) {
    state.featureLimits[feature.id] = { requested: feature.thickness, applied };
  }
  const bodyErrors = Object.values(state.featureBodyErrors[feature.id] ?? {});
  if (!appliedAny || bodyErrors.length > 0) {
    state.featureErrors[feature.id] = bodyErrors[0] ?? 'NO_TARGET_BODY';
  }
}

/**
 * Combines two lists of bodies (ADR 0036). `boolean-all` builds the result from
 * the first body and every other body as a tool. By default the first body of
 * the first list is modified in place, so later operations and the tree keep
 * naming the same object; Keep asks for a copy instead. Tools are consumed
 * unless their own Keep is on.
 */
async function applyBoolean(
  feature: Resolved<BooleanFeature>,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch, ghost } = context;
  const { bodyShapes, bodyOwner, bodySource, faceOwners, meshes, bodyStats, createdBodies } = state;

  const bodyIds = [...new Set(feature.bodyIds ?? [])];
  const toolIds = [...new Set(feature.toolIds ?? [])].filter((bodyId) => !bodyIds.includes(bodyId));
  // A list that is still being filled is a configuration in progress, not a
  // failure: the operation builds nothing until it has both sides.
  if (bodyIds.length === 0 || toolIds.length === 0) return;

  const markBodyError = (bodyId: string, code: string) => {
    const errors = state.featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    state.featureBodyErrors[feature.id] = errors;
  };
  // A body the rebuild no longer holds is either an imported mesh (it has a
  // tessellation but no B-rep) or gone from this point of the history.
  const bodyErrorCode = (bodyId: string) => (meshes[bodyId] ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY');

  const parts: { bodyId: string; shapeId: string }[] = [];
  for (const bodyId of [...bodyIds, ...toolIds]) {
    const shapeId = bodyShapes.get(bodyId);
    if (!shapeId) {
      markBodyError(bodyId, bodyErrorCode(bodyId));
      continue;
    }
    parts.push({ bodyId, shapeId });
  }
  const bodyErrors = Object.values(state.featureBodyErrors[feature.id] ?? {});
  if (bodyErrors.length > 0) {
    state.featureErrors[feature.id] = bodyErrors[0]!;
    return;
  }

  const base = parts[0]!;
  const tools = parts.slice(1);
  const resultShapeId = trackShape(`${feature.id}:boolean`);
  const op = feature.op === 'union' ? 'fuse' : feature.op === 'subtract' ? 'cut' : 'common';
  // Every body keeps its pose: a boolean between lists moves nothing.
  const result = await client.request<MakeBoxResult>({
    type: 'boolean-all',
    params: {
      shapeId: resultShapeId,
      name: feature.id,
      baseShapeId: base.shapeId,
      tools: tools.map((tool) => ({ sourceShapeId: tool.shapeId, matrix: IDENTITY_MATRIX })),
      op,
      reown: true,
    },
  });
  if (epoch !== rebuildEpoch) return;
  if (result.stats.solids === 0) throw new Error('BOOLEAN_EMPTY');

  // What the operation does to the first list, drawn as a ghost over the model:
  // a union adds the material of the second list, a cut or an intersection
  // removes the part of the target the result no longer has. The delta is
  // feedback only, so a failure to build it never fails the operation.
  if (ghost) {
    const targets = parts.slice(0, bodyIds.length);
    let targetShapeId = targets[0]!.shapeId;
    try {
      if (targets.length > 1) {
        const unionId = trackShape(`${feature.id}:targets`);
        await client.request({
          type: 'boolean-all',
          params: {
            shapeId: unionId,
            baseShapeId: base.shapeId,
            tools: targets.slice(1).map((target) => ({
              sourceShapeId: target.shapeId,
              matrix: IDENTITY_MATRIX,
            })),
            op: 'fuse',
          },
        });
        if (epoch !== rebuildEpoch) return;
        targetShapeId = unionId;
      }
      const deltaId = trackShape(`${feature.id}:delta`);
      const adds = feature.op === 'union';
      const delta = await client.request<MakeBoxResult>({
        type: 'boolean',
        params: {
          shapeId: deltaId,
          baseShapeId: adds ? resultShapeId : targetShapeId,
          toolShapeId: adds ? targetShapeId : resultShapeId,
          op: 'cut',
        },
      });
      if (epoch !== rebuildEpoch) return;
      if (delta.stats.solids > 0 && delta.stats.faces > 0) {
        ghost.mesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: deltaId,
        });
      }
    } catch {
      // A delta that OCCT cannot build is not a reason to lose the preview.
    }
    if (epoch !== rebuildEpoch) return;
  }

  // A result of several independent solids becomes one body each, exactly like
  // a cut that separates a body. The largest solid takes the first slot, so the
  // names stay put while the operation is edited.
  let pieces: { shapeId: string; stats: ShapeStats }[] = [
    { shapeId: resultShapeId, stats: result.stats },
  ];
  if (result.stats.solids > 1) {
    const splitPrefix = `${resultShapeId}:split`;
    for (let index = 0; index < result.stats.solids; index += 1) {
      trackShape(`${splitPrefix}:solid-${index}`);
    }
    try {
      const split = await client.request<SplitSolidsResult>({
        type: 'split-solids',
        params: { shapeId: resultShapeId, prefix: splitPrefix },
      });
      if (epoch !== rebuildEpoch) return;
      const assignment = splitAssignment(split.solids);
      if (assignment) {
        pieces = [assignment.main, ...assignment.extras].map((solid) => ({
          shapeId: solid.shapeId,
          stats: solid.stats,
        }));
      }
    } catch {
      // Splitting is a convenience: a compound body is still the right result.
    }
    if (epoch !== rebuildEpoch) return;
  }

  const registerPiece = async (
    bodyId: string,
    piece: { shapeId: string; stats: ShapeStats },
  ): Promise<boolean> => {
    bodyShapes.set(bodyId, piece.shapeId);
    bodySource.set(bodyId, feature.id);
    bodyStats[bodyId] = piece.stats;
    ownAllFaces(faceOwners, bodyId, piece.stats.faces, feature.id);
    const mesh = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: piece.shapeId,
    });
    if (epoch !== rebuildEpoch) return false;
    meshes[bodyId] = mesh;
    return true;
  };

  // A consumed body leaves the model from this point in the history: its
  // reference is dropped with the shape, while the metadata stays, so switching
  // Keep back on brings the same object back.
  const consume = (bodyId: string) => {
    bodyShapes.delete(bodyId);
    bodyOwner.delete(bodyId);
    bodySource.delete(bodyId);
    faceOwners.delete(bodyId);
    delete bodyStats[bodyId];
    delete meshes[bodyId];
    state.consumedBodies.add(bodyId);
  };

  const created: string[] = [];
  if (feature.keepBodies) {
    // Keep on the first list: the bodies stay as they are and the operation is
    // performed on copies of the material they hold.
    for (const [index, piece] of pieces.entries()) {
      const bodyId = featureBodyId(feature.id, index);
      bodyOwner.set(bodyId, feature.id);
      if (!(await registerPiece(bodyId, piece))) return;
      created.push(bodyId);
    }
  } else {
    // Off (the default): the first body of the list becomes the result, so its
    // name, colour and place in the tree stay where the user put them.
    const targetId = base.bodyId;
    if (!(await registerPiece(targetId, pieces[0]!))) return;
    // A result that separated into several solids keeps the target for the
    // largest piece; every other piece is a body of its own. Its id follows the
    // smallest face name the piece carries, so editing the operation does not
    // renumber the pieces.
    for (const piece of pieces.slice(1)) {
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: piece.shapeId,
      });
      if (epoch !== rebuildEpoch) return;
      const defining = [...(mesh.faceNames ?? [])].sort()[0] ?? 'piece';
      const bodyId = splitBodyId(feature.id, targetId, defining);
      bodyOwner.set(bodyId, feature.id);
      if (!(await registerPiece(bodyId, piece))) return;
      created.push(bodyId);
    }
    // The rest of the first list was the material the result was built from:
    // it leaves the model, since its shape now lives in the target.
    for (const bodyId of bodyIds.slice(1)) consume(bodyId);
  }
  createdBodies.set(feature.id, created);

  if (!feature.keepTools) for (const bodyId of toolIds) consume(bodyId);
}

/** Forgets the coloured faces a treatment had on one body. */
function dropFaceMarks(state: RebuildState, featureId: string, bodyId: string): void {
  const marks = state.featureFaceMarks[featureId];
  if (!marks) return;
  state.featureFaceMarks[featureId] = marks.filter((mark) => mark.bodyId !== bodyId);
}

/**
 * Splits the faces a treatment created by what happened to the material: a face
 * inside the body before the operation is a cut, one outside it is an addition.
 */
/** How many places on one face are checked when the centroid is not enough. */
const FACE_SAMPLE_LIMIT = 24;

/** Points spread over the triangles of one face. */
function faceSamples(mesh: TessellationResult, faceId: number): Vec3[] {
  const { positions, indices, faceIds } = mesh;
  const own: number[] = [];
  for (let triangle = 0; triangle < faceIds.length; triangle += 1) {
    if (faceIds[triangle] === faceId) own.push(triangle);
  }
  const step = Math.max(1, Math.ceil(own.length / FACE_SAMPLE_LIMIT));
  const samples: Vec3[] = [];
  for (let index = 0; index < own.length; index += step) {
    const triangle = own[index]!;
    const a = indices[triangle * 3]! * 3;
    const b = indices[triangle * 3 + 1]! * 3;
    const c = indices[triangle * 3 + 2]! * 3;
    samples.push([
      (positions[a]! + positions[b]! + positions[c]!) / 3,
      (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3,
      (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3,
    ]);
  }
  return samples;
}

/** Whether the face the operation created sits in material or in free space. */
function faceTakesMaterial(
  before: TessellationResult,
  after: TessellationResult,
  faceId: number,
): boolean {
  const region = faceRegion(after, faceId);
  if (!region) return false;
  if (pointInMesh(before, region.centroid)) return true;
  // A face that runs round a hole has its centroid over the hole, in the air,
  // so where most of the face lies decides instead.
  const samples = faceSamples(after, faceId);
  if (samples.length === 0) return false;
  const inside = samples.filter((point) => pointInMesh(before, point)).length;
  return inside > samples.length / 2;
}

function classifyTreatmentFaces(
  bodyId: string,
  before: TessellationResult | undefined,
  after: TessellationResult,
  facesFromBase: readonly number[],
): PreviewFaceMark {
  const mark: PreviewFaceMark = { bodyId, red: [], green: [] };
  for (let faceId = 0; faceId < facesFromBase.length; faceId += 1) {
    if (facesFromBase[faceId] !== -1) continue;
    const takesMaterial = before ? faceTakesMaterial(before, after, faceId) : false;
    (takesMaterial ? mark.red : mark.green).push(faceId);
  }
  return mark;
}

function signedDirection(
  normal: readonly [number, number, number],
  sign: number,
): [number, number, number] {
  return [normal[0] * sign, normal[1] * sign, normal[2] * sign];
}

// Distances are signed along the normal. Flipping mirrors the primary direction,
// and the second direction always goes to the opposite side of it.
function throughAllAllowed(op: ExtrudeFeature['op']): boolean {
  return op === 'subtract' || op === 'intersect';
}

function extrudeDistances(
  feature: Resolved<ExtrudeFeature>,
  origin: readonly [number, number, number],
  normal: readonly [number, number, number],
  meshes: Record<string, TessellationResult>,
  toBodyPlan?: ToBodyPlan | null,
): number[] {
  const sign = feature.reversed ? -1 : 1;
  const distances: number[] = [];
  if (feature.end === 'symmetric') {
    const half = Math.abs(feature.distance);
    distances.push(-half, half);
    return distances;
  }
  // "To body" has no free distance: the reach comes from where the sweep meets
  // the reference body, and a reversed extent reaches back for the layer it
  // leaves on the surface.
  if (feature.end === 'to-body') {
    if (!toBodyPlan) throw new Error('TO_BODY_MISSING');
    distances.push(sign * toBodyPlan.far);
    return distances;
  }
  // Older files can hold a through-all extent that the current operation does
  // not allow; it is treated as a blind extent because its control is hidden.
  const primaryEnd =
    feature.end === 'through-all' && !throughAllAllowed(feature.op) ? 'blind' : feature.end;
  if (primaryEnd === 'through-all') {
    distances.push(sign * throughAllDistance({ origin, normal }, meshes, sign));
  } else {
    distances.push(sign * Math.abs(feature.distance));
  }
  if (feature.secondDirection) {
    const secondEnd =
      feature.secondDirection.end === 'through-all' && !throughAllAllowed(feature.op)
        ? 'blind'
        : feature.secondDirection.end;
    const back =
      secondEnd === 'through-all'
        ? throughAllDistance({ origin, normal }, meshes, -sign)
        : Math.abs(feature.secondDirection.distance);
    distances.push(-sign * back);
  }
  return distances;
}

/**
 * Whether a tessellated shape touches the profile plane. Points before it are
 * negative, and a tool that reaches the plane has a vertex on it.
 */
function reachesPlane(
  mesh: TessellationResult,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): boolean {
  const positions = mesh.positions;
  let nearest = Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const along =
      (positions[index]! - origin[0]) * direction[0] +
      (positions[index + 1]! - origin[1]) * direction[1] +
      (positions[index + 2]! - origin[2]) * direction[2];
    if (along < nearest) nearest = along;
  }
  return nearest <= PLANE_TOLERANCE;
}

// Support of one tessellation along a direction, cached: through-all needs it
// on every preview rebuild while the meshes stay the same.
const supportCache = new WeakMap<TessellationResult, Map<string, number>>();

function meshSupport(
  mesh: TessellationResult,
  direction: readonly [number, number, number],
): number {
  let cache = supportCache.get(mesh);
  if (!cache) {
    cache = new Map();
    supportCache.set(mesh, cache);
  }
  const key = `${direction[0].toFixed(5)},${direction[1].toFixed(5)},${direction[2].toFixed(5)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const [nx, ny, nz] = direction;
  const positions = mesh.positions;
  let far = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const value = positions[index]! * nx + positions[index + 1]! * ny + positions[index + 2]! * nz;
    if (value > far) far = value;
  }
  const support = Number.isFinite(far) ? far : 0;
  cache.set(key, support);
  return support;
}

/**
 * Farthest point of the model measured along `direction` from the world origin.
 * Vertices, not bounding-box corners: an oblique direction reaches a mixed
 * corner that the axis-aligned box does not contain as min/max.
 */
export function modelSupport(
  meshes: Record<string, TessellationResult>,
  direction: readonly [number, number, number],
): number {
  let far = -Infinity;
  for (const mesh of Object.values(meshes)) {
    far = Math.max(far, meshSupport(mesh, direction));
  }
  return Number.isFinite(far) ? far : 0;
}

// How far the model reaches from the sketch origin along a direction.
function modelExtent(
  meshes: Record<string, TessellationResult>,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): number {
  const [nx, ny, nz] = direction;
  const originProjection = origin[0] * nx + origin[1] * ny + origin[2] * nz;
  return modelSupport(meshes, direction) - originProjection;
}

export function throughAllDistance(
  frame: {
    origin: readonly [number, number, number];
    normal: readonly [number, number, number];
  },
  meshes: Record<string, TessellationResult>,
  direction: number,
): number {
  const [nx, ny, nz] = frame.normal;
  return Math.max(
    10,
    modelExtent(meshes, frame.origin, [nx * direction, ny * direction, nz * direction]) + 10,
  );
}
