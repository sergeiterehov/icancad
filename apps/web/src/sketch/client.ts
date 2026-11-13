import type { SketchConstraint, SketchEntity } from '@icancad/model';
import type { SketchSolveResponse, SketchSolveResult, SolverPin } from './protocol';

interface Pending {
  resolve: (result: SketchSolveResult) => void;
  reject: (error: Error) => void;
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
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Sketch solver crashed');
    for (const request of pending.values()) request.reject(error);
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
  return new Promise<SketchSolveResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    active.postMessage({
      id,
      entities,
      constraints,
      pinned,
      derived: options.derived ? [...options.derived] : undefined,
      diagnose: options.diagnose,
    });
  });
}
