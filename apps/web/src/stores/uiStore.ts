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
  showToast: (key: string, kind?: 'info' | 'error', params?: Record<string, unknown>) => void;
  dismissToast: () => void;
  setSectionEnabled: (enabled: boolean) => void;
}

let toastSequence = 0;

export const useUiStore = create<UiState>((set) => ({
  toast: null,
  sectionEnabled: true,
  showToast: (key, kind = 'info', params) => {
    set({ toast: { id: ++toastSequence, key, kind, params } });
  },
  dismissToast: () => set({ toast: null }),
  setSectionEnabled: (sectionEnabled) => set({ sectionEnabled }),
}));
