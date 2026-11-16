import { create } from 'zustand';

interface PwaState {
  /** The page runs from an installed window, so there is nothing to install. */
  installed: boolean;
  /** A newer build is waiting for the user to reload into it. */
  updateReady: boolean;
  setInstalled: (installed: boolean) => void;
  setUpdateReady: (updateReady: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  installed: false,
  updateReady: false,
  setInstalled: (installed) => set({ installed }),
  setUpdateReady: (updateReady) => set({ updateReady }),
}));
