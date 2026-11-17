import type {
  FormulaRequest,
  FormulaResponse,
  FormulaStatusEvent,
  FormulaWorkerMessage,
  FormulaWorkerRequest,
  RenameRequest,
  RenameResponse,
} from './protocol';

type WorkerResponse = FormulaResponse | RenameResponse;

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread half of the formula engine. The worker is created once and kept:
 * Pyodide costs seconds to start, and every later evaluation is a short batch.
 */
export class FormulaEngineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private booted: Promise<void> | null = null;

  onStatus?: (event: FormulaStatusEvent) => void;

  constructor(private readonly createWorker: () => Worker) {}

  boot(): Promise<void> {
    if (this.booted) return this.booted;
    this.booted = new Promise<void>((resolve, reject) => {
      this.ready = { resolve, reject };
      this.worker = this.createWorker();
      this.worker.onmessage = (event: MessageEvent<FormulaWorkerMessage>) =>
        this.handle(event.data);
      this.worker.onerror = (event) => this.fail(new Error(event.message || 'FORMULA_WORKER'));
    });
    return this.booted;
  }

  evaluate(request: FormulaRequest): Promise<FormulaResponse> {
    return this.send<FormulaResponse>({ type: 'evaluate', id: 0, request });
  }

  /** Rewrites a variable name inside every formula the project holds. */
  rename(request: RenameRequest): Promise<RenameResponse> {
    return this.send<RenameResponse>({ type: 'rename', id: 0, request });
  }

  private send<T extends WorkerResponse>(message: FormulaWorkerRequest): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('FORMULA_NOT_STARTED'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (response: WorkerResponse) => void, reject });
      worker.postMessage({ ...message, id });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.booted = null;
    this.ready = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('FORMULA_TERMINATED'));
    }
    this.pending.clear();
  }

  private handle(message: FormulaWorkerMessage): void {
    if (message.type === 'status') {
      this.onStatus?.(message);
      if (message.phase === 'ready') {
        this.ready?.resolve();
        this.ready = null;
      } else if (message.phase === 'error') {
        const error = new Error(message.message ?? 'FORMULA_LOAD_FAILED');
        this.ready?.reject(error);
        this.ready = null;
        this.fail(error);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.type === 'error') pending.reject(new Error(message.message));
    else pending.resolve(message.response);
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.ready?.reject(error);
    this.ready = null;
  }
}
