import type { ExpressionDiagnostic, FormulaStatusEvent } from '@icancad/formula';
import { collectFormulas, type Feature, type Resolved, type ResolvedModel } from '@icancad/model';
import { create } from 'zustand';

export type FormulaStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FormulaResolution {
  /** The document with every formula replaced by its number. */
  model: ResolvedModel;
  /** Key of the sources this result belongs to; a rebuild waits for a match. */
  inputKey: string;
  variableValues: Record<string, number | string>;
  variableErrors: Record<string, ExpressionDiagnostic>;
  /** `featureId -> path -> diagnostic`. */
  errors: Record<string, Record<string, ExpressionDiagnostic>>;
  /** Sketches whose constraints are formulas; the rebuild solves them again. */
  drivenSketches: ReadonlySet<string>;
  revision: number;
}

interface FormulaState {
  status: FormulaStatus;
  phase: string | null;
  error: string | null;
  /** Python version reported by the runtime; null until it is ready. */
  python: string | null;
  /** Pyodide version reported by the runtime; null until it is ready. */
  pyodide: string | null;
  resolution: FormulaResolution | null;
  /** Sources currently being evaluated; the rebuild does not start on them. */
  pendingKey: string | null;
  handleStatus: (event: FormulaStatusEvent) => void;
  setPending: (key: string) => void;
  setResolution: (resolution: FormulaResolution) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useFormulaStore = create<FormulaState>((set) => ({
  status: 'idle',
  phase: null,
  error: null,
  python: null,
  pyodide: null,
  resolution: null,
  pendingKey: null,

  handleStatus: (event) => {
    if (event.phase === 'loading-python') {
      set({ status: 'loading', phase: event.phase, error: null, python: null, pyodide: null });
    } else if (event.phase === 'ready') {
      set({
        status: 'ready',
        phase: event.phase,
        error: null,
        python: event.python ?? null,
        pyodide: event.pyodide ?? null,
      });
    } else {
      set({ status: 'error', phase: event.phase, error: event.message ?? 'FORMULA_LOAD_FAILED' });
    }
  },

  setPending: (key) => set({ pendingKey: key }),
  setResolution: (resolution) => set({ resolution, pendingKey: null, error: null }),
  setError: (message) => set({ status: 'error', error: message, pendingKey: null }),
  reset: () =>
    set({
      status: 'idle',
      phase: null,
      error: null,
      python: null,
      pyodide: null,
      resolution: null,
      pendingKey: null,
    }),
}));

/** The resolved active model, or null while formulas are still being computed. */
export function resolvedModel(): ResolvedModel | null {
  return useFormulaStore.getState().resolution?.model ?? null;
}

/** Features whose formulas could not be evaluated; the rebuild blocks them. */
export function expressionErrors(): ReadonlySet<string> {
  const errors = useFormulaStore.getState().resolution?.errors;
  return new Set(errors ? Object.keys(errors) : []);
}

/**
 * The resolved copy of a feature. A feature without formulas is its own
 * resolved copy; one with formulas waits for the engine.
 */
export function resolvedFeatureFor<T extends Feature>(feature: T): Resolved<T> | undefined {
  // A feature without formulas is its own resolved copy. Reading it from the
  // resolution would return a snapshot of an older document while a literal
  // edit is still on its way through the engine.
  if (collectFormulas(feature, feature.id).length === 0) {
    return feature as unknown as Resolved<T>;
  }
  const resolved = resolvedModel()?.features.find((candidate) => candidate.id === feature.id);
  return resolved as Resolved<T> | undefined;
}
