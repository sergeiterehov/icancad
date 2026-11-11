import {
  applyCommands,
  BODY_COLORS,
  HISTORY_START,
  CommandError,
  createId,
  createProject,
  dependentFeaturesOf,
  objectName,
  objectVisible,
  sketchObjectId,
  featureBodyId,
  historyInsertIndex,
  isFeatureInHistory,
  isMeshObject,
  type BodyRef,
  type Command,
  type Feature,
  type ImportMeshFeature,
  type MeshFormat,
  type PrimitiveFeature,
  type Project,
  type SectionPlane,
  type SketchFeature,
  type ExtrudeFeature,
  type DeleteBodyFeature,
} from '@icancad/model';
import { useMemo } from 'react';
import { create } from 'zustand';
import { i18n } from '../i18n';
import { useKernelStore, isModelRebuilding } from './kernelStore';
import { useUiStore } from './uiStore';

export type SelectionKind = 'body' | 'mesh' | 'feature' | 'sketch' | 'face';

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
   * instead (see `projectForView`).
   */
  editingFeatureId: string | null;
  apply: (...commands: Command[]) => boolean;
  preview: (...commands: Command[]) => void;
  commitPreview: (before: Project) => void;
  undo: () => void;
  redo: () => void;
  hydrate: (project: Project) => void;
  select: (item: SelectionItem | null, options?: { additive?: boolean }) => void;
  /**
   * Opens an operation for editing without touching the selection. Used by the
   * sketch editor, which owns the selection itself.
   */
  beginFeatureEdit: (featureId: string) => void;
  /** Ends operation editing, so the model returns to the user's cursor. */
  endFeatureEdit: () => void;
  setSaveState: (state: SaveState) => void;
  addPrimitiveBox: (name: string) => void;
  addSketch: (name: string, plane: 'XY' | 'XZ' | 'YZ') => string | null;
  addSketchOnFace: (name: string) => string | null;
  addExtrude: (name: string, input?: ExtrudeInput) => string | null;
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
  /** Removes operations together with everything that depends on them. */
  removeFeature: (featureId: string) => void;
  removeFeatures: (featureIds: string[]) => void;
  confirmRemoveFeature: (featureIds: string[]) => void;
  deleteBody: (bodyId: string, name: string) => void;
  /** Deletes the selected objects: bodies become delete operations. */
  deleteObjects: (targets: SelectionItem[]) => void;
  /** Reconciles body refs with the bodies the kernel actually produced. */
  syncCreatedBodies: (bodies: Map<string, string[]>, blockedFeatureId?: string | null) => void;
  renameProject: (name: string) => void;
  setHistoryEnd: (featureId: string | null) => void;
  toggleBodyVisibility: (bodyId: string) => void;
}

