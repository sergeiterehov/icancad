import { beforeEach, describe, expect, it } from 'vitest';
import { useFormulaStore } from '../src/stores/formulaStore';
import {
  SKETCH_SOLVER_NAME,
  SKETCH_SOLVER_VERSION,
  useSketchSolverStore,
} from '../src/stores/sketchSolverStore';

describe('runtime status', () => {
  beforeEach(() => {
    useSketchSolverStore.getState().reset();
    useFormulaStore.getState().reset();
  });

  it('counts solver requests and remembers the last solve', () => {
    const solver = useSketchSolverStore.getState();
    solver.begin();
    solver.begin();
    expect(useSketchSolverStore.getState().pending).toBe(2);
    solver.end(12.5);
    expect(useSketchSolverStore.getState()).toMatchObject({ pending: 1, lastMs: 12.5 });
    solver.end(8);
    expect(useSketchSolverStore.getState()).toMatchObject({ pending: 0, lastMs: 8 });
    solver.end(5);
    expect(useSketchSolverStore.getState().pending).toBe(0);
    expect(SKETCH_SOLVER_NAME).toBe('planegcs');
    expect(SKETCH_SOLVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('keeps the Python and Pyodide versions reported by the runtime', () => {
    useFormulaStore.getState().handleStatus({
      type: 'status',
      phase: 'ready',
      python: '3.12.1',
      pyodide: '0.27.2',
    });
    expect(useFormulaStore.getState()).toMatchObject({
      status: 'ready',
      python: '3.12.1',
      pyodide: '0.27.2',
    });
    useFormulaStore.getState().handleStatus({ type: 'status', phase: 'loading-python' });
    expect(useFormulaStore.getState()).toMatchObject({ python: null, pyodide: null });
  });
});
