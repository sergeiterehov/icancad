import {
  activeModel,
  applyCommands,
  BODY_COLORS,
  HISTORY_START,
  CommandError,
  createId,
  createModel,
  createProject,
  defaultRevolve,
  dependentFeaturesOf,
  objectName,
  objectVisible,
  sketchObjectId,
  featureBodyId,
  historyInsertIndex,
  isFeatureInHistory,
  isMeshObject,
  nextModelName,
  touch,
  updateActiveModel,
  type BodyEdgeRef,
  type BodyFaceRef,
  type BodyRef,
  type Command,
  type EdgeTreatmentFeature,
  type EdgeTreatmentKind,
  type Feature,
  type ImportMeshFeature,
  type MeshFormat,
  type Model,
  type PrimitiveKind,
  type Project,
  type SectionPlane,
  type SketchFeature,
  type ExtrudeFeature,
  type RevolveAxis,
  type DeleteBodyFeature,
  type ShellFeature,
  type ArrayDirection,
  type ArrayFeature,
  type ArrayPath,
  type ArrayRotationAxis,
  type CameraState,
} from '@icancad/model';
import { sketchTopology } from '@icancad/sketch';
import { useMemo } from 'react';
import { create } from 'zustand';
import { i18n } from '../i18n';
import { MAX_ARRAY_ANGLE, MAX_ARRAY_COPIES } from '../kernel/arrayPlacement';
import { defaultPrimitiveFeature } from '../primitive/params';
import { useKernelStore, isModelRebuilding } from './kernelStore';
import { useUiStore } from './uiStore';

export type SelectionKind =
  'body' | 'mesh' | 'feature' | 'sketch' | 'face' | 'sketch-edge' | 'body-face' | 'edge';