export interface ExtrudeInput {
  sketchId: string;
  /** Empty means the whole sketch; otherwise the picked faces. */
  regions: string[];
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

const HISTORY_LIMIT = 100;

// An operation created while the timeline cursor sits in the middle of the list
// belongs at that position, and the cursor moves onto it so everything after it
// stays rolled back until the user moves forward again.
function addFeatureCommands(project: Project, feature: Feature): Command[] {
  const commands: Command[] = [
    { type: 'feature/add', feature, index: historyInsertIndex(project) },
  ];
  if (project.historyEnd !== null) {
    commands.push({ type: 'history/set-end', featureId: feature.id });
  }
  return commands;
}

// Body numbers are kept in the metadata of every body ever created, so a new
// body never reuses the number of an existing one.
export function nextBodyNumber(project: Project): number {
  let highest = 0;
  for (const metadata of Object.values(project.metadata)) {
    if (typeof metadata.bodyIndex === 'number') highest = Math.max(highest, metadata.bodyIndex);
  }
  return highest + 1;
}

function exists(project: Project, item: SelectionItem, editingFeatureId: string | null): boolean {
  switch (item.kind) {
    case 'body':
    case 'mesh': {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      if (!body || !isFeatureInHistory(project, body.createdBy)) return false;
      return item.kind === (isMeshObject(body) ? 'mesh' : 'body');
    }
    case 'feature':
      return item.id === editingFeatureId || isFeatureInHistory(project, item.id);
    case 'sketch':
      return project.features.some(
        (feature) =>
          feature.id === item.id &&
          feature.type === 'sketch' &&
          isFeatureInHistory(project, item.id),
      );
    case 'face': {
      const [sketchId] = item.id.split('#');
      return Boolean(
        sketchId &&
        project.features.some(
          (feature) =>
            feature.id === sketchId &&
            feature.type === 'sketch' &&
            isFeatureInHistory(project, sketchId),
        ),
      );
    }
  }
}

// The operation being edited is selected while it sits just after the cursor,
// and the bodies it will produce only exist in the preview scene.
function sanitizeSelection(
  project: Project,
  selection: SelectionItem[],
  editingFeatureId: string | null,
): SelectionItem[] {
  const next = selection.filter((item) => exists(project, item, editingFeatureId));
  return next.length === selection.length ? selection : next;
}

function withHistoryEnd(project: Project, historyEnd: string | null): Project {
  return project.historyEnd === historyEnd ? project : { ...project, historyEnd };
}

// A hidden sketch cannot be configured, so it is shown while its operation is
// open. This is a view override only: the stored visibility is left alone, so
// the sketch is hidden again once the operation is dismissed.
function withVisibleSketch(project: Project, editingFeatureId: string): Project {
  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === editingFeatureId && candidate.type === 'sketch',
  );
  if (!feature) return project;
  const objectId = sketchObjectId(feature.id);
  if (objectVisible(project, objectId)) return project;
  return {
    ...project,
    metadata: {
      ...project.metadata,
      [objectId]: { ...project.metadata[objectId], visible: true },
    },
  };
}

// An operation is configured against the model that existed when it was
// created, so the cursor it is rendered at is the one in front of it. The
// document keeps the user's cursor untouched: the input position is derived,
// never written back. That keeps the timeline caret where the user left it and
// keeps autosave and project export at the user's position.
export function projectForView(project: Project, editingFeatureId: string | null): Project {
  if (editingFeatureId === null) return project;
  const index = project.features.findIndex((feature) => feature.id === editingFeatureId);
  if (index < 0) return project;
  const inputCursor: string | null =
    index === 0 ? HISTORY_START : (project.features[index - 1]?.id ?? HISTORY_START);
  return withVisibleSketch(withHistoryEnd(project, inputCursor), editingFeatureId);
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
      ? project.features.find((candidate) => candidate.id === single.id)
      : undefined;
  return { editingFeatureId: feature ? feature.id : null };
}

