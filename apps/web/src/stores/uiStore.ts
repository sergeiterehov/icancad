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
import {
  DEFAULT_VIEW_ELEMENTS,
  viewElementsFrom,
  type ViewElement,
  type ViewElements,
} from '../viewport/viewElements';

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

/** One direction of one array, named so a pick knows where it lands. */
export interface ArrayDirectionPicker {
  featureId: string;
  index: number;
}

interface UiState {
  toast: ToastMessage | null;
  deleteRequest: DeleteRequest | null;
  projectDeleteRequest: ProjectDeleteRequest | null;
  modelDeleteRequest: ModelDeleteRequest | null;
  /** Panels a side of the workspace shows; an open one stays until it is closed. */
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  /**
   * Whether the panel is on screen right now, which is not the same wish: a
   * panel unfolds for its subject too. The layout follows this, so a bar keeps
   * clear of a panel that was opened by a selected operation.
   */
  leftDockShown: boolean;
  rightDockShown: boolean;
  /** Panels stop at their content instead of running the full height. */
  compactPanels: boolean;
  /** Pointer and wheel bindings the camera follows. */
  cameraScheme: CameraSchemeId;
  setCameraScheme: (scheme: CameraSchemeId) => void;
  /** How a drag turns the view: a level turntable or a free trackball. */
  orbitStyle: OrbitStyle;
  setOrbitStyle: (style: OrbitStyle) => void;
  /** What the 3D view draws besides the model; a view setting, not the project. */
  viewElements: ViewElements;
  setViewElement: (element: ViewElement, shown: boolean) => void;
  /** Which gestures the device needs: the user's choice or the detected device. */
  inputPreference: InputPreference;
  setInputPreference: (preference: InputPreference) => void;
  /** The project structure is open; the model dock stays while it is. */
  modelListExpanded: boolean;
  setLeftDockOpen: (open: boolean) => void;
  setRightDockOpen: (open: boolean) => void;
  setLeftDockShown: (shown: boolean) => void;
  setRightDockShown: (shown: boolean) => void;
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
  /** Array waiting for the bodies it should repeat. */
  pickingArrayBodies: string | null;
  /** Array waiting for the operations whose bodies it should repeat. */
  pickingArrayOperations: string | null;
  /** Array rotation waiting for the face it should turn around. */
  pickingArrayFace: ArrayDirectionPicker | null;
  /** Array path waiting for curves that run end to end. */
  pickingArrayPath: ArrayDirectionPicker | null;
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
  /**
   * The operation the geometry under the pointer belongs to. The timeline reads
   * the id to light the chip up, and the tooltip reads the position.
   */
  hoveredFeature: { featureId: string; x: number; y: number } | null;
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
  setPickingArrayBodies: (featureId: string | null) => void;
  setPickingArrayOperations: (featureId: string | null) => void;
  setPickingArrayFace: (picker: ArrayDirectionPicker | null) => void;
  setPickingArrayPath: (picker: ArrayDirectionPicker | null) => void;
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
  setHoveredFeature: (hover: { featureId: string; x: number; y: number } | null) => void;
  setSketchProblems: (ids: string[]) => void;
  setSketchMagnetEnabled: (enabled: boolean) => void;
  setSketchTool: (tool: SketchTool) => void;
}

/**
 * Every picker of the app. Opening one closes the others, so a click in the 3D
 * view can never feed two operations at once.
 */
const PICKER_KEYS = [
  'pickingExtrude',
  'pickingExtrudeBodies',
  'pickingEdges',
  'pickingShellBodies',
  'pickingShellFaces',
  'pickingSketchPlane',
  'pickingSectionFace',
  'pickingRevolveAxis',
  'pickingArrayBodies',
  'pickingArrayOperations',
  'pickingArrayFace',
  'pickingArrayPath',
] as const;

type PickerKey = (typeof PICKER_KEYS)[number];

function clearedPickers(): Pick<UiState, PickerKey> {
  return Object.fromEntries(PICKER_KEYS.map((key) => [key, null])) as Pick<UiState, PickerKey>;
}

/** The state of opening one picker, with every other picker closed. */
function onlyPicker<K extends PickerKey>(key: K, value: UiState[K]): Partial<UiState> {
  return (value ? { ...clearedPickers(), [key]: value } : { [key]: value }) as Partial<UiState>;
}

let toastSequence = 0;

const SECTION_ENABLED_KEY = 'icancad.sectionEnabled';
const SKETCH_MAGNET_KEY = 'icancad.sketchMagnet';
const COMPACT_PANELS_KEY = 'icancad.compactPanels';
const CAMERA_SCHEME_KEY = 'icancad.cameraScheme';
const INPUT_PREFERENCE_KEY = 'icancad.input';
const ORBIT_STYLE_KEY = 'icancad.orbit';
const VIEW_ELEMENTS_KEY = 'icancad.viewElements';

