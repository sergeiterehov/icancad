import { create } from 'zustand';
import type { SketchTool } from '../sketch/tool';

export interface ToastMessage {
  id: number;
  key: string;
  kind: 'info' | 'error';
  params?: Record<string, unknown>;
}

interface UiState {
  toast: ToastMessage | null;
  sectionEnabled: boolean;
  sketchSectionEnabled: boolean;
  activeSketchId: string | null;
  sketchSelectionIds: string[];
  sketchConstraintId: string | null;
  sketchFrozenEntityIds: string[];
  sketchAutoHighlightIds: string[];
  sketchProblemConstraintIds: string[];
  sketchMagnetEnabled: boolean;
  sketchTool: SketchTool;
  showToast: (key: string, kind?: 'info' | 'error', params?: Record<string, unknown>) => void;
  dismissToast: () => void;
  setSectionEnabled: (enabled: boolean) => void;
  setSketchSectionEnabled: (enabled: boolean) => void;
  setActiveSketch: (sketchId: string | null) => void;
  setSketchSelection: (ids: string[]) => void;
  selectSketchConstraint: (id: string | null) => void;
  setSketchFrozen: (ids: string[]) => void;
  setSketchAutoHighlight: (ids: string[]) => void;
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
  sectionEnabled: loadSectionEnabled(),
  sketchSectionEnabled: true,
  activeSketchId: null,
  sketchSelectionIds: [],
  sketchConstraintId: null,
  sketchFrozenEntityIds: [],
  sketchAutoHighlightIds: [],
  sketchProblemConstraintIds: [],
  sketchMagnetEnabled: loadSketchMagnet(),
  sketchTool: 'select',
  showToast: (key, kind = 'info', params) => {
    set({ toast: { id: ++toastSequence, key, kind, params } });
  },
  dismissToast: () => set({ toast: null }),
  setActiveSketch: (activeSketchId) =>
    set({
      activeSketchId,
      sketchSelectionIds: [],
      sketchConstraintId: null,
      sketchFrozenEntityIds: [],
      sketchAutoHighlightIds: [],
      sketchProblemConstraintIds: [],
      sketchTool: 'select',
    }),
  setSketchSelection: (sketchSelectionIds) =>
    set({ sketchSelectionIds, sketchConstraintId: null, sketchAutoHighlightIds: [] }),
  selectSketchConstraint: (sketchConstraintId) =>
    set({ sketchConstraintId, sketchSelectionIds: [] }),
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
  setSketchMagnetEnabled: (sketchMagnetEnabled) => {
    try {
      localStorage.setItem(SKETCH_MAGNET_KEY, String(sketchMagnetEnabled));
    } catch {
      // Ignore storage failures.
    }
    set({ sketchMagnetEnabled });
  },
  setSketchTool: (sketchTool) => set({ sketchTool, sketchAutoHighlightIds: [] }),
  setSectionEnabled: (sectionEnabled) => {
    try {
      localStorage.setItem(SECTION_ENABLED_KEY, String(sectionEnabled));
    } catch {
      // Ignore storage failures.
    }
    set((state) => ({
      sectionEnabled,
      // Turning sections on shows the sketch plane by default.
      sketchSectionEnabled: sectionEnabled ? true : state.sketchSectionEnabled,
    }));
  },
  setSketchSectionEnabled: (sketchSectionEnabled) => set({ sketchSectionEnabled }),
}));