export interface SelectionItem {
  kind: SelectionKind;
  id: string;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface DocumentState {
  project: Project;
  past: Project[];
  future: Project[];
  selection: SelectionItem[];
  hydrated: boolean;
  saveState: SaveState;
  /**
   * Operation whose settings are open. The document keeps the user's cursor;
   * the scene is rendered and rebuilt against the operation's input state
   * instead (see `modelForView`).
   */
  editingFeatureId: string | null;
  /**
   * Operation created in this session that has not been dismissed yet. It is
   * the one that hides the sketches it consumed when its settings close.
   */
  freshFeatureId: string | null;
  /**
   * Open scroll gesture and the document it started from. Its changes alter the
   * document without a history entry. Leaving the field records the value that
   * stays as the one edit of the visit — or nothing when the value came back to
   * where it started, or the edit was cancelled.
   */
  applyGesture: { before: Project } | null;
  /** Opens the gesture when the first wheel notch of a visit arrives. */
  beginWheelGesture: () => void;
  /** Ends the gesture and records it when the document really changed. */
  endApplyGesture: () => void;
  /** Ends the gesture and returns the document to where it started. */
  cancelApplyGesture: () => void;
  apply: (...commands: Command[]) => boolean;
  preview: (...commands: Command[]) => void;
  /** Adds a feature without a history step, for a live handle drag. */
  previewAddFeature: (feature: Feature) => boolean;
  commitPreview: (before: Project) => void;
  undo: () => void;
  redo: () => void;
  hydrate: (project: Project) => void;
  select: (item: SelectionItem | null, options?: { additive?: boolean }) => void;
  /**
   * Replaces the selection with a list of rows, which is what a Shift range in
   * a panel produces. A click that belongs to an open picker is passed on to the
   * picker instead: it takes one row per click.
   */
  selectMany: (items: SelectionItem[], clicked: SelectionItem) => void;
  /**
   * Opens an operation for editing without touching the selection. Used by the
   * sketch editor, which owns the selection itself.
   */
  beginFeatureEdit: (featureId: string) => void;
  /** Ends operation editing, so the model returns to the user's cursor. */
  endFeatureEdit: () => void;
  setSaveState: (state: SaveState) => void;
  addPrimitive: (name: string, kind: PrimitiveKind) => string | null;
  addPrimitiveBox: (name: string) => void;
  addSketch: (name: string, plane: 'XY' | 'XZ' | 'YZ') => string | null;
  addSketchOnFace: (name: string) => string | null;
  addExtrude: (name: string, input?: ExtrudeInput) => string | null;
  addEdgeTreatment: (name: string, input?: EdgeTreatmentInput) => string | null;
  addShell: (name: string, input?: ShellInput) => string | null;
  addArray: (name: string, input?: ArrayInput) => string | null;
  setArrayTarget: (featureId: string, target: ArrayFeature['target']) => void;
  toggleArrayBody: (featureId: string, bodyId: string) => void;
  toggleArrayOperation: (featureId: string, operationId: string) => void;
  addArrayDirection: (featureId: string) => void;
  removeArrayDirection: (featureId: string, index: number) => void;
  setArrayDirectionKind: (
    featureId: string,
    index: number,
    kind: ArrayDirection['kind'],
  ) => void;
  setArrayCount: (featureId: string, index: number, count: number) => void;
  setArraySpacing: (featureId: string, index: number, spacing: number) => void;
  setArrayAngle: (featureId: string, index: number, angle: number) => void;
  setArrayAxis: (featureId: string, index: number, axis: 'x' | 'y' | 'z') => void;
  /** Tilt of a straight direction, in degrees; zero is the axis itself. */
  setArrayTilt: (featureId: string, index: number, angle: number) => void;
  /** Turning around the centre of a picked arc; null takes the world axis back. */
  setArrayAxisArc: (
    featureId: string,
    index: number,
    arc: Extract<ArrayRotationAxis, { kind: 'arc' }> | null,
  ) => void;
  invertArrayDirection: (featureId: string, index: number) => void;
  /** Adds a curve to a path direction, or drops it when it is already there. */
  toggleArrayPath: (featureId: string, index: number, path: ArrayPath) => void;
  setShellDirection: (featureId: string, direction: ShellFeature['direction']) => void;
  setShellThickness: (featureId: string, thickness: number) => void;
  setShellOffset: (featureId: string, offset: number) => void;
  toggleShellBody: (featureId: string, bodyId: string) => void;
  toggleShellFace: (featureId: string, ref: BodyFaceRef) => void;
  setEdgeTreatmentKind: (featureId: string, kind: EdgeTreatmentKind) => void;
  setEdgeTreatmentSize: (featureId: string, size: number) => void;
  toggleEdgeTreatmentFace: (featureId: string, ref: BodyFaceRef) => void;
  toggleEdgeTreatmentEdge: (featureId: string, ref: BodyEdgeRef) => void;
  setExtrudeOp: (featureId: string, op: ExtrudeFeature['op']) => void;
  setExtrudeInput: (featureId: string, input: ExtrudeInput | null) => void;
  toggleExtrudeFace: (featureId: string, sketchId: string, faceId: string) => void;
  toggleExtrudeBodyFace: (
    featureId: string,
    bodyId: string,
    faceId: string,
    normal: [number, number, number],
    origin: [number, number, number],
  ) => void;
  toggleExtrudeBodyTarget: (featureId: string, bodyId: string) => void;
  setExtrudeReversed: (featureId: string, reversed: boolean) => void;
  setExtrudeMethod: (featureId: string, method: ExtrudeFeature['method']) => void;
  setRevolveAxis: (featureId: string, axis: RevolveAxis) => void;
  setRevolveAngles: (featureId: string, angles: { start?: number; end?: number }) => void;
  setRevolveInverted: (featureId: string, inverted: boolean) => void;
  toggleExtrudeSketch: (featureId: string, sketchId: string) => void;
  toggleSketchVisibility: (sketchId: string) => void;
  /** Colour of one or more objects in a single undoable step. */
  setObjectColors: (entries: { objectId: string; color: string }[]) => void;
  /** Visibility of one or more objects in a single undoable step. */
  setObjectsVisible: (entries: { objectId: string; visible: boolean }[]) => void;
  /** Sketches: whether construction geometry is drawn in the 3D view. */
  setConstructionVisible: (sketchId: string, visible: boolean) => void;
  addImportedMesh: (name: string, featureId: string, format: MeshFormat) => void;
  setSectionPlanes: (planes: SectionPlane[]) => void;
  /**
   * Remembers the view a model was last looked from. A camera is not an edit:
   * it never enters the history, and every model keeps its own.
   */
  setModelCamera: (modelId: string, camera: CameraState | null) => void;
  /** Asks what to do with the operations that depend on the removed ones. */
  removeFeatures: (featureIds: string[]) => void;
  confirmRemoveFeature: (featureIds: string[]) => void;
  /** The dialog's "without links" choice: only these operations go away. */
  removeFeaturesOnly: (featureIds: string[]) => void;
  deleteBody: (bodyId: string, name: string) => void;
  /** Deletes the selected objects: bodies become delete operations. */
  deleteObjects: (targets: SelectionItem[]) => void;
  /** Reconciles body refs with the bodies the kernel actually produced. */
  syncCreatedBodies: (bodies: Map<string, string[]>, blockedFeatureId?: string | null) => void;
  renameProject: (name: string) => void;
  /** Adds a model and makes it active; returns its id, or null when it failed. */
  addModel: (name: string) => string | null;
  /** Switches the edited model without an undo step. */
  setActiveModel: (modelId: string) => void;
  renameModel: (modelId: string, name: string) => void;
  /** Asks for confirmation when the model still has objects. */
  deleteModel: (modelId: string) => void;
  /** Confirmed deletion, keeping undo history. */
  removeModel: (modelId: string) => void;
  setHistoryEnd: (featureId: string | null) => void;
  toggleBodyVisibility: (bodyId: string) => void;
}

export interface ExtrudeInput {
  sketchId: string;
  /** Empty means the whole sketch; otherwise the picked faces. */
  regions: string[];
}

/** Edges and faces an edge treatment starts with. */
export interface EdgeTreatmentInput {
  faceRefs?: BodyFaceRef[];
  edgeRefs?: BodyEdgeRef[];
}

/** Bodies and open faces a shell starts with. */
export interface ShellInput {
  bodyIds?: string[];
  faceRefs?: BodyFaceRef[];
}

/** What an array starts with: picked bodies, or operations that made bodies. */
export interface ArrayInput {
  bodyIds?: string[];
  featureIds?: string[];
}

/** Picked objects are keyed so sketch faces and body faces share one order. */
export function sketchFaceKey(sketchId: string, faceId: string): string {
  return `s:${sketchId}#${faceId}`;
}

export function bodyFaceKey(bodyId: string, faceId: string): string {
  return `b:${bodyId}#${faceId}`;
}

function withOrderKey(order: readonly string[] | undefined, key: string, add: boolean): string[] {
  const current: readonly string[] = order ?? [];
  if (!add) return current.filter((candidate) => candidate !== key);
  return current.includes(key) ? [...current] : [...current, key];
}

/** Whether two camera poses are close enough to be the same view. */
function sameCamera(a: CameraState | null, b: CameraState | null): boolean {
  if (!a || !b) return a === b;
  const close = (left: number, right: number) => Math.abs(left - right) < 1e-4;
  return (
    close(a.target[0], b.target[0]) &&
    close(a.target[1], b.target[1]) &&
    close(a.target[2], b.target[2]) &&
    close(a.distance, b.distance) &&
    close(a.azimuth, b.azimuth) &&
    close(a.polar, b.polar) &&
    close(a.roll ?? 0, b.roll ?? 0)
  );
}

const HISTORY_LIMIT = 100;

/**
 * Content of a document without the parts that are bookkeeping rather than an
 * edit: the save timestamp, the active super-object and the camera the user
 * happens to look from.
 */
function projectContent(project: Project): string {
  return JSON.stringify({
    ...project,
    updatedAt: '',
    activeSuperObjectId: '',
    superObjects: project.superObjects.map((superObject) => ({
      ...superObject,
      view: { ...superObject.view, camera: null },
    })),
  });
}

// An operation created while the timeline cursor sits in the middle of the list
// belongs at that position, and the cursor moves onto it so everything after it
// stays rolled back until the user moves forward again.
function addFeatureCommands(model: Model, feature: Feature): Command[] {
  const commands: Command[] = [{ type: 'feature/add', feature, index: historyInsertIndex(model) }];
  if (model.historyEnd !== null) {
    commands.push({ type: 'history/set-end', featureId: feature.id });
  }
  return commands;
}

// Body numbers are kept in the metadata of every body ever created, so a new
// body never reuses the number of an existing one.
export function nextBodyNumber(model: Model): number {
  let highest = 0;
  for (const metadata of Object.values(model.metadata)) {
    if (typeof metadata.bodyIndex === 'number') highest = Math.max(highest, metadata.bodyIndex);
  }
  return highest + 1;
}

function findArrayFeature(model: Model, featureId: string): ArrayFeature | undefined {
  return model.features.find(
    (candidate): candidate is ArrayFeature =>
      candidate.id === featureId && candidate.type === 'array',
  );
}

/** A new direction starts at the step a user is most likely to want. */
function defaultArrayDirection(
  kind: ArrayDirection['kind'],
  count = 3,
): ArrayDirection {
  switch (kind) {
    case 'linear':
      return { kind, direction: [1, 0, 0], spacing: 10, count };
    case 'rotation':
      // A full turn by default: a ring is what a rotation is usually for.
      return { kind, axis: { kind: 'world', axis: 'z' }, angle: 360, inverted: false, count };
    case 'path':
      return { kind, paths: [], count };
  }
}

/** Directions an array may have; each one multiplies the number of copies. */
const MAX_ARRAY_DIRECTIONS = 3;
/** Copies one array may make; matches the rebuild's own ceiling. */
const MAX_ARRAY_POSITIONS = 200;

/** A picked path named by what it points at, so a curve is in the list once. */
export function pathKey(path: ArrayPath): string {
  return path.kind === 'body-edge'
    ? `body:${path.bodyId}#${path.edgeId}`
    : `sketch:${path.sketchId}#${path.entityId}`;
}

function withArrayDirection(
  feature: ArrayFeature,
  index: number,
  direction: ArrayDirection | null,
): ArrayFeature | null {
  if (!feature.directions[index]) return null;
  const directions = [...feature.directions];
  if (direction) directions[index] = direction;
  else directions.splice(index, 1);
  return { ...feature, directions };
}

function replaceArrayFeature(
  featureId: string,
  update: (feature: ArrayFeature) => ArrayFeature | null,
  get: () => DocumentState,
): void {
  const feature = findArrayFeature(activeModel(get().project), featureId);
  if (!feature) return;
  const next = update(feature);
  if (!next) return;
  get().apply({ type: 'feature/replace', feature: next });
}

function exists(model: Model, item: SelectionItem, editingFeatureId: string | null): boolean {
  switch (item.kind) {
    case 'body':
    case 'mesh': {
      const body = model.bodies.find((candidate) => candidate.id === item.id);
      if (!body || !isFeatureInHistory(model, body.createdBy)) return false;
      return item.kind === (isMeshObject(body) ? 'mesh' : 'body');
    }
    case 'feature':
      return item.id === editingFeatureId || isFeatureInHistory(model, item.id);
    case 'sketch':
      return model.features.some(
        (feature) =>
          feature.id === item.id && feature.type === 'sketch' && isFeatureInHistory(model, item.id),
      );
    case 'face': {
      const [sketchId] = item.id.split('#');
      return Boolean(
        sketchId &&
        model.features.some(
          (feature) =>
            feature.id === sketchId &&
            feature.type === 'sketch' &&
            isFeatureInHistory(model, sketchId),
        ),
      );
    }
    case 'sketch-edge': {
      // The curve is only valid while its entity is still in the sketch.
      const separator = item.id.lastIndexOf('#');
      if (separator <= 0) return false;
      const sketchId = item.id.slice(0, separator);
      const entityId = item.id.slice(separator + 1);
      return model.features.some(
        (feature) =>
          feature.id === sketchId &&
          feature.type === 'sketch' &&
          isFeatureInHistory(model, sketchId) &&
          feature.entities.some((entity) => entity.id === entityId),
      );
    }
    case 'body-face':
    case 'edge': {
      // Detail elements live as long as their body does. Which faces and edges
      // a body currently has is only known from its mesh, so the viewport
      // resolves that part and drops stale detail selections there.
      const separator = item.id.lastIndexOf('#');
      if (separator <= 0) return false;
      const bodyId = item.id.slice(0, separator);
      const body = model.bodies.find((candidate) => candidate.id === bodyId);
      return Boolean(body && !isMeshObject(body) && isFeatureInHistory(model, body.createdBy));
    }
  }
}

// The operation being edited is selected while it sits just after the cursor,
// and the bodies it will produce only exist in the preview scene.
function sanitizeSelection(
  model: Model,
  selection: SelectionItem[],
  editingFeatureId: string | null,
): SelectionItem[] {
  const next = selection.filter((item) => exists(model, item, editingFeatureId));
  return next.length === selection.length ? selection : next;
}

function withHistoryEnd(model: Model, historyEnd: string | null): Model {
  return model.historyEnd === historyEnd ? model : { ...model, historyEnd };
}

// A hidden sketch cannot be configured, so it is shown while an operation that
// reads it is open — its own settings, or the extrude built from it. This is a
// view override only: the stored visibility is left alone, so the sketch is
// hidden again once the operation is dismissed.
function withVisibleSketches(model: Model, editingFeatureId: string): Model {
  const feature = model.features.find((candidate) => candidate.id === editingFeatureId);
  if (!feature) return model;
  const sketchIds = new Set<string>();
  if (feature.type === 'sketch') sketchIds.add(feature.id);
  if (feature.type === 'extrude' && feature.sketchId) sketchIds.add(feature.sketchId);
  if (feature.type === 'array') {
    // A path lives in a sketch, so the sketch is shown while the array is open.
    for (const direction of feature.directions) {
      if (direction.kind !== 'path') continue;
      for (const path of direction.paths) {
        if (path.kind === 'sketch-edge') sketchIds.add(path.sketchId);
      }
    }
  }
  let metadata = model.metadata;
  for (const sketchId of sketchIds) {
    const objectId = sketchObjectId(sketchId);
    if (metadata[objectId]?.visible !== false) continue;
    metadata = { ...metadata, [objectId]: { ...metadata[objectId], visible: true } };
  }
  return metadata === model.metadata ? model : { ...model, metadata };
}

/**
 * The sketch an operation consumes completely. Such a sketch is only the input
 * of the operation afterwards, so it hides itself once the operation closes.
 */
function consumedSketchId(feature: Feature, model: Model): string | null {
  if (feature.type !== 'extrude' || feature.suppressed) return null;
  if (feature.faceRefs.length > 0) return null;
  const sketchId = feature.sketchId;
  if (!sketchId) return null;
  if (feature.scope === 'all') return sketchId;
  const sketch = model.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === sketchId && candidate.type === 'sketch',
  );
  if (!sketch) return null;
  const faces = sketchTopology(sketch.entities).faces;
  if (faces.length === 0) return null;
  const regions = new Set(feature.regions);
  return faces.every((face) => regions.has(face.id)) ? sketchId : null;
}

