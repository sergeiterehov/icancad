import type {
  EdgeTreatmentResult,
  MakeBoxResult,
  ShapeStats,
  SplitSolid,
  SplitSolidsResult,
  TessellationResult,
} from '@icancad/kernel';
import type { Vec3 } from '@icancad/model';
import { sketchProfiles, type ProfileRegion } from '@icancad/sketch';
import {
  HISTORY_START,
  BODY_COLORS,
  extrudeBodyId,
  featureBodyId,
  isMeshObject,
  type BodyFaceRef,
  type EdgeTreatmentFeature,
  type ExtrudeFeature,
  type Feature,
  type ImportMeshFeature,
  type Project,
  type SketchFeature,
  type SketchFrame,
} from '@icancad/model';
import { computeSketchFrame, faceSketchValid } from '../sketch/sectionPlane';
import type { MeshFormat, MeshStats, ParsedMesh } from '@icancad/io';
import { loadAsset } from '../persistence/db';
import { nextBodyNumber, useDocumentStore } from '../stores/documentStore';
import {
  useKernelStore,
  type PreviewBodyMark,
  type PreviewFaceMark,
  type SceneGhost,
  type ScenePreview,
} from '../stores/kernelStore';
import { parseMeshInWorker } from '../io/client';
import { i18n } from '../i18n';
import { getKernelClient } from './client';
import { faceRegion, pointInMesh } from '../quick/geometry';
import { resolveEdgeRef } from './edgeLookup';
import { edgeTreatmentLimit } from './edgeTreatment';
import { resolveFaceRef } from './faceLookup';
import { kernelTaskQueue } from './scheduler';
import { splitAssignment, splitBodyId } from './splitBodies';
import { RebuildCache, type RebuildCheckpoint } from './checkpoints';

let rebuildEpoch = 0;
const importedMeshCache = new Map<string, Promise<ParsedMesh>>();

/** Kernel shapes this pipeline created; shapes nobody references are disposed. */
const liveShapes = new Set<string>();

/** Smallest size worth building; below it the treatment is invisible. */
const MIN_TREATMENT_SIZE = 0.01;

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

