import {
  applyCommands,
  BODY_COLORS,
  HISTORY_START,
  CommandError,
  createId,
  createProject,
  dependentFeatures,
  objectVisible,
  sketchObjectId,
  featureBodyId,
  historyInsertIndex,
  isFeatureInHistory,
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
import { create } from 'zustand';
import { i18n } from '../i18n';
import { useUiStore } from './uiStore';

export type SelectionKind = 'body' | 'feature' | 'sketch' | 'face';

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
  apply: (...commands: Command[]) => boolean;
  preview: (...commands: Command[]) => void;
  commitPreview: (before: Project) => void;
  undo: () => void;
  redo: () => void;
  hydrate: (project: Project) => void;
  select: (item: SelectionItem | null, options?: { additive?: boolean }) => void;
  setSaveState: (state: SaveState) => void;
  addPrimitiveBox: (name: string) => void;
  addSketch: (name: string, plane: 'XY' | 'XZ' | 'YZ') => string | null;
  addExtrude: (name: string, input?: ExtrudeInput) => string | null;
  setExtrudeOp: (featureId: string, op: ExtrudeFeature['op']) => void;
  setExtrudeInput: (featureId: string, input: ExtrudeInput | null) => void;
  toggleExtrudeFace: (featureId: string, sketchId: string, faceId: string) => void;
  toggleExtrudeSketch: (featureId: string, sketchId: string) => void;
  toggleSketchVisibility: (sketchId: string) => void;
  addImportedMesh: (name: string, featureId: string, format: MeshFormat) => void;
  setSectionPlanes: (planes: SectionPlane[]) => void;
  removeFeature: (featureId: string) => void;
  confirmRemoveFeature: (featureId: string) => void;
  deleteBody: (bodyId: string, name: string) => void;
  /** Reconciles body refs with the bodies the kernel actually produced. */
  syncCreatedBodies: (bodies: Map<string, string[]>) => void;
  renameProject: (name: string) => void;
  setHistoryEnd: (featureId: string | null) => void;
  rollHistoryTo: (featureId: string | null) => void;
  toggleBodyVisibility: (bodyId: string) => void;
}

