import {
  applyCommands,
  BODY_COLORS,
  HISTORY_START,
  CommandError,
  createId,
  createProject,
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
} from '@icancad/model';
import { create } from 'zustand';
import { useUiStore } from './uiStore';

export type SelectionKind = 'body' | 'feature' | 'sketch';

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
  toggleSketchVisibility: (sketchId: string) => void;
  addImportedMesh: (name: string, featureId: string, format: MeshFormat) => void;
  setSectionPlanes: (planes: SectionPlane[]) => void;
  removeFeature: (featureId: string) => void;
  renameProject: (name: string) => void;
  setHistoryEnd: (featureId: string | null) => void;
  rollHistoryTo: (featureId: string | null) => void;
  toggleBodyVisibility: (bodyId: string) => void;
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
    if (!get().apply({ type: 'feature/remove', featureId })) return;
    useUiStore.getState().showToast('toast.featureDeleted');
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