function transformImportedMesh(mesh: ParsedMesh, feature: ImportMeshFeature): TessellationResult {
  const scale = feature.scale || 1;
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

  return {
    positions,
    normals,
    indices: mesh.indices,
    faceIds: new Uint32Array(positions.length / 3),
    triangleCount: mesh.stats.triangleCount,
    vertexCount: positions.length / 3,
    bbox: {
      min: mesh.positions.length > 0 ? min : [0, 0, 0],
      max: mesh.positions.length > 0 ? max : [0, 0, 0],
    },
    // Imported meshes are not B-reps, so they have no selectable edges.
    edges: [],
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
  /** Sketch id -> frame frozen when that operation was evaluated. */
  sketchFrames: Record<string, SketchFrame>;
  sketches: Map<string, SketchFeature>;
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

/** The shape a cut subtracts, shown as a translucent ghost while editing. */
interface GhostCollector {
  mesh?: TessellationResult;
  fade?: { axis: [number, number, number]; start: number }[];
  /** Body whose added part the ghost is; its base mesh is drawn instead. */
  addBaseBodyId?: string;
}

interface EvalContext {
  client: ReturnType<typeof getKernelClient>;
  epoch: number;
  project: Project;
  ghost?: GhostCollector;
}

const rebuildCache = new RebuildCache<RebuildState>();

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
    sketchFrames: {},
    sketches: new Map(),
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
    sketchFrames: { ...state.sketchFrames },
    sketches: new Map(state.sketches),
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

/** Drops every snapshot. The worker was restarted, so its shapes are gone too. */
export function resetRebuildCache(): void {
  rebuildCache.clear();
  liveShapes.clear();
}

export function abortRebuild(): void {
  rebuildEpoch += 1;
  useKernelStore.getState().setRebuildCursor(null);
}

export function rebuildScene(
  project: Project,
  label: string,
  options?: { fromIndex?: number },
): Promise<void> {
  if (useKernelStore.getState().status !== 'ready') return Promise.resolve();
  // Read at enqueue time so the preview matches the project being rebuilt.
  const previewFeatureId = useDocumentStore.getState().editingFeatureId;
  const fromIndex = options?.fromIndex;
  return kernelTaskQueue.enqueue({
    key: 'rebuild',
    label,
    run: () => runRebuild(project, previewFeatureId, fromIndex),
  });
}

/**
 * Forces the model to be recalculated from the given operation on, ignoring the
 * cached states captured after it.
 */
export function rebuildFrom(featureId: string): void {
  const project = useDocumentStore.getState().project;
  const index = project.features.findIndex((feature) => feature.id === featureId);
  if (index < 0) return;
  rebuildCache.invalidateFrom(index);
  // A rebuild that is already running may store snapshots we just dropped, so
  // the start point is passed explicitly instead of relying on the cache.
  void rebuildScene(project, i18n.t('status.rebuild'), { fromIndex: index }).catch(() => undefined);
}

async function runRebuild(
  project: Project,
  previewFeatureId: string | null,
  fromIndex?: number,
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
  const cached = rebuildCache.find(features, reuseUntil);
  const startIndex = cached ? cached.index + 1 : 0;
  const state = cached ? cloneState(cached.state) : emptyState();
  const produced: RebuildCheckpoint<RebuildState>[] = [];

  useKernelStore.getState().setRebuildCursor(startIndex);

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (epoch !== rebuildEpoch) return;
    const feature = features[index];
    if (!feature) break;
    // The dashed caret sits after the operation that is being computed.
    useKernelStore.getState().setRebuildCursor(index + 1);
    if (!feature.suppressed) {
      await evaluateFeature(feature, state, { client, epoch, project });
      if (epoch !== rebuildEpoch) return;
      if (state.blockedFeatureId) break;
    }
    produced.push({ index, prefix: features.slice(0, index + 1), state: cloneState(state) });
  }

  if (epoch !== rebuildEpoch) return;

  // The operation being edited is evaluated on top of the cursor state so the
  // user sees its result, while every later operation stays rolled back.
  const base = state;
  const previewFeature = previewIndex >= 0 ? features[previewIndex] : undefined;
  let published = base;
  let preview: ScenePreview | null = null;

  if (previewFeature && previewIndex === endIndex + 1 && !base.blockedFeatureId) {
    const ghost: GhostCollector = {};
    // Opening the settings of an operation that was already evaluated just
    // reuses its snapshot: only real edits force a recalculation. A cut has to
    // be evaluated again because its tool volume is only tessellated for the
    // preview.
    // A cut shows the removed volume; an add shows the material it will add.
    // Both need the tool solid only the preview tessellates.
    const needsGhost =
      previewFeature.type === 'extrude' &&
      (previewFeature.op === 'subtract' || previewFeature.op === 'add');
    const cachedPreview = needsGhost ? null : rebuildCache.find(features, previewIndex);
    if (cachedPreview && cachedPreview.index === previewIndex) {
      published = cachedPreview.state;
      preview = buildPreview(previewFeature, base, published, ghost, project);
    } else {
      const next = cloneState(base);
      if (!previewFeature.suppressed) {
        await evaluateFeature(previewFeature, next, { client, epoch, project, ghost });
        if (epoch !== rebuildEpoch) return;
        if (!next.blockedFeatureId) {
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

  if (epoch !== rebuildEpoch) return;
  useKernelStore.getState().setRebuildCursor(null);

  // Removed objects stay on screen while the deletion is previewed.
  const scene = preview ? withRemovedBodies(published, base) : published;
  const shapeStats = aggregateStats(scene);

  useKernelStore
    .getState()
    .setScene(
      scene.meshes,
      shapeStats,
      scene.meshStats,
      [...scene.bodyShapes.values()],
      scene.featureErrors,
      scene.featureBodyErrors,
      scene.featureObjectErrors,
      scene.sketchFrames,
      preview,
    );
  // Which operation produced each body's current shape, so a face can lead back
  // to the operation that made it.
  useKernelStore.getState().setBodyOperations(Object.fromEntries(scene.bodySource));
  useKernelStore.getState().setFaceOperations(Object.fromEntries(scene.faceOwners));
  useKernelStore.getState().setFeatureLimits(scene.featureLimits);

  for (const checkpoint of produced) rebuildCache.store(checkpoint);
  useDocumentStore.getState().syncCreatedBodies(base.createdBodies, base.blockedFeatureId);

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
  feature: Feature,
  base: RebuildState,
  after: RebuildState,
  ghost: GhostCollector,
  project: Project,
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
  const keepsBodySolid =
    feature.type === 'extrude' &&
    (feature.op === 'subtract' || feature.op === 'add' || feature.op === 'intersect');
  // Meshes cover solid bodies and imported meshes alike.
  for (const bodyId of Object.keys(after.meshes)) {
    const before = base.meshes[bodyId];
    const now = after.meshes[bodyId];
    if (!now) continue;
    if (!before) {
      bodies.push({ id: bodyId, kind: 'added', ...describe(bodyId) });
      continue;
    }
    if (before === now) continue;
    // A boolean against a body the tool misses still produces a new shape;
    // only a changed tessellation counts as a modification.
    if (meshSignature(before) === meshSignature(now)) continue;
    bodies.push({
      id: bodyId,
      kind: 'modified',
      ...describe(bodyId),
      baseMesh: before,
      ...(keepsBodySolid || feature.type === 'edge-treatment' ? { translucent: false } : {}),
      // A treatment keeps its body as it is: the mark is only there so picking
      // still targets the input shape, and the colour matches the real result.
      ...(feature.type === 'edge-treatment' ? { silent: true } : {}),
      ...(ghost.mesh && ghost.addBaseBodyId === bodyId ? { renderBase: true } : {}),
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
    });
  }

  const ghosts: SceneGhost[] = [];
  if (ghost.mesh) {
    const isAdd = feature.type === 'extrude' && feature.op === 'add';
    ghosts.push({
      id: `ghost:${feature.id}`,
      mesh: ghost.mesh,
      color: isAdd ? '#22c55e' : '#ef4444',
      ...(ghost.fade ? { fade: ghost.fade } : {}),
    });
  }

  return {
    featureId: feature.id,
    bodies,
    ghosts,
    ...(after.featureFaceMarks[feature.id]
      ? { faceMarks: after.featureFaceMarks[feature.id] }
      : {}),
  };
}

function disposeUnusedShapes(client: ReturnType<typeof getKernelClient>): void {
  const keep = new Set<string>();
  // Cached snapshots must stay continuable: their body shapes remain alive.
  for (const checkpoint of rebuildCache.all()) {
    for (const shapeId of checkpoint.state.bodyShapes.values()) keep.add(shapeId);
  }
  for (const shapeId of [...liveShapes]) {
    if (keep.has(shapeId)) continue;
    liveShapes.delete(shapeId);
    void client.request({ type: 'dispose', shapeId }).catch(() => undefined);
  }
}

async function evaluateFeature(
  feature: Feature,
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
    state.sketchFrames[feature.id] = computeSketchFrame(
      feature,
      feature.plane.type === 'face' ? state.meshes[feature.plane.bodyId ?? ''] : undefined,
    );
    state.sketches.set(feature.id, feature);
    return;
  }

  if (feature.type === 'import-mesh') {
    try {
      const parsed = await loadImportedMesh(feature.assetId, feature.format ?? 'stl');
      const bodyId = featureBodyId(feature.id);
      state.meshes[bodyId] = transformImportedMesh(parsed, feature);
      state.bodyOwner.set(bodyId, feature.id);
      state.bodySource.set(bodyId, feature.id);
      state.meshStats[feature.id] = parsed.stats;
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
        type: 'make-box',
        params: { shapeId, ...feature.params, at: feature.transform.translation },
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
  owners.set(bodyId, Array.from({ length: Math.max(0, faces) }, () => id));
}

async function applyExtrude(
  feature: ExtrudeFeature,
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

  let sketch: SketchFeature | undefined;
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
  const markBodyError = (bodyId: string, code: string) => {
    const errors = featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    featureBodyErrors[feature.id] = errors;
  };
  const bodyErrorCode = (bodyId: string) =>
    bodyOwner.has(bodyId) ? 'BODY_NOT_SOLID' : 'UNKNOWN_BODY';

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
    const refByKey = new Map(faceRefs.map((ref) => [`b:${ref.bodyId}#${ref.faceId}`, ref]));
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
    for (const ref of faceRefs) addPart(`b:${ref.bodyId}#${ref.faceId}`);

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
        const shapeId = trackShape(`${feature.id}:prism-${slot}`);
        await client.request({
          type: 'make-prism',
          params: {
            shapeId,
            origin: frame!.origin,
            xAxis: frame!.xAxis,
            yAxis: frame!.yAxis,
            regions: group.map((profile) => ({
              outer: profile.outer,
              holes: profile.holes,
            })),
            distances: extrudeDistances(feature, frame!.origin, frame!.normal, meshes),
          },
        });
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
      const sourceShapeId = bodyShapes.get(ref.bodyId);
      if (!sourceShapeId) {
        markBodyError(ref.bodyId, bodyErrorCode(ref.bodyId));
        continue;
      }
      const bodyId = extrudeBodyId(feature.id, `body-${slot}`);
      const shapeId = trackShape(`${feature.id}:face-${slot}`);
      await client.request({
        type: 'make-face-prism',
        params: {
          shapeId,
          sourceShapeId,
          faceId: Number(ref.faceId),
          normal: ref.normal,
          distances: extrudeDistances(feature, ref.origin, ref.normal, meshes),
        },
      });
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
  for (const [index, profile] of selected.entries()) {
    const shapeId = trackShape(`tool:${feature.id}:sketch-${index}`);
    await client.request({
      type: 'make-prism',
      params: {
        shapeId,
        origin: frame!.origin,
        xAxis: frame!.xAxis,
        yAxis: frame!.yAxis,
        regions: [{ outer: profile.outer, holes: profile.holes }],
        distances: extrudeDistances(feature, frame!.origin, frame!.normal, meshes),
      },
    });
    if (epoch !== rebuildEpoch) return;
    toolParts.push({ shapeId, key: `s:${sketch!.id}#${profile.id}` });
  }
  for (const [index, ref] of faceRefs.entries()) {
    const resolved = resolveFaceRef(
      { bodyShapes, meshes, bodyStats },
      ref,
    );
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
    const shapeId = trackShape(`tool:${feature.id}:face-${index}`);
    await client.request({
      type: 'make-face-prism',
      params: {
        shapeId,
        sourceShapeId,
        faceId: resolved.faceId,
        normal: ref.normal,
        distances: extrudeDistances(feature, ref.origin, ref.normal, meshes),
        // A tool that joins material may reach behind its face, so the union
        // has something to intersect instead of only touching.
        embed: feature.op === 'add',
      },
    });
    if (epoch !== rebuildEpoch) return;
    toolParts.push({ shapeId, key: `b:${ref.bodyId}#${ref.faceId}` });
  }
  if (toolParts.length === 0) throw new Error('NO_PROFILE');

  // Add handles parts individually (see the target loop); the other operations
  // share one fused tool.
  let toolShapeId = toolParts[0]!.shapeId;
  if (feature.op !== 'add') {
    for (const [index, part] of toolParts.slice(1).entries()) {
      const fusedId = trackShape(`tool:${feature.id}:fused-${index}`);
      await client.request({
        type: 'boolean',
        params: {
          shapeId: fusedId,
          baseShapeId: toolShapeId,
          toolShapeId: part.shapeId,
          op: 'fuse',
        },
      });
      if (epoch !== rebuildEpoch) return;
      toolShapeId = fusedId;
    }
  }

  // `scope` describes the regions being extruded, so bodies to combine with are
  // chosen separately: the ones listed on the feature, or every other body.
  const explicitTargets = feature.bodyIds.length > 0;
  const targets = explicitTargets
    ? [
        ...new Set(feature.bodyIds.map((bodyId) => refBodyRemap.get(bodyId) ?? bodyId)),
      ]
    : [...bodyShapes.keys()].filter((bodyId) => bodyOwner.get(bodyId) !== feature.id);
  if (targets.length === 0) throw new Error('NO_TARGET_BODY');

  // The volume a cut removes is shown in the preview even though the resulting
  // body no longer contains it.
  if (ghost && feature.op === 'subtract') {
    ghost.mesh = await client.request<TessellationResult>({
      type: 'tessellate',
      shapeId: toolShapeId,
    });
    if (epoch !== rebuildEpoch) return;
    if (frame) {
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

  // A join keeps the base body opaque, so only the material it actually adds is
  // shown as a ghost: the tool minus the body it is applied to.
  if (ghost && feature.op === 'add' && explicitTargets && targets.length === 1) {
    // The ghost is feedback only: a tool that misses the body or produces an
    // empty delta must not turn the operation into a failure. The real add
    // below reports its own errors.
    try {
      const targetId = targets.find((bodyId) => bodyShapes.has(bodyId));
      const baseShapeId = targetId ? bodyShapes.get(targetId) : undefined;
      const firstPart = toolParts[0];
      if (baseShapeId && firstPart) {
        let ghostToolId = firstPart.shapeId;
        for (const [index, part] of toolParts.slice(1).entries()) {
          const fusedId = trackShape(`tool:${feature.id}:ghost-fused-${index}`);
          await client.request({
            type: 'boolean',
            params: {
              shapeId: fusedId,
              baseShapeId: ghostToolId,
              toolShapeId: part.shapeId,
              op: 'fuse',
            },
          });
          if (epoch !== rebuildEpoch) return;
          ghostToolId = fusedId;
        }
        const deltaId = trackShape(`${feature.id}:ghost-add`);
        await client.request({
          type: 'boolean',
          params: {
            shapeId: deltaId,
            // The added material is the tool minus the body: the body itself
            // keeps its own colour, only the new part turns green.
            baseShapeId: ghostToolId,
            toolShapeId: baseShapeId,
            op: 'cut',
          },
        });
        if (epoch !== rebuildEpoch) return;
        ghost.mesh = await client.request<TessellationResult>({
          type: 'tessellate',
          shapeId: deltaId,
        });
        if (epoch !== rebuildEpoch) return;
        ghost.addBaseBodyId = targetId;
      }
    } catch {
      if (epoch !== rebuildEpoch) return;
      ghost.mesh = undefined;
      ghost.addBaseBodyId = undefined;
    }
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

    // Adding applies each tool part separately. A part that would create an
    // independent solid is skipped, so two faces on two bodies both receive
    // their own material instead of rejecting each other's disjoint parts.
    if (feature.op === 'add') {
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
            fused.facesFromBase.map((from) => (from >= 0 ? (previous[from] ?? feature.id) : feature.id)),
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
    const booleanOp = feature.op === 'subtract' ? 'cut' : 'common';
    const operated = await client.request<MakeBoxResult>({
      type: 'boolean',
      params: {
        shapeId: resultShapeId,
        baseShapeId,
        toolShapeId,
        op: booleanOp,
        trackFaces: true,
      },
    });
    if (epoch !== rebuildEpoch) return;
    // Which operation owns each face of the compound result. Splitting it must
    // not lose this: a face that moves to a new body keeps its operation.
    const previousOwners = faceOwners.get(bodyId) ?? [];
    const compoundOwners = (
      operated.facesFromBase ??
      Array.from({ length: Math.max(0, operated.stats.faces) }, () => -1)
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
            params: { shapeId: resultShapeId, prefix: splitPrefix },
          })
        : null;
    if (epoch !== rebuildEpoch) return;
    const assignment = split ? splitAssignment(split.solids) : null;
    const originalOwner = bodyOwner.get(bodyId) ?? feature.id;
    if (assignment) {
      const pieces: Array<{ bodyId: string; solid: SplitSolid; created: boolean }> = [
        { bodyId, solid: assignment.main, created: false },
        ...assignment.extras.map((solid, index) => ({
          bodyId: splitBodyId(feature.id, bodyId, index + 1),
          solid,
          created: true,
        })),
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
      bodyShapes.set(bodyId, resultShapeId);
      bodySource.set(bodyId, feature.id);
      faceOwners.set(bodyId, compoundOwners);
      const mesh = await client.request<TessellationResult>({
        type: 'tessellate',
        shapeId: resultShapeId,
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
  feature: EdgeTreatmentFeature,
  state: RebuildState,
  context: EvalContext,
): Promise<void> {
  const { client, epoch } = context;
  const { bodyShapes, meshes, bodyStats, bodySource, faceOwners, featureBodyErrors } = state;

  // An operation without inputs is being configured, not failing.
  if (feature.faceRefs.length === 0 && feature.edgeRefs.length === 0) return;

  const markBodyError = (bodyId: string, code: string) => {
    const errors = featureBodyErrors[feature.id] ?? {};
    errors[bodyId] = code;
    featureBodyErrors[feature.id] = errors;
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
      markBodyError(ref.bodyId, bodyShapes.has(ref.bodyId) ? 'TARGET_FAILED' : 'UNKNOWN_BODY');
      continue;
    }
    groupOf(resolved.bodyId).faceIds.push(resolved.faceId);
  }
  for (const ref of feature.edgeRefs) {
    const resolved = resolveEdgeRef({ bodyShapes, meshes }, ref);
    if (!resolved) {
      markBodyError(ref.bodyId, bodyShapes.has(ref.bodyId) ? 'TARGET_FAILED' : 'UNKNOWN_BODY');
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
          sourceShapeId,
          kind: feature.kind,
          faceIds: group.faceIds,
          edgeIds: group.edgeIds,
          size,
        },
      });
    } catch (error) {
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
  if (!appliedAny || bodyErrors.length > 0) {
    state.featureErrors[feature.id] = bodyErrors[0] ?? 'TARGET_FAILED';
  }
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
  feature: ExtrudeFeature,
  origin: readonly [number, number, number],
  normal: readonly [number, number, number],
  meshes: Record<string, TessellationResult>,
): number[] {
  const sign = feature.reversed ? -1 : 1;
  const distances: number[] = [];
  if (feature.end === 'symmetric') {
    const half = Math.abs(feature.distance);
    distances.push(-half, half);
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