export interface ExtrudeInput {
  sketchId: string;
  /** Empty means the whole sketch; otherwise the picked faces. */
  regions: string[];
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
function nextBodyNumber(project: Project): number {
  let highest = 0;
  for (const metadata of Object.values(project.metadata)) {
    if (typeof metadata.bodyIndex === 'number') highest = Math.max(highest, metadata.bodyIndex);
  }
  return highest + 1;
}

function exists(project: Project, item: SelectionItem): boolean {
  switch (item.kind) {
    case 'body': {
      const body = project.bodies.find((candidate) => candidate.id === item.id);
      return body ? isFeatureInHistory(project, body.createdBy) : false;
    }
    case 'feature':
      return isFeatureInHistory(project, item.id);
    case 'sketch':
      return project.features.some(
        (feature) =>
          feature.id === item.id && feature.type === 'sketch' && isFeatureInHistory(project, item.id),
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

function sanitizeSelection(project: Project, selection: SelectionItem[]): SelectionItem[] {
  const next = selection.filter((item) => exists(project, item));
  return next.length === selection.length ? selection : next;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  selection: [],
  hydrated: false,
  saveState: 'idle',

  apply: (...commands) => {
    const state = get();
    try {
      const project = applyCommands(state.project, commands);
      set({
        project,
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: [],
        selection: sanitizeSelection(project, state.selection),
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
      set({ project, selection: sanitizeSelection(project, state.selection) });
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
    set({
      project: previous,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
      selection: sanitizeSelection(previous, state.selection),
    });
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({
      project: next,
      past: [...state.past, state.project].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      selection: sanitizeSelection(next, state.selection),
    });
  },

  hydrate: (project) => {
    set({
      project,
      past: [],
      future: [],
      selection: [],
      hydrated: true,
      saveState: 'saved',
    });
  },

  select: (item, options) => {
    if (!item) {
      set({ selection: [] });
      return;
    }
    const selection = get().selection;
    if (!options?.additive) {
      set({ selection: [item] });
      return;
    }
    const index = selection.findIndex(
      (candidate) => candidate.kind === item.kind && candidate.id === item.id,
    );
    if (index >= 0) {
      set({ selection: selection.filter((_, i) => i !== index) });
    } else {
      set({ selection: [...selection, item] });
    }
  },
  setSaveState: (saveState) => set({ saveState }),

  addPrimitiveBox: (name) => {
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
      state.apply(...addFeatureCommands(state.project, feature), { type: 'body/add', body }, {
        type: 'metadata/patch',
        objectId: body.id,
        patch: {
          name,
          color: BODY_COLORS[state.project.bodies.length % BODY_COLORS.length] ?? '#6ea8fe',
          visible: true,
        },
      })
    ) {
      set({ selection: [{ kind: 'feature', id: featureId }] });
    }
  },

  addSketch: (name, plane) => {
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
        patch: { name, visible: true },
      })
    ) {
      return null;
    }
    set({ selection: [{ kind: 'sketch', id: featureId }] });
    return featureId;
  },

  // The operation can be created empty and pointed at objects afterwards.
  addExtrude: (name, input) => {
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
      end: 'blind',
      distance: 10,
      op: hasBodies ? 'add' : 'new',
      scope: regions.length > 0 ? 'selected' : 'all',
      bodyIds: [],
      joinRegions: true,
    };
    if (!get().apply(...addFeatureCommands(project, feature))) return null;
    set({ selection: [{ kind: 'feature', id: featureId }] });
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
    const next: ExtrudeFeature = {
      ...feature,
      ...(input ? { sketchId: input.sketchId } : { sketchId: undefined }),
      regions,
      scope: regions.length > 0 ? 'selected' : 'all',
    };
    get().apply({ type: 'feature/replace', feature: next });
  },

  toggleExtrudeFace: (featureId, sketchId, faceId) => {
    const feature = get().project.features.find(
      (candidate): candidate is ExtrudeFeature =>
        candidate.id === featureId && candidate.type === 'extrude',
    );
    if (!feature) return;
    const regions =
      feature.sketchId === sketchId && feature.scope === 'selected' ? feature.regions : [];
    const next = regions.includes(faceId)
      ? regions.filter((id) => id !== faceId)
      : [...regions, faceId];
    get().setExtrudeInput(
      featureId,
      next.length > 0 ? { sketchId, regions: next } : null,
    );
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
    // Through-all cannot create or add material, so such an operation falls back
    // to a blind extent when the operation changes.
    const end =
      (op === 'new' || op === 'add') && feature.end === 'through-all' ? 'blind' : feature.end;
    get().apply({ type: 'feature/replace', feature: { ...feature, op, end } });
  },

  addImportedMesh: (name, featureId, format) => {
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
    const body: BodyRef = { id: featureBodyId(featureId), createdBy: featureId };
    if (
      state.apply(...addFeatureCommands(state.project, feature), { type: 'body/add', body }, {
        type: 'metadata/patch',
        objectId: body.id,
        patch: {
          name,
          color: BODY_COLORS[state.project.bodies.length % BODY_COLORS.length] ?? '#6ea8fe',
          visible: true,
        },
      })
    ) {
      set({ selection: [{ kind: 'feature', id: featureId }] });
    }
  },

  toggleSketchVisibility: (sketchId) => {
    const project = get().project;
    const feature = project.features.find(
      (candidate): candidate is SketchFeature =>
        candidate.id === sketchId && candidate.type === 'sketch',
    );
    if (!feature) return;
    const objectId = sketchObjectId(sketchId);
    get().apply({
      type: 'metadata/patch',
      objectId,
      patch: { visible: !objectVisible(project, objectId) },
    });
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
    const project = get().project;
    const feature = project.features.find((candidate) => candidate.id === featureId);
    if (!feature) return;
    const dependents = dependentFeatures(project, featureId);
    if (dependents.length > 0) {
      useUiStore.getState().requestDelete({ featureId, name: feature.name, dependents });
      return;
    }
    get().confirmRemoveFeature(featureId);
  },

  confirmRemoveFeature: (featureId) => {
    const project = get().project;
    const dependents = dependentFeatures(project, featureId);
    const ids = [...dependents.map((entry) => entry.id), featureId];
    if (!get().apply(...ids.map((id) => ({ type: 'feature/remove' as const, featureId: id })))) {
      return;
    }
    useUiStore.getState().cancelDelete();
    useUiStore.getState().showToast('toast.featureDeleted');
  },

  // Deleting an object is itself an operation: the body disappears from this
  // point in the timeline while its creating operation stays editable.
  deleteBody: (bodyId, name) => {
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

  // Bodies are objects derived from the geometry an operation produced (ADR
  // 0007): the kernel reports them and the document only keeps the refs, so the
  // reconciliation is not an undoable edit of its own.
  syncCreatedBodies: (created) => {
    const state = get();
    const project = state.project;
    const commands: Command[] = [];
    // Numbers and colours continue the project-wide sequence instead of
    // restarting for every operation.
    let nextNumber = nextBodyNumber(project);
    let existingCount = project.bodies.length;
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
        if (bodyIds.includes(body.id)) continue;
        commands.push({ type: 'body/remove', bodyId: body.id });
      }
    }
    if (commands.length === 0) return;
    let next: Project;
    try {
      next = applyCommands(project, commands);
    } catch {
      return;
    }
    set({ project: next, selection: sanitizeSelection(next, state.selection) });
  },

  renameProject: (name) => {
    get().apply({ type: 'project/rename', name });
  },

  setHistoryEnd: (featureId) => {
    get().apply({ type: 'history/set-end', featureId });
  },

  // Moves the history cursor without creating an undo step. Used when entering
  // and leaving a sketch, which is a navigation action rather than an edit.
  rollHistoryTo: (featureId) => {
    const project = get().project;
    const known =
      featureId === null ||
      featureId === HISTORY_START ||
      project.features.some((feature) => feature.id === featureId);
    set({ project: { ...project, historyEnd: known ? featureId : null } });
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
