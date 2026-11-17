import planegcs from '@salusoft89/planegcs/package.json';
import { create } from 'zustand';

/** Solver identity shown beside its live state in the kernel popover. */
export const SKETCH_SOLVER_NAME = 'planegcs';
export const SKETCH_SOLVER_VERSION = planegcs.version;

interface SketchSolverState {
  /** Solves currently in flight; more than one can be queued while dragging. */
  pending: number;
  /** Duration of the last completed solve. */
  lastMs: number | null;
  begin: () => void;
  end: (ms: number) => void;
  reset: () => void;
}

export const useSketchSolverStore = create<SketchSolverState>((set) => ({
  pending: 0,
  lastMs: null,
  begin: () => set((state) => ({ pending: state.pending + 1 })),
  end: (ms) => set((state) => ({ pending: Math.max(0, state.pending - 1), lastMs: ms })),
  reset: () => set({ pending: 0, lastMs: null }),
}));
