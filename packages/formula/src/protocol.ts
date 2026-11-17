export type ExpressionDiagnosticCode =
  'SYNTAX' | 'UNKNOWN_NAME' | 'CYCLE' | 'TYPE' | 'VALUE' | 'DEPENDENCY_ERROR';

export interface ExpressionDiagnostic {
  code: ExpressionDiagnosticCode;
  /** Human-readable fallback; the UI localises the code and args instead. */
  message: string;
  args?: Record<string, string | number>;
  line?: number;
  column?: number;
}

export interface VariableSource {
  id: string;
  name: string;
  type: 'number' | 'string';
  source: string;
  /** Model variables resolve after project variables and may read both. */
  scope?: 'project' | 'model';
}

/** One formula handed to the engine; it does not know the CAD schema. */
export interface ExpressionSource {
  targetId: string;
  path: string;
  source: string;
}

export interface FormulaRequest {
  variables: VariableSource[];
  expressions: ExpressionSource[];
}

export interface VariableResult {
  id: string;
  name: string;
  value?: number | string;
  error?: ExpressionDiagnostic;
}

export interface ExpressionResult {
  targetId: string;
  path: string;
  value?: number;
  error?: ExpressionDiagnostic;
  /** Names the formula reads: the edges of the derived dependency graph. */
  dependencies?: string[];
}

/** Renaming a variable rewrites the names inside every source of the project. */
export interface RenameRequest {
  oldName: string;
  newName: string;
  variables: VariableSource[];
  expressions: ExpressionSource[];
}

export interface RenameResponse {
  variables: VariableSource[];
  expressions: ExpressionSource[];
}

export interface FormulaResponse {
  variables: VariableResult[];
  results: ExpressionResult[];
  engine: { python: string; pyodide: string };
}

export type FormulaStatusPhase = 'loading-python' | 'ready' | 'error';

export interface FormulaStatusEvent {
  type: 'status';
  phase: FormulaStatusPhase;
  ratio?: number;
  message?: string;
  python?: string;
  pyodide?: string;
}

export type FormulaWorkerRequest =
  | { type: 'evaluate'; id: number; request: FormulaRequest }
  | { type: 'rename'; id: number; request: RenameRequest };

export type FormulaWorkerMessage =
  | FormulaStatusEvent
  | { type: 'result'; id: number; response: FormulaResponse }
  | { type: 'renamed'; id: number; response: RenameResponse }
  | { type: 'error'; id: number; message: string; code?: string };