// Newly created operations open their settings immediately, exactly like
// selecting one in the timeline.
function selectFeatureForEditing(
  featureId: string,
  set: (update: (state: DocumentState) => Partial<DocumentState>) => void,
): void {
  set((state) => {
    const selection: SelectionItem[] = [{ kind: 'feature', id: featureId }];
    return { selection, ...editModeFor(state, state.project, selection) };
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
  const stillThere = project.features.some((feature) => feature.id === editing);
  if (!stillThere) return { ...leaveEditMode(state), selection: [] };
  const stillSelected = selection.length === 1 && selection[0]?.id === editing;
  if (stillSelected) return {};
  return leaveEditMode(state);
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  selection: [],
  hydrated: false,
  saveState: 'idle',
  editingFeatureId: null,

  apply: (...commands) => {
    const state = get();
    try {
      const project = applyCommands(state.project, commands);
      const selection = sanitizeSelection(
        projectForView(project, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      );
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
        projectForView(project, state.editingFeatureId),
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

  commitPreview: (before) => {
    set((state) => ({
      past: [...state.past, before].slice(-HISTORY_LIMIT),
      future: [],
    }));
  },

  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous) return;
    const selection = sanitizeSelection(
      projectForView(previous, state.editingFeatureId),
      state.selection,
      state.editingFeatureId,
    );
    set({
      project: previous,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
      selection,
      ...reconcileEditMode(state, previous, selection),
    });
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    const selection = sanitizeSelection(
      projectForView(next, state.editingFeatureId),
      state.selection,
      state.editingFeatureId,
    );
    set({
      project: next,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      selection,
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
      hydrated: true,
      saveState: 'saved',
    });
  },

  select: (item, options) => {
    // An active picking control owns selection: clicks in the 3D view, the tree
    // or the sketch face list feed that control instead of replacing the
    // selection and closing the control.
    const ui = useUiStore.getState();
    const pickingGeometry = ui.pickingExtrude ?? ui.pickingExtrudeBodies ?? ui.pickingSketchPlane;
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

  beginFeatureEdit: (featureId) => {
    const state = get();
    const feature = state.project.features.find((candidate) => candidate.id === featureId);
    if (!feature) return;
    set({ editingFeatureId: featureId });
  },

  endFeatureEdit: () => {
    const state = get();
    if (state.editingFeatureId === null) return;
    set({ selection: [], ...leaveEditMode(state) });
  },

  setSaveState: (saveState) => set({ saveState }),

  addPrimitiveBox: (name) => {
    // Creating an object commits whatever operation was being configured: the
    // new operation belongs at the user's cursor, not in the middle of an edit.
    get().endFeatureEdit();
    const state = get();
    const featureId = createId('feat');
    const feature: PrimitiveFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'primitive',
      kind: 'box',
      params: { dx: 20, dy: 20, dz: 20 },
      transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    };
    const body: BodyRef = { id: featureBodyId(featureId), createdBy: featureId };
    if (
      state.apply(
        ...addFeatureCommands(state.project, feature),
        { type: 'body/add', body },
        {
          type: 'metadata/patch',
          objectId: body.id,
          patch: {
            name,
            color: BODY_COLORS[state.project.bodies.length % BODY_COLORS.length] ?? '#6ea8fe',
            visible: true,
          },
        },
      )
    ) {
      selectFeatureForEditing(featureId, set);
    }
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
      !get().apply(...addFeatureCommands(get().project, feature), {
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
      !get().apply(...addFeatureCommands(get().project, feature), {
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
      const sketch = project.features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === input.sketchId && candidate.type === 'sketch',
      );
      if (!sketch) return null;
    }
    const featureId = createId('feat');
    const hasBodies = project.bodies.length > 0;
    const regions = input?.regions ?? [];
    const feature: ExtrudeFeature = {
      id: featureId,
      name,
      suppressed: false,
      type: 'extrude',
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
    if (!get().apply(...addFeatureCommands(project, feature))) return null;
    selectFeatureForEditing(featureId, set);
    return featureId;
  },

  setExtrudeInput: (featureId, input) => {
    const project = get().project;
    const feature = project.features.find(
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
    const feature = get().project.features.find(
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
    const feature = get().project.features.find(
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
    const feature = get().project.features.find(
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
    const feature = get().project.features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    get().apply({ type: 'feature/replace', feature: { ...feature, reversed } });
  },

  toggleExtrudeSketch: (featureId, sketchId) => {
    const feature = get().project.features.find(
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
    const feature = project.features.find(
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
        ...addFeatureCommands(state.project, feature),
        { type: 'body/add', body },
        {
          type: 'metadata/patch',
          objectId: body.id,
          patch: {
            name,
            color:
              BODY_COLORS[
                state.project.bodies.filter((candidate) => !isMeshObject(candidate)).length %
                  BODY_COLORS.length
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
    const feature = state.project.features.find(
      (candidate): candidate is SketchFeature =>
        candidate.id === sketchId && candidate.type === 'sketch',
    );
    if (!feature) return;
    const objectId = sketchObjectId(sketchId);
    // The eye follows what is on screen, so a sketch that is only shown because
    // its operation is open hides again when the user asks for it.
    const shown = objectVisible(projectForView(state.project, state.editingFeatureId), objectId);
    get().apply({ type: 'metadata/patch', objectId, patch: { visible: !shown } });
  },

  setSectionPlanes: (planes) => {
    const project = get().project;
    set({
      project: {
        ...project,
        view: { ...project.view, sectionPlanes: planes },
      },
    });
  },

  removeFeature: (featureId) => {
    get().removeFeatures([featureId]);
  },

  removeFeatures: (featureIds) => {
    const project = get().project;
    const selected = new Set(featureIds);
    const features = project.features.filter((candidate) => selected.has(candidate.id));
    if (features.length === 0) return;
    const dependents = dependentFeaturesOf(project, featureIds);
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
    const dependents = dependentFeaturesOf(project, featureIds);
    const ids = [...new Set([...featureIds, ...dependents.map((entry) => entry.id)])];
    if (!get().apply(...ids.map((id) => ({ type: 'feature/remove' as const, featureId: id })))) {
      return;
    }
    useUiStore.getState().cancelDelete();
    useUiStore.getState().showToast('toast.featureDeleted');
  },

  // Deleting an object is itself an operation: the body disappears from this
  // point in the timeline while its creating operation stays editable.
  deleteBody: (bodyId, name) => {
    get().endFeatureEdit();
    const body = get().project.bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    const feature: DeleteBodyFeature = {
      id: createId('feat'),
      name,
      suppressed: false,
      type: 'delete-body',
      bodyId,
    };
    get().apply(...addFeatureCommands(get().project, feature));
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
        if (project.bodies.some((body) => body.id === target.id)) bodyIds.push(target.id);
      } else if (target.kind === 'sketch') {
        if (project.features.some((feature) => feature.id === target.id)) {
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
        const body = current.bodies.find((candidate) => candidate.id === bodyId);
        if (!body) continue;
        const feature: DeleteBodyFeature = {
          id: createId('feat'),
          name: objectName(current, bodyId, 'Body'),
          suppressed: false,
          type: 'delete-body',
          bodyId,
        };
        const batch = addFeatureCommands(current, feature);
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
      ? project.features.findIndex((feature) => feature.id === blockedFeatureId)
      : -1;
    const featureIndices = new Map(project.features.map((feature, index) => [feature.id, index]));
    const staleBodies = new Set(
      blockedIndex >= 0
        ? project.bodies
            .filter((body) => (featureIndices.get(body.createdBy) ?? -1) >= blockedIndex)
            .map((body) => body.id)
        : [],
    );
    // Numbers and colours continue the project-wide sequence instead of
    // restarting for every operation.
    let nextNumber = nextBodyNumber(project);
    let existingCount = project.bodies.filter((body) => !isMeshObject(body)).length;
    for (const [featureId, bodyIds] of created) {
      const feature = project.features.find((candidate) => candidate.id === featureId);
      if (!feature) continue;
      const existing = project.bodies.filter((body) => body.createdBy === featureId);
      for (const bodyId of bodyIds) {
        if (existing.some((body) => body.id === bodyId)) continue;
        commands.push({ type: 'body/add', body: { id: bodyId, createdBy: featureId } });
        // A body that comes back keeps the properties it had before.
        if (project.metadata[bodyId]) continue;
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
        projectForView(next, state.editingFeatureId),
        state.selection,
        state.editingFeatureId,
      ),
    });
  },

  renameProject: (name) => {
    get().apply({ type: 'project/rename', name });
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
      ...entries.map(
        (entry): Command => ({
          type: 'metadata/patch',
          objectId: entry.objectId,
          patch: { color: entry.color },
        }),
      ),
    );
  },

  setObjectsVisible: (entries) => {
    if (entries.length === 0) return;
    get().apply(
      ...entries.map(
        (entry): Command => ({
          type: 'metadata/patch',
          objectId: entry.objectId,
          patch: { visible: entry.visible },
        }),
      ),
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
    const project = get().project;
    const body = project.bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    get().apply({
      type: 'metadata/patch',
      objectId: bodyId,
      patch: { visible: !objectVisible(project, bodyId) },
    });
  },
}));

/**
 * The document with the history cursor placed at the input state of the
 * operation whose settings are open. Everything that draws or reports the model
 * reads this, while the document itself keeps the user's cursor.
 */
export function useViewProject(): Project {
  const project = useDocumentStore((state) => state.project);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  return useMemo(() => projectForView(project, editingFeatureId), [project, editingFeatureId]);
}
