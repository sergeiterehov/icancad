import {
  activeModel,
  applyCommands,
  type Command,
  type Feature,
  type Model,
  type Project,
  type Resolved,
  type ResolvedModel,
} from '@icancad/model';
import { useMemo } from 'react';
import { create } from 'zustand';
import { addFeatureCommands, useDocumentStore, useViewModel } from './documentStore';
import { useFormulaStore } from './formulaStore';

/**
 * What a gesture is dragging: geometry inside an open sketch, or the handles of
 * an operation. The difference matters to the panels — a sketch edit already
 * lists its geometry there, and redrawing that list on every frame is what made
 * the drag stutter — so only a handle drag feeds the inspector.
 */
export type LiveEditKind = 'sketch' | 'feature';

interface LiveEditState {
  /** The document as the gesture has it; null when no gesture is running. */
  project: Project | null;
  /** The operation the gesture edits, as it stands right now. */
  feature: Feature | null;
  kind: LiveEditKind | null;
  featureId: string | null;
  /** Starts a gesture from the document on screen. */
  begin: (kind: LiveEditKind, featureId: string | null) => void;
  /** Points the gesture at an operation it only just created. */
  track: (featureId: string) => void;
  preview: (...commands: Command[]) => void;
  previewAddFeature: (feature: Feature) => boolean;
  /** Returns the live document to the one on screen and keeps the gesture. */
  reset: () => void;
  /** Ends the gesture: the document keeps the result, or never sees it. */
  finish: (commit: boolean) => void;
}

function featureOf(project: Project, featureId: string | null): Feature | null {
  if (!featureId) return null;
  for (const model of project.superObjects) {
    const found = model.features.find((candidate) => candidate.id === featureId);
    if (found) return found;
  }
  return null;
}

/**
 * A drag used to rewrite the whole project on every pointer move, and the whole
 * interface reads that project — so every frame re-rendered the inspector, the
 * timeline and the rails for a number nobody could read that fast. The gesture
 * now writes here instead, and the document is touched once, when it ends.
 */
export const useLiveEditStore = create<LiveEditState>((set, get) => ({
  project: null,
  feature: null,
  kind: null,
  featureId: null,
  begin: (kind, featureId) => {
    const project = useDocumentStore.getState().project;
    set({ project, kind, featureId, feature: featureOf(project, featureId) });
  },
  track: (featureId) => {
    const project = get().project;
    set({ featureId, feature: project ? featureOf(project, featureId) : null });
  },
  preview: (...commands) => {
    const state = get();
    if (!state.project) return;
    try {
      const project = applyCommands(state.project, commands);
      set({ project, feature: featureOf(project, state.featureId) });
    } catch {
      // A transient state the commands refuse is dropped, as the document store
      // drops one: the gesture's next frame starts from the last good copy.
    }
  },
  previewAddFeature: (feature) => {
    const state = get();
    if (!state.project) return false;
    try {
      const project = applyCommands(
        state.project,
        addFeatureCommands(activeModel(state.project), feature),
      );
      set({ project, featureId: feature.id, feature: featureOf(project, feature.id) });
      return true;
    } catch {
      return false;
    }
  },
  reset: () => {
    const project = useDocumentStore.getState().project;
    set({ project, feature: featureOf(project, get().featureId) });
  },
  finish: (commit) => {
    const state = get();
    if (commit && state.project) useDocumentStore.getState().commitLiveDocument(state.project);
    set({ project: null, feature: null, kind: null, featureId: null });
  },
}));

/** The document as a running gesture has it; the document itself otherwise. */
export function liveProject(): Project {
  return useLiveEditStore.getState().project ?? useDocumentStore.getState().project;
}

/** The operation a running gesture edits, as it stands right now. */
export function liveFeature(): Feature | null {
  return useLiveEditStore.getState().feature;
}

/** Whether a gesture is running at all. */
export function isLiveEditing(): boolean {
  return useLiveEditStore.getState().project !== null;
}

/** The model to draw: the gesture's copy of its operation wins while it runs. */
export function useLiveModel(kind?: LiveEditKind): Model {
  const model = useViewModel();
  const feature = useLiveEditStore((state) =>
    kind === undefined || state.kind === kind ? state.feature : null,
  );
  return useMemo(
    () =>
      feature
        ? {
            ...model,
            features: model.features.map((candidate) =>
              candidate.id === feature.id ? feature : candidate,
            ),
          }
        : model,
    [model, feature],
  );
}

/** The resolved model to draw, with the gesture's operation put back in. */
export function useLiveResolvedModel(): ResolvedModel | null {
  const resolved = useFormulaStore((state) => state.resolution?.model ?? null);
  const feature = useLiveEditStore((state) => state.feature);
  return useMemo(() => {
    if (!resolved || !feature) return resolved;
    return {
      ...resolved,
      features: resolved.features.map((candidate) =>
        candidate.id === feature.id ? (feature as unknown as Resolved<Feature>) : candidate,
      ),
    };
  }, [resolved, feature]);
}