function loadViewElements(): ViewElements {
  try {
    return viewElementsFrom(JSON.parse(localStorage.getItem(VIEW_ELEMENTS_KEY) ?? 'null'));
  } catch {
    // localStorage can be unavailable in private mode, and a broken entry is
    // the same as none: the defaults say what a view shows.
  }
  return { ...DEFAULT_VIEW_ELEMENTS };
}

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
  leftDockShown: true,
  rightDockShown: true,
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
  viewElements: loadViewElements(),
  setViewElement: (element, shown) =>
    set((state) => {
      const viewElements = { ...state.viewElements, [element]: shown };
      try {
        localStorage.setItem(VIEW_ELEMENTS_KEY, JSON.stringify(viewElements));
      } catch {
        // A preference that cannot be stored still applies to this session.
      }
      return { viewElements };
    }),
  modelListExpanded: false,
  setLeftDockOpen: (leftDockOpen) => set({ leftDockOpen }),
  setRightDockOpen: (rightDockOpen) => set({ rightDockOpen }),
  setLeftDockShown: (leftDockShown) =>
    set((state) => (state.leftDockShown === leftDockShown ? state : { leftDockShown })),
  setRightDockShown: (rightDockShown) =>
    set((state) => (state.rightDockShown === rightDockShown ? state : { rightDockShown })),
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
  pickingArrayBodies: null,
  pickingArrayOperations: null,
  pickingArrayFace: null,
  pickingArrayPath: null,
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
  hoveredFeature: null,
  sketchProblemConstraintIds: [],
  sketchMagnetEnabled: loadSketchMagnet(),
  sketchTool: 'select',
  sketchToolNonce: 0,
  showToast: (key, kind = 'info', params) => {
    set({ toast: { id: ++toastSequence, key, kind, params } });
  },
  dismissToast: () => set({ toast: null }),
  requestDelete: (deleteRequest) => set({ deleteRequest }),
  // Face, edge and body picking are mutually exclusive; the flag that is set
  // names the operation the pick belongs to.
  setPickingExtrude: (pickingExtrude) => set(onlyPicker('pickingExtrude', pickingExtrude)),
  setPickingEdges: (pickingEdges) => set(onlyPicker('pickingEdges', pickingEdges)),
  setPickingShellBodies: (pickingShellBodies) =>
    set(onlyPicker('pickingShellBodies', pickingShellBodies)),
  setPickingShellFaces: (pickingShellFaces) =>
    set(onlyPicker('pickingShellFaces', pickingShellFaces)),
  setPickingExtrudeBodies: (pickingExtrudeBodies) =>
    set(onlyPicker('pickingExtrudeBodies', pickingExtrudeBodies)),
  setPickingSketchPlane: (pickingSketchPlane) =>
    set({ ...onlyPicker('pickingSketchPlane', pickingSketchPlane), sketchPlanePickThenEdit: null }),
  setPickingSectionFace: (pickingSectionFace) =>
    set(onlyPicker('pickingSectionFace', pickingSectionFace)),
  setPickingRevolveAxis: (pickingRevolveAxis) =>
    set(onlyPicker('pickingRevolveAxis', pickingRevolveAxis)),
  setPickingArrayBodies: (pickingArrayBodies) =>
    set(onlyPicker('pickingArrayBodies', pickingArrayBodies)),
  setPickingArrayOperations: (pickingArrayOperations) =>
    set(onlyPicker('pickingArrayOperations', pickingArrayOperations)),
  setPickingArrayFace: (picker) => set(onlyPicker('pickingArrayFace', picker)),
  setPickingArrayPath: (picker) => set(onlyPicker('pickingArrayPath', picker)),
  startSketchPlanePicking: (sketchPlanePickThenEdit, enterEdit) =>
    set({
      ...clearedPickers(),
      pickingSketchPlane: sketchPlanePickThenEdit,
      sketchPlanePickThenEdit: enterEdit ? sketchPlanePickThenEdit : null,
    }),
  endPicking: () => set({ ...clearedPickers(), sketchPlanePickThenEdit: null }),
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
  // The pointer reports the same operation many times in a row; only a real
  // change of the operation or of the position it is shown at is stored.
  setHoveredFeature: (hoveredFeature) =>
    set((state) => {
      if (hoveredFeature === null) {
        return state.hoveredFeature === null ? state : { hoveredFeature: null };
      }
      const current = state.hoveredFeature;
      if (
        current &&
        current.featureId === hoveredFeature.featureId &&
        Math.abs(current.x - hoveredFeature.x) < 1 &&
        Math.abs(current.y - hoveredFeature.y) < 1
      ) {
        return state;
      }
      return { hoveredFeature };
    }),
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