function hideConsumedSketch(model: Model, featureId: string): Model {
  const feature = model.features.find((candidate) => candidate.id === featureId);
  if (!feature) return model;
  const sketchId = consumedSketchId(feature, model);
  if (!sketchId) return model;
  const objectId = sketchObjectId(sketchId);
  if (!objectVisible(model, objectId)) return model;
  return {
    ...model,
    metadata: {
      ...model.metadata,
      [objectId]: { ...model.metadata[objectId], visible: false },
    },
  };
}

/**
 * Dismissing the operation the user has just created hides the sketch it
 * consumes completely: the operation stands for that sketch from now on. An
 * older operation keeps whatever visibility the user gave its inputs, and a
 * failed one has not consumed anything yet, so the sketch stays in view.
 */
function closeFreshEdit(state: DocumentState, project: Project): Partial<DocumentState> {
  const fresh = state.freshFeatureId;
  if (!fresh || state.editingFeatureId !== fresh) return {};
  if (useKernelStore.getState().featureErrors[fresh]) return {};
  const hidden = updateActiveModel(project, (model) => hideConsumedSketch(model, fresh));
  return hidden === project ? { freshFeatureId: null } : { project: hidden, freshFeatureId: null };
}

// An operation is configured against the model that existed when it was
// created, so the cursor it is rendered at is the one in front of it. The
// document keeps the user's cursor untouched: the input position is derived,
// never written back. That keeps the timeline caret where the user left it and
// keeps autosave and project export at the user's position.
export function modelForView(project: Project, editingFeatureId: string | null): Model {
  const model = activeModel(project);
  if (editingFeatureId === null) return model;
  const index = model.features.findIndex((feature) => feature.id === editingFeatureId);
  if (index < 0) return model;
  const inputCursor: string | null =
    index === 0 ? HISTORY_START : (model.features[index - 1]?.id ?? HISTORY_START);
  return withVisibleSketches(withHistoryEnd(model, inputCursor), editingFeatureId);
}

function leaveEditMode(state: DocumentState): Partial<DocumentState> {
  if (state.editingFeatureId === null) return {};
  return { editingFeatureId: null };
}

function editModeFor(
  state: DocumentState,
  project: Project,
  selection: SelectionItem[],
): Partial<DocumentState> {
  // While the sketch editor is open it owns the selection.
  if (useUiStore.getState().activeSketchId) return {};
  const single = selection.length === 1 ? selection[0] : undefined;
  const feature =
    single?.kind === 'feature'
      ? activeModel(project).features.find((candidate) => candidate.id === single.id)
      : undefined;
  const next = feature ? feature.id : null;
  if (next === state.editingFeatureId) return {};
  return { editingFeatureId: next, ...closeFreshEdit(state, project) };
}

// Newly created operations open their settings immediately, exactly like
// selecting one in the timeline.
function selectFeatureForEditing(
  featureId: string,
  set: (update: (state: DocumentState) => Partial<DocumentState>) => void,
): void {
  set((state) => {
    const selection: SelectionItem[] = [{ kind: 'feature', id: featureId }];
    return {
      selection,
      ...editModeFor(state, state.project, selection),
      freshFeatureId: featureId,
    };
  });
}

// Undo, redo and deletions can remove the operation that is being edited.
function reconcileEditMode(
  state: DocumentState,
  project: Project,
  selection: SelectionItem[],
): Partial<DocumentState> {
  // The sketch editor drives the selection itself; an inner selection change
  // must not end sketch editing.
  if (useUiStore.getState().activeSketchId) return {};
  const editing = state.editingFeatureId;
  if (editing === null) return {};
  const stillThere = activeModel(project).features.some((feature) => feature.id === editing);
  if (!stillThere) {
    return { ...leaveEditMode(state), selection: [], ...closeFreshEdit(state, project) };
  }
  const stillSelected = selection.length === 1 && selection[0]?.id === editing;
  if (stillSelected) return {};
  return { ...leaveEditMode(state), ...closeFreshEdit(state, project) };
}

// Undo and redo restore whole-project snapshots, but the user keeps looking at
// the model they switched to: a restore only falls back to the snapshot's model
// when the current one did not exist yet.
function keepActiveModel(project: Project, activeId: string): Project {
  if (project.activeSuperObjectId === activeId) return project;
  if (!project.superObjects.some((superObject) => superObject.id === activeId)) return project;
  return { ...project, activeSuperObjectId: activeId };
}

/**
 * True while an operation waits for the user to pick geometry. Such a picker
 * owns clicks: they feed it instead of changing the selection and ending it.
 */
