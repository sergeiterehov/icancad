import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  key: string;
  kind: 'info' | 'error';
  params?: Record<string, unknown>;
}

interface UiState {
  toast: ToastMessage | null;
  sectionEnabled: boolean;
  activeSketchId: string | null;
  sketchSelectionIds: string[];
  showToast: (key: string, kind?: 'info' | 'error', params?: Record<string, unknown>) => void;
  dismissToast: () => void;
  setSectionEnabled: (enabled: boolean) => void;
  setActiveSketch: (sketchId: string | null) => void;
  setSketchSelection: (ids: string[]) => void;
}

let toastSequence = 0;

const SECTION_ENABLED_KEY = 'icancad.sectionEnabled';

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
  activeSketchId: null,
  sketchSelectionIds: [],
  showToast: (key, kind = 'info', params) => {
    set({ toast: { id: ++toastSequence, key, kind, params } });
  },
  dismissToast: () => set({ toast: null }),
  setActiveSketch: (activeSketchId) => set({ activeSketchId, sketchSelectionIds: [] }),
  setSketchSelection: (sketchSelectionIds) => set({ sketchSelectionIds }),
  setSectionEnabled: (sectionEnabled) => {
    try {
      localStorage.setItem(SECTION_ENABLED_KEY, String(sectionEnabled));
    } catch {
      // Ignore storage failures.
    }
    set({ sectionEnabled });
  },
}));
