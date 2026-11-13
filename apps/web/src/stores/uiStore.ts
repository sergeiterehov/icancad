import { create } from 'zustand';
import type { SketchTool } from '../sketch/tool';

export interface DeleteRequest {
  /** Operations the user asked to delete, without their dependents. */
  featureIds: string[];
  /** Name of the operation, or of the first one when several were selected. */
  name: string;
  dependents: { id: string; name: string }[];
}

export interface ToastMessage {
  id: number;
  key: string;
  kind: 'info' | 'error';
  params?: Record<string, unknown>;
}

interface UiState {
  toast: ToastMessage | null;
  deleteRequest: DeleteRequest | null;
  /** Operation waiting for faces to be picked in the 3D view. */
  pickingExtrude: string | null;
  /** Operation waiting for target bodies to be picked in the 3D view. */
  pickingExtrudeBodies: string | null;
  /** Edge treatment waiting for edges or faces to be picked in the 3D view. */
  pickingEdges: string | null;
  /** Sketch operation waiting for its plane face to be picked in the 3D view. */
  pickingSketchPlane: string | null;
  /** Section plane waiting for the face it should follow. */
  pickingSectionFace: string | null;
  /** Face pick started from the sketch tool: open the editor after a pick. */
  sketchPlanePickThenEdit: string | null;
  sectionEnabled: boolean;
  sketchSectionEnabled: boolean;
  activeSketchId: string | null;
  /** False while the rebuild for the sketch's timeline position is running. */
  activeSketchReady: boolean;
  sketchSelectionIds: string[];
  sketchConstraintIds: string[];
  sketchFrozenEntityIds: string[];
  sketchAutoHighlightIds: string[];
  /** Geometry under the pointer while selecting; empty while a tool creates. */
  sketchHoverIds: string[];
  sketchProblemConstraintIds: string[];
  sketchMagnetEnabled: boolean;
  sketchTool: SketchTool;
  /** Bumped whenever a tool is chosen, so re-clicking it restarts its draft. */
  sketchToolNonce: number;
  requestDelete: (request: DeleteRequest) => void;
  setPickingExtrude: (featureId: string | null) => void;
  setPickingEdges: (featureId: string | null) => void;
  setPickingExtrudeBodies: (featureId: string | null) => void;
  setPickingSketchPlane: (featureId: string | null) => void;
  setPickingSectionFace: (planeId: string | null) => void;
  /** Leaves whichever picker is open; every operation shares one. */
  endPicking: () => void;
  startSketchPlanePicking: (featureId: string, enterEdit: boolean) => void;
  cancelDelete: () => void;
  showToast: (key: string, kind?: 'info' | 'error', params?: Record<string, unknown>) => void;
  dismissToast: () => void;
  setSectionEnabled: (enabled: boolean) => void;
  setSketchSectionEnabled: (enabled: boolean) => void;
  setActiveSketch: (sketchId: string | null) => void;
  setActiveSketchReady: (ready: boolean) => void;
  setSketchSelection: (ids: string[]) => void;
  selectSketchConstraint: (id: string | null) => void;
  selectSketchConstraints: (ids: string[]) => void;
  setSketchFrozen: (ids: string[]) => void;
  setSketchAutoHighlight: (ids: string[]) => void;
  setSketchHover: (ids: string[]) => void;
  setSketchProblems: (ids: string[]) => void;
  setSketchMagnetEnabled: (enabled: boolean) => void;
  setSketchTool: (tool: SketchTool) => void;
}

let toastSequence = 0;

const SECTION_ENABLED_KEY = 'icancad.sectionEnabled';
const SKETCH_MAGNET_KEY = 'icancad.sketchMagnet';

