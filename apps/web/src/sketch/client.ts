import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { useSketchSolverStore } from '../stores/sketchSolverStore';
import type { SketchSolveResponse, SketchSolveResult, SolverPin } from './protocol';

interface Pending {
  resolve: (result: SketchSolveResult) => void;
  reject: (error: Error) => void;
  startedAt: number;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'icancad-sketch-solver',
  });
  worker.onmessage = (event: MessageEvent<SketchSolveResponse>) => {
    const data = event.data;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    useSketchSolverStore.getState().end(performance.now() - request.startedAt);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Sketch solver crashed');
    for (const request of pending.values()) {
      useSketchSolverStore.getState().end(performance.now() - request.startedAt);
      request.reject(error);
    }
    pending.clear();
    worker = null;
  };
  return worker;
}

export function solveSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SolverPin[] = [],
  options: { diagnose?: boolean; derived?: readonly string[] } = {},
): Promise<SketchSolveResult> {
  const id = ++sequence;
  const active = getWorker();
  const startedAt = performance.now();
  useSketchSolverStore.getState().begin();
  return new Promise<SketchSolveResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, startedAt });
    try {
      active.postMessage({
        id,
        entities,
        constraints,
        pinned,
        derived: options.derived ? [...options.derived] : undefined,
        diagnose: options.diagnose,
      });
    } catch (error) {
      pending.delete(id);
      useSketchSolverStore.getState().end(performance.now() - startedAt);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
