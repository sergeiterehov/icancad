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
  addImportedMesh: (name: string, featureId: string, format: MeshFormat) => void;
  setSectionPlanes: (planes: SectionPlane[]) => void;
  removeFeature: (featureId: string) => void;
  confirmRemoveFeature: (featureId: string) => void;
  deleteBody: (bodyId: string, name: string) => void;
  /** Reconciles body refs with the bodies the kernel actually produced. */
  syncCreatedBodies: (
    bodies: Map<string, string[]>,
    blockedFeatureId?: string | null,
  ) => void;
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
    // An active picking control owns selection: clicks in the 3D view, the tree
    // or the sketch face list feed that control instead of replacing the
    // selection and closing the control.
    const ui = useUiStore.getState();
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
    const featureIndices = new Map(
      project.features.map((feature, index) => [feature.id, index]),
    );
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
