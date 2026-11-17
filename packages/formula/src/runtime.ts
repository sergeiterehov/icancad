import { PYTHON_SOURCE } from './python';
import type {
  FormulaRequest,
  FormulaResponse,
  RenameRequest,
  RenameResponse,
  FormulaWorkerMessage,
} from './protocol';

interface PyodideLike {
  runPython(source: string): unknown;
  globals: { get(name: string): unknown };
}

interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<PyodideLike>;
  version?: string;
}

export interface FormulaWorkerOptions {
  /** Directory the pyodide.mjs and its assets are served from, with a trailing slash. */
  pyodideUrl: string;
}

interface WorkerScope {
  postMessage(message: FormulaWorkerMessage): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

function post(message: FormulaWorkerMessage): void {
  scope.postMessage(message);
}

/**
 * Worker side of the formula engine. Pyodide is loaded once; every later
 * request is one JSON batch in and one JSON batch out.
 */
export function startFormulaWorker(options: FormulaWorkerOptions): void {
  let loading: Promise<PyodideLike> | null = null;
  let evaluate: ((raw: string) => string) | null = null;
  let rename: ((raw: string) => string) | null = null;

  const load = (): Promise<PyodideLike> => {
    if (loading) return loading;
    loading = (async () => {
      post({ type: 'status', phase: 'loading-python' });
      const module = (await import(
        /* @vite-ignore */ `${options.pyodideUrl}pyodide.mjs`
      )) as PyodideModule;
      const pyodide = await module.loadPyodide({ indexURL: options.pyodideUrl });
      pyodide.runPython(PYTHON_SOURCE);
      const fn = pyodide.globals.get('evaluate');
      const renameFn = pyodide.globals.get('rename');
      if (typeof fn !== 'function' || typeof renameFn !== 'function') {
        throw new Error('FORMULA_RUNTIME_MISSING');
      }
      evaluate = fn as (raw: string) => string;
      rename = renameFn as (raw: string) => string;
      post({ type: 'status', phase: 'ready', pyodide: module.version ?? '' });
      return pyodide;
    })().catch((error: unknown) => {
      post({
        type: 'status',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    return loading;
  };

  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as
      | { type: 'evaluate'; id: number; request: FormulaRequest }
      | { type: 'rename'; id: number; request: RenameRequest };
    if (message.type !== 'evaluate' && message.type !== 'rename') return;
    void (async () => {
      try {
        await load();
        const raw = JSON.stringify(message.request);
        if (message.type === 'rename') {
          if (!rename) throw new Error('FORMULA_RUNTIME_MISSING');
          const response = JSON.parse(rename(raw)) as RenameResponse;
          post({ type: 'renamed', id: message.id, response });
          return;
        }
        if (!evaluate) throw new Error('FORMULA_RUNTIME_MISSING');
        const response = JSON.parse(evaluate(raw)) as FormulaResponse;
        post({ type: 'result', id: message.id, response });
      } catch (error) {
        post({
          type: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  void load().catch(() => undefined);
}