function loadSketchMagnet(): boolean {
  try {
    const stored = localStorage.getItem(SKETCH_MAGNET_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return true;
}

function loadSectionEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SECTION_ENABLED_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return true;
}

export const useUiStore = create<UiState>((set) => ({
  toast: null,
  deleteRequest: null,
  pickingExtrude: null,
  pickingExtrudeBodies: null,
  pickingEdges: null,
  pickingSketchPlane: null,
  pickingSectionFace: null,
  sketchPlanePickThenEdit: null,
  sectionEnabled: loadSectionEnabled(),
  sketchSectionEnabled: true,
  activeSketchId: null,
  activeSketchReady: true,
  sketchSelectionIds: [],
  sketchConstraintIds: [],
  sketchFrozenEntityIds: [],
  sketchAutoHighlightIds: [],
  sketchHoverIds: [],
  sketchProblemConstraintIds: [],
  sketchMagnetEnabled: loadSketchMagnet(),
  sketchTool: 'select',
  sketchToolNonce: 0,
  showToast: (key, kind = 'info', params) => {
    set({ toast: { id: ++toastSequence, key, kind, params } });
  },
  dismissToast: () => set({ toast: null }),
  requestDelete: (deleteRequest) => set({ deleteRequest }),
  // Face and body picking are mutually exclusive.
  setPickingExtrude: (pickingExtrude) =>
    set(
      pickingExtrude
        ? {
            pickingExtrude,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
          }
        : { pickingExtrude },
    ),
  setPickingEdges: (pickingEdges) =>
    set(
      pickingEdges
        ? {
            pickingEdges,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
          }
        : { pickingEdges },
    ),
  setPickingExtrudeBodies: (pickingExtrudeBodies) =>
    set(
      pickingExtrudeBodies
        ? {
            pickingExtrudeBodies,
            pickingExtrude: null,
            pickingEdges: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
          }
        : { pickingExtrudeBodies },
    ),
  setPickingSketchPlane: (pickingSketchPlane) =>
    set(
      pickingSketchPlane
        ? {
            pickingSketchPlane,
            sketchPlanePickThenEdit: null,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingSectionFace: null,
          }
        : { pickingSketchPlane, sketchPlanePickThenEdit: null },
    ),
  setPickingSectionFace: (pickingSectionFace) =>
    set(
      pickingSectionFace
        ? {
            pickingSectionFace,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingSketchPlane: null,
            sketchPlanePickThenEdit: null,
          }
        : { pickingSectionFace },
    ),
  startSketchPlanePicking: (sketchPlanePickThenEdit, enterEdit) =>
    set({
      pickingSketchPlane: sketchPlanePickThenEdit,
      sketchPlanePickThenEdit: enterEdit ? sketchPlanePickThenEdit : null,
      pickingExtrude: null,
      pickingExtrudeBodies: null,
      pickingEdges: null,
      pickingSectionFace: null,
    }),
  endPicking: () =>
    set({
      pickingExtrude: null,
      pickingExtrudeBodies: null,
      pickingEdges: null,
      pickingSketchPlane: null,
      pickingSectionFace: null,
      sketchPlanePickThenEdit: null,
    }),
  cancelDelete: () => set({ deleteRequest: null }),
  setActiveSketch: (activeSketchId) =>
    set({
      activeSketchId,
      activeSketchReady: activeSketchId === null,
      sketchSelectionIds: [],
      sketchConstraintIds: [],
      sketchFrozenEntityIds: [],
      sketchAutoHighlightIds: [],
      sketchHoverIds: [],
      sketchProblemConstraintIds: [],
      sketchTool: 'select',
    }),
  setActiveSketchReady: (activeSketchReady) => set({ activeSketchReady }),
  setSketchSelection: (sketchSelectionIds) =>
    set({
      sketchSelectionIds,
      sketchConstraintIds: [],
      sketchAutoHighlightIds: [],
      sketchHoverIds: [],
    }),
  selectSketchConstraint: (sketchConstraintId) =>
    set({
      sketchConstraintIds: sketchConstraintId ? [sketchConstraintId] : [],
      sketchSelectionIds: [],
    }),
  selectSketchConstraints: (sketchConstraintIds) =>
    set({ sketchConstraintIds, sketchSelectionIds: [] }),
  setSketchFrozen: (sketchFrozenEntityIds) => set({ sketchFrozenEntityIds }),
  setSketchProblems: (sketchProblemConstraintIds) =>
    set((state) =>
      state.sketchProblemConstraintIds.length === sketchProblemConstraintIds.length &&
      state.sketchProblemConstraintIds.every(
        (id, index) => id === sketchProblemConstraintIds[index],
      )
        ? state
        : { sketchProblemConstraintIds },
    ),
  setSketchAutoHighlight: (sketchAutoHighlightIds) =>
    set((state) =>
      state.sketchAutoHighlightIds.length === sketchAutoHighlightIds.length &&
      state.sketchAutoHighlightIds.every((id, index) => id === sketchAutoHighlightIds[index])
        ? state
        : { sketchAutoHighlightIds },
    ),
  setSketchHover: (sketchHoverIds) =>
    set((state) =>
      state.sketchHoverIds.length === sketchHoverIds.length &&
      state.sketchHoverIds.every((id, index) => id === sketchHoverIds[index])
        ? state
        : { sketchHoverIds },
    ),
  setSketchMagnetEnabled: (sketchMagnetEnabled) => {
    try {
      localStorage.setItem(SKETCH_MAGNET_KEY, String(sketchMagnetEnabled));
    } catch {
      // Ignore storage failures.
    }
    set({ sketchMagnetEnabled });
  },
  setSketchTool: (sketchTool) =>
    set((state) => ({
      sketchTool,
      sketchToolNonce: state.sketchToolNonce + 1,
      sketchAutoHighlightIds: [],
      sketchHoverIds: [],
    })),
  setSectionEnabled: (sectionEnabled) => {
    try {
      localStorage.setItem(SECTION_ENABLED_KEY, String(sectionEnabled));
    } catch {
      // Ignore storage failures.
    }
    set((state) => ({
      sectionEnabled,
      pickingSectionFace: sectionEnabled ? state.pickingSectionFace : null,
      // Turning sections on shows the sketch plane by default.
      sketchSectionEnabled: sectionEnabled ? true : state.sketchSectionEnabled,
    }));
  },
  setSketchSectionEnabled: (sketchSectionEnabled) => set({ sketchSectionEnabled }),
}));
