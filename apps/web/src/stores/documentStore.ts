import {
  applyCommands,
  BODY_COLORS,
  CommandError,
  createId,
  createProject,
  featureBodyId,
  type BodyMeta,
  type Command,
  type PrimitiveFeature,
  type Project,
} from '@icancad/model';
import { create } from 'zustand';
import { useUiStore } from './uiStore';

export type SelectionKind = 'body' | 'feature' | 'asset';

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
  undo: () => void;
  redo: () => void;
  hydrate: (project: Project) => void;
  select: (item: SelectionItem | null, options?: { additive?: boolean }) => void;
  setSaveState: (state: SaveState) => void;
  addPrimitiveBox: (name: string) => void;
  removeFeature: (featureId: string) => void;
  renameProject: (name: string) => void;
  setHistoryEnd: (featureId: string | null) => void;
  toggleBodyVisibility: (bodyId: string) => void;
}

const HISTORY_LIMIT = 100;

function exists(project: Project, item: SelectionItem): boolean {
  switch (item.kind) {
    case 'body':
      return project.bodies.some((body) => body.id === item.id);
    case 'feature':
      return project.features.some((feature) => feature.id === item.id);
    case 'asset':
      return project.assets.some((asset) => asset.id === item.id);
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
    const body: BodyMeta = {
      id: featureBodyId(featureId),
      name,
      color: BODY_COLORS[state.project.bodies.length % BODY_COLORS.length] ?? '#6ea8fe',
      visible: true,
      createdBy: featureId,
    };
    if (
      state.apply(
        { type: 'feature/add', feature },
        { type: 'body/add', body },
      )
    ) {
      set({ selection: [{ kind: 'feature', id: featureId }] });
    }
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

  toggleBodyVisibility: (bodyId) => {
    const body = get().project.bodies.find((candidate) => candidate.id === bodyId);
    if (!body) return;
    get().apply({ type: 'body/update', bodyId, patch: { visible: !body.visible } });
  },
}));
