import type { ParsedMesh } from '@icancad/io';

interface Pending {
  resolve: (mesh: ParsedMesh) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'icancad-io',
  });
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { id: number; ok: true; result: ParsedMesh }
      | { id: number; ok: false; error: string };
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.ok) request.resolve(data.result);
    else request.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'IO worker crashed');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker = null;
  };
  return worker;
}

export function parseStlInWorker(bytes: Uint8Array): Promise<ParsedMesh> {
  const id = ++sequence;
  const active = getWorker();
  return new Promise<ParsedMesh>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    active.postMessage({ id, type: 'parse-stl', bytes }, [bytes.buffer]);
  });
}