function openPicker(ui: ReturnType<typeof useUiStore.getState>): boolean {
  return Boolean(
    ui.pickingExtrude ??
      ui.pickingExtrudeBodies ??
      ui.pickingEdges ??
      ui.pickingShellBodies ??
      ui.pickingShellFaces ??
      ui.pickingSketchPlane ??
      ui.pickingSectionFace ??
      ui.pickingArrayBodies ??
      ui.pickingArrayOperations,
  );
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  selection: [],
  hydrated: false,
  saveState: 'idle',
  editingFeatureId: null,
  freshFeatureId: null,
  applyGesture: null,

  beginWheelGesture: () => {
    const state = get();
    if (state.applyGesture) return;
    set({ applyGesture: { before: state.project } });
  },

  endApplyGesture: () => {
    const state = get();
    const gesture = state.applyGesture;
    if (!gesture) return;
    const changed = projectContent(state.project) !== projectContent(gesture.before);
    set({
      applyGesture: null,
      ...(changed
        ? {
            past: [...state.past, gesture.before].slice(-HISTORY_LIMIT),
            future: [],
          }
        : {}),
    });
  },

  cancelApplyGesture: () => {
    const state = get();
    const gesture = state.applyGesture;
    if (!gesture) return;
    const selection = sanitizeSelection(
      modelForView(gesture.before, state.editingFeatureId),
      state.selection,
      state.editingFeatureId,
    );
    set({
      project: gesture.before,
      selection,
      applyGesture: null,
      ...reconcileEditMode(state, gesture.before, selection),
    });
  },

  apply: (...commands) => {
    const state = get();
    try {
      const project = applyCommands(state.project, commands);
      const selection = sanitizeSelection(
        modelForView(project, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      );
      // A scroll changes the document without touching the history: the value
      // that stays when the field is left becomes the one edit of the gesture.
      if (state.applyGesture) {
        set({
          project,
          selection,
          ...reconcileEditMode(state, project, selection),
        });
        return true;
      }
      set({
        project,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: [],
        selection,
        ...reconcileEditMode(state, project, selection),
      });
      return true;
    } catch (error) {
      const code = error instanceof CommandError ? error.code : 'OP_FAILED';
      useUiStore.getState().showToast(`errors.${code}`, 'error');
      return false;
    }
  },

  preview: (...commands) => {
    const state = get();
    try {
      const project = applyCommands(state.project, commands);
      const selection = sanitizeSelection(
        modelForView(project, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      );
      set({
        project,
        selection,
        ...reconcileEditMode(state, project, selection),
      });
    } catch {
      // Preview commands are transient; invalid intermediate geometry is ignored.
    }
  },

  previewAddFeature: (feature) => {
    const state = get();
    try {
      const project = applyCommands(
        state.project,
        addFeatureCommands(activeModel(state.project), feature),
      );
      const selection = sanitizeSelection(
        modelForView(project, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      );
      set({
        project,
        selection,
        ...reconcileEditMode(state, project, selection),
        // A drag creates the operation; its inputs close with its settings.
        freshFeatureId: feature.id,
      });
      return true;
    } catch {
      return false;
    }
  },

  commitPreview: (before) => {
    set((state) => ({
      past: [...state.past, before].slice(-HISTORY_LIMIT),
      future: [],
    }));
  },

  undo: () => {
    get().endApplyGesture();
    const state = get();
    const snapshot = state.past[state.past.length - 1];
    if (!snapshot) return;
    const previous = keepActiveModel(snapshot, state.project.activeSuperObjectId);
    const selection = sanitizeSelection(
      modelForView(previous, state.editingFeatureId),
      state.selection,
      state.editingFeatureId,
    );
    set({
      project: previous,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
      selection,
      applyGesture: null,
      ...reconcileEditMode(state, previous, selection),
    });
  },

  redo: () => {
    get().endApplyGesture();
    const state = get();
    const snapshot = state.future[0];
    if (!snapshot) return;
    const next = keepActiveModel(snapshot, state.project.activeSuperObjectId);
    const selection = sanitizeSelection(
      modelForView(next, state.editingFeatureId),
      state.selection,
      state.editingFeatureId,
    );
    set({
      project: next,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      selection,
      applyGesture: null,
      ...reconcileEditMode(state, next, selection),
    });
  },

  hydrate: (project) => {
    set({
      project,
      past: [],
      future: [],
      selection: [],
      editingFeatureId: null,
      freshFeatureId: null,
      applyGesture: null,
      hydrated: true,
      saveState: 'saved',
    });
  },

  select: (item, options) => {
    // An active picking control owns selection: clicks in the 3D view, the tree
    // or the sketch face list feed that control instead of replacing the
    // selection and closing the control.
    const ui = useUiStore.getState();
    const pickingGeometry = openPicker(ui);
    if (
      pickingGeometry &&
      item &&
      item.kind !== 'feature' &&
      isModelRebuilding(useKernelStore.getState())
    ) {
      ui.showToast('toast.pickAfterRebuild');
      return;
    }
    if (ui.pickingExtrude) {
      if (item?.kind === 'face') {
        const [sketchId, faceId] = item.id.split('#');
        if (sketchId && faceId) get().toggleExtrudeFace(ui.pickingExtrude, sketchId, faceId);
      } else if (item?.kind === 'sketch') {
        // Clicking a sketch in the object tree picks the whole sketch.
        get().toggleExtrudeSketch(ui.pickingExtrude, item.id);
      }
      return;
    }
    if (ui.pickingExtrudeBodies) {
      if (item?.kind === 'body') {
        get().toggleExtrudeBodyTarget(ui.pickingExtrudeBodies, item.id);
      }
      return;
    }
    if (ui.pickingShellBodies) {
      if (item?.kind === 'body') {
        get().toggleShellBody(ui.pickingShellBodies, item.id);
      }
      return;
    }
    if (ui.pickingArrayBodies) {
      if (item?.kind === 'body') get().toggleArrayBody(ui.pickingArrayBodies, item.id);
      return;
    }
    if (ui.pickingArrayOperations) {
      if (item?.kind === 'feature') {
        get().toggleArrayOperation(ui.pickingArrayOperations, item.id);
      } else if (item?.kind === 'body' || item?.kind === 'mesh') {
        // A body stands for the operation that built its current shape, the
        // same answer the 3D view gives when a face of it is clicked.
        const owner = useKernelStore.getState().bodyOperations[item.id];
        if (owner) get().toggleArrayOperation(ui.pickingArrayOperations, owner);
      }
      return;
    }
    // Open faces and treatment edges are picked in the 3D view, so a click
    // elsewhere must not replace the operation being configured.
    if (ui.pickingEdges || ui.pickingShellFaces) return;

    const state = get();
    let selection: SelectionItem[];
    if (!item) {
      selection = [];
    } else if (!options?.additive) {
      selection = [item];
    } else {
      const index = state.selection.findIndex(
        (candidate) => candidate.kind === item.kind && candidate.id === item.id,
      );
      selection =
        index >= 0 ? state.selection.filter((_, i) => i !== index) : [...state.selection, item];
    }
    set({ selection, ...editModeFor(state, state.project, selection) });
  },

  selectMany: (items, clicked) => {
    const ui = useUiStore.getState();
    if (openPicker(ui)) {
      // A picker takes one row per click, so it gets the row that was clicked.
      // Feeding it the whole range would toggle rows it already picked.
      get().select(clicked, { additive: true });
      return;
    }
    const state = get();
    set({ selection: items, ...editModeFor(state, state.project, items) });
  },

  beginFeatureEdit: (featureId) => {
    const state = get();
    const feature = activeModel(state.project).features.find(
      (candidate) => candidate.id === featureId,
    );
    if (!feature || featureId === state.editingFeatureId) return;
    set({ editingFeatureId: featureId, ...closeFreshEdit(state, state.project) });
  },

  endFeatureEdit: () => {
    const state = get();
    if (state.editingFeatureId === null) return;
    set({
      selection: [],
      ...leaveEditMode(state),
      ...closeFreshEdit(state, state.project),
    });
  },

  setSaveState: (saveState) => set({ saveState }),

  addPrimitive: (name, kind) => {
    // Creating an object commits whatever operation was being configured: the
    // new operation belongs at the user's cursor, not in the middle of an edit.
    get().endFeatureEdit();
    const state = get();
    const featureId = createId('feat');
    const feature = defaultPrimitiveFeature(kind, name, featureId);
    const body: BodyRef = { id: featureBodyId(featureId), createdBy: featureId };
    if (
      !state.apply(
        ...addFeatureCommands(activeModel(state.project), feature),
        { type: 'body/add', body },
        {
          type: 'metadata/patch',
          objectId: body.id,
          patch: {
            name,
            color:
              BODY_COLORS[activeModel(state.project).bodies.length % BODY_COLORS.length] ??
              '#6ea8fe',
            visible: true,
          },
        },
      )
    ) {
      return null;
    }
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  addPrimitiveBox: (name) => {
    get().addPrimitive(name, 'box');
  },

  addSketch: (name, plane) => {
    get().endFeatureEdit();
    const featureId = createId('feat');
    const feature: SketchFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'sketch',
      plane: { type: 'datum', plane, offset: 0 },
      entities: [],
      constraints: [],
      references: [],
    };
    if (
      !get().apply(...addFeatureCommands(activeModel(get().project), feature), {
        type: 'metadata/patch',
        objectId: sketchObjectId(featureId),
        patch: { visible: true },
      })
    ) {
      return null;
    }
    set({ selection: [{ kind: 'sketch', id: featureId }] });
    return featureId;
  },

  addSketchOnFace: (name) => {
    get().endFeatureEdit();
    const featureId = createId('feat');
    const feature: SketchFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'sketch',
      plane: { type: 'face' },
      entities: [],
      constraints: [],
      references: [],
    };
    if (
      !get().apply(...addFeatureCommands(activeModel(get().project), feature), {
        type: 'metadata/patch',
        objectId: sketchObjectId(featureId),
        patch: { visible: true },
      })
    ) {
      return null;
    }
    // The face is still missing, so the operation is selected instead of the
    // sketch object; the inspector shows its placement and face picker.
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  // The operation can be created empty and pointed at objects afterwards.
  addExtrude: (name, input) => {
    get().endFeatureEdit();
    const project = get().project;
    if (input) {
      const sketch = activeModel(project).features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === input.sketchId && candidate.type === 'sketch',
      );
      if (!sketch) return null;
    }
    const featureId = createId('feat');
    const hasBodies = activeModel(project).bodies.length > 0;
    const regions = input?.regions ?? [];
    const feature: ExtrudeFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'extrude',
      method: 'extrude',
      ...(input ? { sketchId: input.sketchId } : {}),
      regions,
      faceRefs: [],
      objectOrder: input
        ? regions.length > 0
          ? regions.map((regionId) => sketchFaceKey(input.sketchId, regionId))
          : [`s:${input.sketchId}#*`]
        : [],
      end: 'blind',
      distance: 10,
      reversed: false,
      op: hasBodies ? 'add' : 'new',
      scope: regions.length > 0 ? 'selected' : 'all',
      bodyIds: [],
      joinRegions: true,
    };
    if (!get().apply(...addFeatureCommands(activeModel(project), feature))) return null;
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  // The edge treatment starts from the current selection, like the extrude
  // tool: what is picked becomes the operation's input right away.
  addEdgeTreatment: (name, input) => {
    get().endFeatureEdit();
    const project = get().project;
    const featureId = createId('feat');
    const feature: EdgeTreatmentFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'edge-treatment',
      kind: 'fillet',
      faceRefs: input?.faceRefs ?? [],
      edgeRefs: input?.edgeRefs ?? [],
      size: 1,
    };
    if (!get().apply(...addFeatureCommands(activeModel(project), feature))) return null;
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  setEdgeTreatmentKind: (featureId, kind) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is EdgeTreatmentFeature =>
        candidate.id === featureId && candidate.type === 'edge-treatment',
    );
    if (!feature || feature.kind === kind) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, kind } });
  },

  setEdgeTreatmentSize: (featureId, size) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is EdgeTreatmentFeature =>
        candidate.id === featureId && candidate.type === 'edge-treatment',
    );
    if (!feature || !Number.isFinite(size) || size <= 0) return;
    if (feature.size === size) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, size } });
  },

  toggleEdgeTreatmentFace: (featureId, ref) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is EdgeTreatmentFeature =>
        candidate.id === featureId && candidate.type === 'edge-treatment',
    );
    if (!feature) return;
    const key = `${ref.bodyId}#${ref.faceId}`;
    const exists = feature.faceRefs.some(
      (candidate) => `${candidate.bodyId}#${candidate.faceId}` === key,
    );
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        faceRefs: exists
          ? feature.faceRefs.filter(
              (candidate) => `${candidate.bodyId}#${candidate.faceId}` !== key,
            )
          : [...feature.faceRefs, ref],
      },
    });
  },

  toggleEdgeTreatmentEdge: (featureId, ref) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is EdgeTreatmentFeature =>
        candidate.id === featureId && candidate.type === 'edge-treatment',
    );
    if (!feature) return;
    const key = `${ref.bodyId}#${ref.edgeId}`;
    const exists = feature.edgeRefs.some(
      (candidate) => `${candidate.bodyId}#${candidate.edgeId}` === key,
    );
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        edgeRefs: exists
          ? feature.edgeRefs.filter(
              (candidate) => `${candidate.bodyId}#${candidate.edgeId}` !== key,
            )
          : [...feature.edgeRefs, ref],
      },
    });
  },

  // The operation starts from the current selection, like the extrude and the
  // edge treatment: picked bodies and faces become its input right away.
  addShell: (name, input) => {
    get().endFeatureEdit();
    const bodyIds = [...new Set(input?.bodyIds ?? [])];
    const faceRefs = input?.faceRefs ?? [];
    for (const ref of faceRefs) {
      if (!bodyIds.includes(ref.bodyId)) bodyIds.push(ref.bodyId);
    }
    const featureId = createId('feat');
    const feature: ShellFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'shell',
      bodyIds,
      removeFaces: faceRefs,
      thickness: 2,
      offset: 0,
      direction: 'inward',
    };
    if (!get().apply(...addFeatureCommands(activeModel(get().project), feature))) return null;
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  setShellDirection: (featureId, direction) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ShellFeature =>
        candidate.id === featureId && candidate.type === 'shell',
    );
    if (!feature || feature.direction === direction) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, direction } });
  },

  setShellThickness: (featureId, thickness) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ShellFeature =>
        candidate.id === featureId && candidate.type === 'shell',
    );
    if (!feature || !Number.isFinite(thickness) || thickness <= 0) return;
    if (feature.thickness === thickness) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, thickness } });
  },

  setShellOffset: (featureId, offset) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ShellFeature =>
        candidate.id === featureId && candidate.type === 'shell',
    );
    if (!feature || !Number.isFinite(offset) || offset < 0) return;
    if ((feature.offset ?? 0) === offset) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, offset } });
  },

  toggleShellBody: (featureId, bodyId) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ShellFeature =>
        candidate.id === featureId && candidate.type === 'shell',
    );
    if (!feature) return;
    const exists = feature.bodyIds.includes(bodyId);
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        bodyIds: exists
          ? feature.bodyIds.filter((candidate) => candidate !== bodyId)
          : [...feature.bodyIds, bodyId],
        // Removing the body removes the openings that only made sense with it.
        removeFaces: exists
          ? feature.removeFaces.filter((ref) => ref.bodyId !== bodyId)
          : feature.removeFaces,
      },
    });
  },

  toggleShellFace: (featureId, ref) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ShellFeature =>
        candidate.id === featureId && candidate.type === 'shell',
    );
    if (!feature) return;
    const key = `${ref.bodyId}#${ref.faceId}`;
    const exists = feature.removeFaces.some(
      (candidate) => `${candidate.bodyId}#${candidate.faceId}` === key,
    );
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        bodyIds:
          !exists && !feature.bodyIds.includes(ref.bodyId)
            ? [...feature.bodyIds, ref.bodyId]
            : feature.bodyIds,
        removeFaces: exists
          ? feature.removeFaces.filter(
              (candidate) => `${candidate.bodyId}#${candidate.faceId}` !== key,
            )
          : [...feature.removeFaces, ref],
      },
    });
  },

  // The array starts from the current selection: picked bodies, or picked
  // operations whose created bodies are repeated.
  addArray: (name, input) => {
    get().endFeatureEdit();
    const featureId = createId('feat');
    const featureIds = [...new Set(input?.featureIds ?? [])];
    const bodyIds = [...new Set(input?.bodyIds ?? [])];
    // Repeating picked bodies is the only case that starts on bodies; every
    // other array starts on geometry, which is what the feature is for.
    const target = bodyIds.length > 0 && featureIds.length === 0 ? 'bodies' : 'geometry';
    const feature: ArrayFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'array',
      target,
      bodyIds,
      featureIds,
      directions: [defaultArrayDirection('linear')],
    };
    if (!get().apply(...addFeatureCommands(activeModel(get().project), feature))) return null;
    selectFeatureForEditing(featureId, set);
    // A new array opens asking for what it repeats: the picker is part of
    // creating the operation, not of editing it later.
    const ui = useUiStore.getState();
    if (target === 'geometry') ui.setPickingArrayOperations(featureId);
    else ui.setPickingArrayBodies(featureId);
    return featureId;
  },

  setArrayTarget: (featureId, target) => {
    replaceArrayFeature(
      featureId,
      (feature) => (feature.target === target ? null : { ...feature, target }),
      get,
    );
  },

  toggleArrayBody: (featureId, bodyId) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const exists = feature.bodyIds.includes(bodyId);
        return {
          ...feature,
          target: 'bodies',
          bodyIds: exists
            ? feature.bodyIds.filter((candidate) => candidate !== bodyId)
            : [...feature.bodyIds, bodyId],
        };
      },
      get,
    );
  },

  toggleArrayOperation: (featureId, operationId) => {
    // Every operation that builds or changes a body can be repeated: the
    // rebuild replays what it did, so this only has to reject operations with
    // no solid result at all.
    // An array cannot repeat itself, and it cannot depend on an operation that
    // comes after it in the history.
    if (operationId === featureId) return;
    const model = activeModel(get().project);
    const arrayIndex = model.features.findIndex((candidate) => candidate.id === featureId);
    const operationIndex = model.features.findIndex((candidate) => candidate.id === operationId);
    if (operationIndex < 0) {
      // The operation is gone, so the reference can only be removed: a row that
      // names something that no longer exists is still a row the user can drop.
      replaceArrayFeature(
        featureId,
        (feature) =>
          feature.featureIds.includes(operationId)
            ? { ...feature, featureIds: feature.featureIds.filter((id) => id !== operationId) }
            : null,
        get,
      );
      return;
    }
    if (arrayIndex >= 0 && operationIndex >= arrayIndex) return;
    const operation = model.features[operationIndex];
    if (!operation) return;
    if (
      operation.type === 'sketch' ||
      operation.type === 'import-mesh' ||
      operation.type === 'delete-body'
    ) {
      return;
    }
    replaceArrayFeature(
      featureId,
      (feature) => {
        const exists = feature.featureIds.includes(operationId);
        return {
          ...feature,
          target: 'geometry',
          featureIds: exists
            ? feature.featureIds.filter((candidate) => candidate !== operationId)
            : [...feature.featureIds, operationId],
        };
      },
      get,
    );
  },

  addArrayDirection: (featureId) => {
    replaceArrayFeature(
      featureId,
      (feature) =>
        feature.directions.length >= MAX_ARRAY_DIRECTIONS
          ? null
          : { ...feature, directions: [...feature.directions, defaultArrayDirection('linear')] },
      get,
    );
  },

  removeArrayDirection: (featureId, index) => {
    replaceArrayFeature(featureId, (feature) => withArrayDirection(feature, index, null), get);
  },

  setArrayDirectionKind: (featureId, index, kind) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind === kind) return null;
        // Switching the kind keeps the count the user already picked.
        return withArrayDirection(feature, index, defaultArrayDirection(kind, current.count));
      },
      get,
    );
  },

  setArrayCount: (featureId, index, count) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || !Number.isFinite(count)) return null;
        // Keep the product of all directions inside the rebuild's ceiling.
        const others = feature.directions
          .filter((_, position) => position !== index)
          .reduce((total, direction) => total * Math.max(1, direction.count), 1);
        const ceiling = Math.max(
          1,
          Math.min(MAX_ARRAY_COPIES, Math.floor(MAX_ARRAY_POSITIONS / others)),
        );
        const next = Math.max(1, Math.min(ceiling, Math.floor(count)));
        if (next === current.count) return null;
        return withArrayDirection(feature, index, { ...current, count: next });
      },
      get,
    );
  },

  setArraySpacing: (featureId, index, spacing) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind !== 'linear') return null;
        if (!Number.isFinite(spacing) || spacing === current.spacing) return null;
        return withArrayDirection(feature, index, { ...current, spacing });
      },
      get,
    );
  },

  setArrayAngle: (featureId, index, angle) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind !== 'rotation') return null;
        // The span of a turn is 0…360 and never signed: which way the copies
        // go is `inverted`, so the field cannot show a minus sign.
        const next = Math.max(0, Math.min(MAX_ARRAY_ANGLE, Math.round(Math.abs(angle) * 10) / 10));
        if (!Number.isFinite(angle) || next === current.angle) return null;
        return withArrayDirection(feature, index, { ...current, angle: next });
      },
      get,
    );
  },

  setArrayAxis: (featureId, index, axis) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current) return null;
        if (current.kind === 'linear') {
          const direction: [number, number, number] =
            axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
          return withArrayDirection(feature, index, { ...current, direction });
        }
        if (current.kind === 'rotation') {
          return withArrayDirection(feature, index, {
            ...current,
            axis: { kind: 'world', axis },
          });
        }
        return null;
      },
      get,
    );
  },

  setArrayTilt: (featureId, index, angle) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind !== 'linear' || !Number.isFinite(angle)) return null;
        // Past half a turn the same row comes back the other way, so the field
        // keeps the short way round.
        const next = Math.max(-180, Math.min(180, Math.round(angle * 10) / 10));
        if ((current.angle ?? 0) === next) return null;
        return withArrayDirection(feature, index, { ...current, angle: next });
      },
      get,
    );
  },

  setArrayAxisArc: (featureId, index, arc) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind !== 'rotation') return null;
        if (!arc) return withArrayDirection(feature, index, {
          ...current,
          axis: { kind: 'world', axis: 'z' },
        });
        return withArrayDirection(feature, index, { ...current, axis: arc });
      },
      get,
    );
  },

  invertArrayDirection: (featureId, index) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind === 'path') return null;
        if (current.kind === 'linear') {
          const [x, y, z] = current.direction;
          return withArrayDirection(feature, index, { ...current, direction: [-x, -y, -z] });
        }
        return withArrayDirection(feature, index, {
          ...current,
          inverted: !current.inverted,
        });
      },
      get,
    );
  },

  toggleArrayPath: (featureId, index, path) => {
    replaceArrayFeature(
      featureId,
      (feature) => {
        const current = feature.directions[index];
        if (!current || current.kind !== 'path') return null;
        const key = pathKey(path);
        const exists = current.paths.some((candidate) => pathKey(candidate) === key);
        return withArrayDirection(feature, index, {
          ...current,
          paths: exists
            ? current.paths.filter((candidate) => pathKey(candidate) !== key)
            : [...current.paths, path],
        });
      },
      get,
    );
  },

  setExtrudeInput: (featureId, input) => {
    const project = get().project;
    const feature = activeModel(project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const regions = input?.regions ?? [];
    const sketchKeys = input
      ? regions.length > 0
        ? regions.map((regionId) => sketchFaceKey(input.sketchId, regionId))
        : [`s:${input.sketchId}#*`]
      : [];
    const next: ExtrudeFeature = {
      ...feature,
      ...(input ? { sketchId: input.sketchId } : { sketchId: undefined }),
      regions,
      scope: regions.length > 0 ? 'selected' : 'all',
      objectOrder: [
        ...(feature.objectOrder ?? []).filter((key) => !key.startsWith('s:')),
        ...sketchKeys,
      ],
    };
    get().apply({ type: 'feature/replace', feature: next });
  },

  toggleExtrudeFace: (featureId, sketchId, faceId) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const sameSketch = feature.sketchId === sketchId;
    const regions = sameSketch && feature.scope === 'selected' ? feature.regions : [];
    const key = sketchFaceKey(sketchId, faceId);
    const adding = !regions.includes(faceId);
    const next = adding ? [...regions, faceId] : regions.filter((id) => id !== faceId);
    let order = (feature.objectOrder ?? []).filter(
      (candidate) => sameSketch || !candidate.startsWith('s:'),
    );
    if (next.length === 0) order = order.filter((candidate) => !candidate.startsWith('s:'));
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        ...(next.length > 0
          ? { sketchId, regions: next, scope: 'selected' as const }
          : { sketchId: undefined, regions: [], scope: 'all' as const }),
        objectOrder: withOrderKey(order, key, adding),
      },
    });
  },

  toggleExtrudeBodyFace: (featureId, bodyId, faceId, normal, origin) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const refs = feature.faceRefs ?? [];
    const exists = refs.some((ref) => ref.bodyId === bodyId && ref.faceId === faceId);
    const faceRefs = exists
      ? refs.filter((ref) => !(ref.bodyId === bodyId && ref.faceId === faceId))
      : [...refs, { bodyId, faceId, normal, origin }];
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        faceRefs,
        objectOrder: withOrderKey(feature.objectOrder, bodyFaceKey(bodyId, faceId), !exists),
      },
    });
  },

  toggleExtrudeBodyTarget: (featureId, bodyId) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const bodyIds = feature.bodyIds.includes(bodyId)
      ? feature.bodyIds.filter((id) => id !== bodyId)
      : [...feature.bodyIds, bodyId];
    get().apply({ type: 'feature/replace', feature: { ...feature, bodyIds } });
  },

  setExtrudeReversed: (featureId, reversed) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, reversed } });
  },

  setExtrudeMethod: (featureId, method) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature || feature.method === method) return;
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        method,
        // A revolve keeps its axis between visits, so switching back and forth
        // never loses what the user picked.
        revolve: method === 'revolve' ? (feature.revolve ?? defaultRevolve()) : feature.revolve,
      },
    });
  },

  setRevolveAxis: (featureId, axis) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const revolve = feature.revolve ?? defaultRevolve();
    get().apply({
      type: 'feature/replace',
      feature: { ...feature, revolve: { ...revolve, axis } },
    });
  },

  setRevolveAngles: (featureId, angles) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const revolve = feature.revolve ?? defaultRevolve();
    get().apply({
      type: 'feature/replace',
      feature: {
        ...feature,
        revolve: {
          ...revolve,
          start: angles.start ?? revolve.start,
          end: angles.end ?? revolve.end,
        },
      },
    });
  },

  setRevolveInverted: (featureId, inverted) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const revolve = feature.revolve ?? defaultRevolve();
    get().apply({
      type: 'feature/replace',
      feature: { ...feature, revolve: { ...revolve, inverted } },
    });
  },

  toggleExtrudeSketch: (featureId, sketchId) => {
    const feature = activeModel(get().project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const wholeSketch = feature.sketchId === sketchId && feature.scope === 'all';
    get().setExtrudeInput(featureId, wholeSketch ? null : { sketchId, regions: [] });
  },

  // A body exists only while the extrude creates one: switching to a boolean
  // operation removes the ref, switching back restores it with the same id.
  setExtrudeOp: (featureId, op) => {
    const project = get().project;
    const feature = activeModel(project).features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature || feature.op === op) return;
    // Through-all cannot create or add material. Both extents fall back to a
    // blind distance when the operation changes, because their controls hide.
    const allowsThroughAll = op === 'subtract' || op === 'intersect';
    const end = !allowsThroughAll && feature.end === 'through-all' ? 'blind' : feature.end;
    const secondDirection =
      feature.secondDirection && !allowsThroughAll && feature.secondDirection.end === 'through-all'
        ? { ...feature.secondDirection, end: 'blind' as const }
        : feature.secondDirection;
    get().apply({
      type: 'feature/replace',
      feature: { ...feature, op, end, secondDirection },
    });
  },

  addImportedMesh: (name, featureId, format) => {
    get().endFeatureEdit();
    const state = get();
    const feature: ImportMeshFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'import-mesh',
      assetId: featureId,
      format,
      transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      scale: 1,
    };
    const body: BodyRef = { id: featureBodyId(featureId), createdBy: featureId, kind: 'mesh' };
    if (
      state.apply(
        ...addFeatureCommands(activeModel(state.project), feature),
        { type: 'body/add', body },
        {
          type: 'metadata/patch',
          objectId: body.id,
          patch: {
            name,
            color:
              BODY_COLORS[
                activeModel(state.project).bodies.filter((candidate) => !isMeshObject(candidate))
                  .length % BODY_COLORS.length
              ] ?? '#6ea8fe',
            visible: true,
          },
        },
      )
    ) {
      selectFeatureForEditing(featureId, set);
    }
  },

  toggleSketchVisibility: (sketchId) => {
    const state = get();
    const feature = activeModel(state.project).features.find(
      (candidate): candidate is SketchFeature =>
        candidate.id === sketchId && candidate.type === 'sketch',
    );
    if (!feature) return;
    const objectId = sketchObjectId(sketchId);
    // The eye follows what is on screen, so a sketch that is only shown because
    // its operation is open hides again when the user asks for it.
    const shown = objectVisible(modelForView(state.project, state.editingFeatureId), objectId);
    get().apply({ type: 'metadata/patch', objectId, patch: { visible: !shown } });
  },

  setModelCamera: (modelId, camera) => {
    const project = get().project;
    const model = project.superObjects.find((candidate) => candidate.id === modelId);
    if (!model) return;
    if (sameCamera(model.view.camera, camera)) return;
    set({
      project: touch({
        ...project,
        superObjects: project.superObjects.map((candidate) =>
          candidate.id === modelId
            ? { ...candidate, view: { ...candidate.view, camera } }
            : candidate,
        ),
      }),
    });
  },

  setSectionPlanes: (planes) => {
    const project = get().project;
    set({
      project: updateActiveModel(project, (model) => ({
        ...model,
        view: { ...model.view, sectionPlanes: planes },
      })),
    });
  },

  removeFeatures: (featureIds) => {
    const project = get().project;
    const selected = new Set(featureIds);
    const features = activeModel(project).features.filter((candidate) =>
      selected.has(candidate.id),
    );
    if (features.length === 0) return;
    const dependents = dependentFeaturesOf(activeModel(project), featureIds);
    if (dependents.length > 0) {
      useUiStore.getState().requestDelete({
        featureIds: features.map((feature) => feature.id),
        name: features[0]!.name,
        dependents,
      });
      return;
    }
    get().confirmRemoveFeature(features.map((feature) => feature.id));
  },

  confirmRemoveFeature: (featureIds) => {
    const project = get().project;
    // Dependents of the whole set, so a chain that only survives one of the
    // deleted operations goes as well.
    const dependents = dependentFeaturesOf(activeModel(project), featureIds);
    const ids = [...new Set([...featureIds, ...dependents.map((entry) => entry.id)])];
    if (!get().apply(...ids.map((id) => ({ type: 'feature/remove' as const, featureId: id })))) {
      return;
    }
    useUiStore.getState().cancelDelete();
    useUiStore.getState().showToast('toast.featureDeleted');
  },

  // The dependents stay in the timeline and fail to build until they are
  // pointed at new input or deleted, which is the point of the choice.
  removeFeaturesOnly: (featureIds) => {
    if (
      !get().apply(
        ...featureIds.map((id) => ({
          type: 'feature/remove' as const,
          featureId: id,
          keepDependents: true,
        })),
      )
    ) {
      return;
    }
    useUiStore.getState().cancelDelete();
    useUiStore.getState().showToast('toast.featureDeleted');
  },
  // Deleting an object is itself an operation: the body disappears from this
  // point in the timeline while its creating operation stays editable.
  deleteBody: (bodyId, name) => {
    get().endFeatureEdit();
    const body = activeModel(get().project).bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    const feature: DeleteBodyFeature = {
      id: createId('feat'),
      name,
      suppressed: false,
      type: 'delete-body',
      bodyId,
    };
    get().apply(...addFeatureCommands(activeModel(get().project), feature));
  },

  // Deleting a mixed selection is two kinds of edit: bodies disappear through
  // delete operations of their own, sketch objects take the operations that
  // depend on them with them.
  deleteObjects: (targets) => {
    const state = get();
    const project = state.project;
    const bodyIds: string[] = [];
    const featureIds: string[] = [];
    for (const target of targets) {
      if (target.kind === 'body' || target.kind === 'mesh') {
        if (activeModel(project).bodies.some((body) => body.id === target.id))
          bodyIds.push(target.id);
      } else if (target.kind === 'sketch') {
        if (activeModel(project).features.some((feature) => feature.id === target.id)) {
          featureIds.push(target.id);
        }
      }
    }
    if (bodyIds.length === 0 && featureIds.length === 0) return;
    if (bodyIds.length > 0) {
      get().endFeatureEdit();
      const commands: Command[] = [];
      let current = get().project;
      for (const bodyId of bodyIds) {
        const model = activeModel(current);
        const body = model.bodies.find((candidate) => candidate.id === bodyId);
        if (!body) continue;
        const feature: DeleteBodyFeature = {
          id: createId('feat'),
          name: objectName(model, bodyId, 'Body'),
          suppressed: false,
          type: 'delete-body',
          bodyId,
        };
        const batch = addFeatureCommands(model, feature);
        commands.push(...batch);
        current = applyCommands(current, batch);
      }
      get().apply(...commands);
    }
    if (featureIds.length > 0) get().removeFeatures(featureIds);
  },

  // Bodies are objects derived from the geometry an operation produced (ADR
  // 0007): the kernel reports them and the document only keeps the refs, so the
  // reconciliation is not an undoable edit of its own.
  syncCreatedBodies: (created, blockedFeatureId = null) => {
    const state = get();
    const project = state.project;
    const commands: Command[] = [];
    const removals = new Set<string>();
    // Rebuild stops at the first failure, so bodies owned by that operation and
    // by everything after it no longer exist.
    const blockedIndex = blockedFeatureId
      ? activeModel(project).features.findIndex((feature) => feature.id === blockedFeatureId)
      : -1;
    const featureIndices = new Map(
      activeModel(project).features.map((feature, index) => [feature.id, index]),
    );
    const staleBodies = new Set(
      blockedIndex >= 0
        ? activeModel(project)
            .bodies.filter((body) => (featureIndices.get(body.createdBy) ?? -1) >= blockedIndex)
            .map((body) => body.id)
        : [],
    );
    // Numbers and colours continue the project-wide sequence instead of
    // restarting for every operation.
    let nextNumber = nextBodyNumber(activeModel(project));
    let existingCount = activeModel(project).bodies.filter((body) => !isMeshObject(body)).length;
    for (const [featureId, bodyIds] of created) {
      const feature = activeModel(project).features.find((candidate) => candidate.id === featureId);
      if (!feature) continue;
      const existing = activeModel(project).bodies.filter((body) => body.createdBy === featureId);
      for (const bodyId of bodyIds) {
        if (existing.some((body) => body.id === bodyId)) continue;
        commands.push({ type: 'body/add', body: { id: bodyId, createdBy: featureId } });
        // A body that comes back keeps the properties it had before.
        if (activeModel(project).metadata[bodyId]) continue;
        commands.push({
          type: 'metadata/patch',
          objectId: bodyId,
          patch: {
            name: `${i18n.t('inspector.body')} ${nextNumber}`,
            bodyIndex: nextNumber,
            color: BODY_COLORS[existingCount % BODY_COLORS.length] ?? '#6ea8fe',
            visible: true,
          },
        });
        nextNumber += 1;
        existingCount += 1;
      }
      for (const body of existing) {
        if (bodyIds.includes(body.id) || staleBodies.has(body.id)) continue;
        commands.push({ type: 'body/remove', bodyId: body.id });
        removals.add(body.id);
      }
    }
    for (const bodyId of staleBodies) {
      if (removals.has(bodyId)) continue;
      commands.push({ type: 'body/remove', bodyId });
      removals.add(bodyId);
    }
    if (commands.length === 0) return;
    let next: Project;
    try {
      next = applyCommands(project, commands);
    } catch {
      return;
    }
    set({
      project: next,
      selection: sanitizeSelection(
        modelForView(next, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      ),
    });
  },

  renameProject: (name) => {
    get().apply({ type: 'project/rename', name });
  },

  addModel: (baseName) => {
    const state = get();
    const model = createModel(nextModelName(state.project, baseName));
    if (!state.apply({ type: 'model/add', model }, { type: 'model/activate', modelId: model.id })) {
      return null;
    }
    const ui = useUiStore.getState();
    ui.endPicking();
    ui.setActiveSketch(null);
    useKernelStore.getState().clearScene();
    set({ selection: [], editingFeatureId: null, freshFeatureId: null, applyGesture: null });
    return model.id;
  },

  setActiveModel: (modelId) => {
    const state = get();
    if (state.project.activeSuperObjectId === modelId) return;
    if (!state.project.superObjects.some((superObject) => superObject.id === modelId)) return;
    const ui = useUiStore.getState();
    ui.endPicking();
    ui.setActiveSketch(null);
    useKernelStore.getState().clearScene();
    const cleanup = closeFreshEdit(state, state.project);
    set({
      project: touch({
        ...(cleanup.project ?? state.project),
        activeSuperObjectId: modelId,
      }),
      selection: [],
      editingFeatureId: null,
      freshFeatureId: null,
      applyGesture: null,
    });
  },

  renameModel: (modelId, name) => {
    get().apply({ type: 'model/rename', modelId, name });
  },

  deleteModel: (modelId) => {
    const project = get().project;
    const model = project.superObjects.find((superObject) => superObject.id === modelId);
    if (!model) return;
    if (project.superObjects.length === 1) {
      useUiStore.getState().showToast('errors.LAST_MODEL', 'error');
      return;
    }
    if (model.features.length === 0 && model.bodies.length === 0) {
      get().removeModel(modelId);
      return;
    }
    useUiStore.getState().requestModelDelete({ id: model.id, name: model.name });
  },

  removeModel: (modelId) => {
    const state = get();
    const wasActive = state.project.activeSuperObjectId === modelId;
    if (!state.apply({ type: 'model/remove', modelId })) return;
    if (!wasActive) return;
    const ui = useUiStore.getState();
    ui.endPicking();
    ui.setActiveSketch(null);
    useKernelStore.getState().clearScene();
    set({ selection: [], editingFeatureId: null, freshFeatureId: null, applyGesture: null });
  },

  // Moving the cursor is an explicit navigation action: it ends operation
  // editing and places the cursor where the user asked.
  setHistoryEnd: (featureId) => {
    if (get().editingFeatureId !== null) set({ editingFeatureId: null });
    get().apply({ type: 'history/set-end', featureId });
  },

  setObjectColors: (entries) => {
    if (entries.length === 0) return;
    get().apply(
      ...entries.map((entry): Command => ({
        type: 'metadata/patch',
        objectId: entry.objectId,
        patch: { color: entry.color },
      })),
    );
  },

  setObjectsVisible: (entries) => {
    if (entries.length === 0) return;
    get().apply(
      ...entries.map((entry): Command => ({
        type: 'metadata/patch',
        objectId: entry.objectId,
        patch: { visible: entry.visible },
      })),
    );
  },

  setConstructionVisible: (sketchId, visible) => {
    get().apply({
      type: 'metadata/patch',
      objectId: sketchObjectId(sketchId),
      patch: { showConstruction: visible },
    });
  },

  toggleBodyVisibility: (bodyId) => {
    const model = activeModel(get().project);
    const body = model.bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    get().apply({
      type: 'metadata/patch',
      objectId: bodyId,
      patch: { visible: !objectVisible(model, bodyId) },
    });
  },
}));

/**
 * The active model with the history cursor placed at the input state of the
 * operation whose settings are open. Everything that draws or reports the model
 * reads this, while the document itself keeps the user's cursor.
 */
export function useViewModel(): Model {
  const project = useDocumentStore((state) => state.project);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  return useMemo(() => modelForView(project, editingFeatureId), [project, editingFeatureId]);
}
