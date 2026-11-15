import { create } from 'zustand';
import type { SketchTool } from '../sketch/tool';
import {
  DEFAULT_CAMERA_SCHEME,
  DEFAULT_ORBIT_STYLE,
  isCameraSchemeId,
  isOrbitStyle,
  type CameraSchemeId,
  type OrbitStyle,
} from '../viewport/cameraControls';
import {
  DEFAULT_INPUT_PREFERENCE,
  isInputPreference,
  type InputPreference,
} from '../viewport/inputProfile';

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

export interface ProjectDeleteRequest {
  id: string;
  name: string;
}

export interface ModelDeleteRequest {
  id: string;
  name: string;
}

interface UiState {
  toast: ToastMessage | null;
  deleteRequest: DeleteRequest | null;
  projectDeleteRequest: ProjectDeleteRequest | null;
  modelDeleteRequest: ModelDeleteRequest | null;
  /** Floating side panels slide off screen when the pointer leaves them. */
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  /** Both panels stay open until the pin is cleared. */
  docksPinned: boolean;
  /** Panels stop at their content instead of running the full height. */
  compactPanels: boolean;
  /** Pointer and wheel bindings the camera follows. */
  cameraScheme: CameraSchemeId;
  setCameraScheme: (scheme: CameraSchemeId) => void;
  /** How a drag turns the view: a level turntable or a free trackball. */
  orbitStyle: OrbitStyle;
  setOrbitStyle: (style: OrbitStyle) => void;
  /** Which gestures the device needs: the user's choice or the detected device. */
  inputPreference: InputPreference;
  setInputPreference: (preference: InputPreference) => void;
  /** The project structure is open; the model dock stays while it is. */
  modelListExpanded: boolean;
  setLeftDockOpen: (open: boolean) => void;
  setRightDockOpen: (open: boolean) => void;
  setDocksPinned: (pinned: boolean) => void;
  setCompactPanels: (compact: boolean) => void;
  setModelListExpanded: (expanded: boolean) => void;
  requestProjectDelete: (request: ProjectDeleteRequest) => void;
  cancelProjectDelete: () => void;
  requestModelDelete: (request: ModelDeleteRequest) => void;
  cancelModelDelete: () => void;
  /** Operation waiting for faces to be picked in the 3D view. */
  pickingExtrude: string | null;
  /** Operation waiting for target bodies to be picked in the 3D view. */
  pickingExtrudeBodies: string | null;
  /** Edge treatment waiting for edges or faces to be picked in the 3D view. */
  pickingEdges: string | null;
  /** Shell waiting for whole bodies to be picked in the 3D view. */
  pickingShellBodies: string | null;
  /** Shell waiting for the faces it should leave open. */
  pickingShellFaces: string | null;
  /** Sketch operation waiting for its plane face to be picked in the 3D view. */
  pickingSketchPlane: string | null;
  /** Section plane waiting for the face it should follow. */
  pickingSectionFace: string | null;
  /** Extrude revolve waiting for the edge it turns around. */
  pickingRevolveAxis: string | null;
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
  setPickingShellBodies: (featureId: string | null) => void;
  setPickingShellFaces: (featureId: string | null) => void;
  setPickingExtrudeBodies: (featureId: string | null) => void;
  setPickingSketchPlane: (featureId: string | null) => void;
  setPickingSectionFace: (planeId: string | null) => void;
  setPickingRevolveAxis: (featureId: string | null) => void;
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
const DOCKS_PINNED_KEY = 'icancad.docksPinned';
const COMPACT_PANELS_KEY = 'icancad.compactPanels';
const CAMERA_SCHEME_KEY = 'icancad.cameraScheme';
const INPUT_PREFERENCE_KEY = 'icancad.input';
const ORBIT_STYLE_KEY = 'icancad.orbit';

function loadSketchMagnet(): boolean {
  try {
    const stored = localStorage.getItem(SKETCH_MAGNET_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return true;
}

function loadCompactPanels(): boolean {
  try {
    return localStorage.getItem(COMPACT_PANELS_KEY) === 'true';
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return false;
}

function loadDocksPinned(): boolean {
  try {
    return localStorage.getItem(DOCKS_PINNED_KEY) === 'true';
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return false;
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

function loadCameraScheme(): CameraSchemeId {
  try {
    const stored = localStorage.getItem(CAMERA_SCHEME_KEY);
    if (isCameraSchemeId(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return DEFAULT_CAMERA_SCHEME;
}

function loadInputPreference(): InputPreference {
  try {
    const stored = localStorage.getItem(INPUT_PREFERENCE_KEY);
    if (isInputPreference(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return DEFAULT_INPUT_PREFERENCE;
}

function loadOrbitStyle(): OrbitStyle {
  try {
    const stored = localStorage.getItem(ORBIT_STYLE_KEY);
    if (isOrbitStyle(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode.
  }
  return DEFAULT_ORBIT_STYLE;
}

export const useUiStore = create<UiState>((set) => ({
  toast: null,
  deleteRequest: null,
  projectDeleteRequest: null,
  modelDeleteRequest: null,
  leftDockOpen: true,
  rightDockOpen: true,
  docksPinned: loadDocksPinned(),
  compactPanels: loadCompactPanels(),
  cameraScheme: loadCameraScheme(),
  setCameraScheme: (cameraScheme) => {
    try {
      localStorage.setItem(CAMERA_SCHEME_KEY, cameraScheme);
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
    set({ cameraScheme });
  },
  inputPreference: loadInputPreference(),
  setInputPreference: (inputPreference) => {
    try {
      localStorage.setItem(INPUT_PREFERENCE_KEY, inputPreference);
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
    set({ inputPreference });
  },
  orbitStyle: loadOrbitStyle(),
  setOrbitStyle: (orbitStyle) => {
    try {
      localStorage.setItem(ORBIT_STYLE_KEY, orbitStyle);
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
    set({ orbitStyle });
  },
  modelListExpanded: false,
  setLeftDockOpen: (leftDockOpen) => set({ leftDockOpen }),
  setRightDockOpen: (rightDockOpen) => set({ rightDockOpen }),
  setDocksPinned: (docksPinned) => {
    try {
      localStorage.setItem(DOCKS_PINNED_KEY, String(docksPinned));
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
    set({ docksPinned });
  },
  setCompactPanels: (compactPanels) => {
    try {
      localStorage.setItem(COMPACT_PANELS_KEY, String(compactPanels));
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
    set({ compactPanels });
  },
  setModelListExpanded: (modelListExpanded) => set({ modelListExpanded }),
  requestProjectDelete: (projectDeleteRequest) => set({ projectDeleteRequest }),
  cancelProjectDelete: () => set({ projectDeleteRequest: null }),
  requestModelDelete: (modelDeleteRequest) => set({ modelDeleteRequest }),
  cancelModelDelete: () => set({ modelDeleteRequest: null }),
  pickingExtrude: null,
  pickingExtrudeBodies: null,
  pickingEdges: null,
  pickingShellBodies: null,
  pickingShellFaces: null,
  pickingSketchPlane: null,
  pickingSectionFace: null,
  pickingRevolveAxis: null,
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
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
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
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
          }
        : { pickingEdges },
    ),
  setPickingShellBodies: (pickingShellBodies) =>
    set(
      pickingShellBodies
        ? {
            pickingShellBodies,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
            sketchPlanePickThenEdit: null,
          }
        : { pickingShellBodies },
    ),
  setPickingShellFaces: (pickingShellFaces) =>
    set(
      pickingShellFaces
        ? {
            pickingShellFaces,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingShellBodies: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
            sketchPlanePickThenEdit: null,
          }
        : { pickingShellFaces },
    ),
  setPickingExtrudeBodies: (pickingExtrudeBodies) =>
    set(
      pickingExtrudeBodies
        ? {
            pickingExtrudeBodies,
            pickingExtrude: null,
            pickingEdges: null,
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
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
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSectionFace: null,
            pickingRevolveAxis: null,
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
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingRevolveAxis: null,
            sketchPlanePickThenEdit: null,
          }
        : { pickingSectionFace },
    ),
  setPickingRevolveAxis: (pickingRevolveAxis) =>
    set(
      pickingRevolveAxis
        ? {
            pickingRevolveAxis,
            pickingExtrude: null,
            pickingExtrudeBodies: null,
            pickingEdges: null,
            pickingShellBodies: null,
            pickingShellFaces: null,
            pickingSketchPlane: null,
            pickingSectionFace: null,
            sketchPlanePickThenEdit: null,
          }
        : { pickingRevolveAxis },
    ),
  startSketchPlanePicking: (sketchPlanePickThenEdit, enterEdit) =>
    set({
      pickingSketchPlane: sketchPlanePickThenEdit,
      sketchPlanePickThenEdit: enterEdit ? sketchPlanePickThenEdit : null,
      pickingExtrude: null,
      pickingExtrudeBodies: null,
      pickingEdges: null,
      pickingShellBodies: null,
      pickingShellFaces: null,
      pickingSectionFace: null,
      pickingRevolveAxis: null,
    }),
  endPicking: () =>
    set({
      pickingExtrude: null,
      pickingExtrudeBodies: null,
      pickingEdges: null,
      pickingShellBodies: null,
      pickingShellFaces: null,
      pickingSketchPlane: null,
      pickingSectionFace: null,
      pickingRevolveAxis: null,
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
