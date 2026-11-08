import { parseStl } from '@icancad/io';

interface ParseRequest {
  id: number;
  type: 'parse-stl';
  bytes: Uint8Array;
}

interface IoWorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

const scope = self as unknown as IoWorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === 'parse-stl') {
      const mesh = parseStl(request.bytes);
      scope.postMessage({ id: request.id, ok: true, result: mesh }, [
        mesh.positions.buffer,
        mesh.normals.buffer,
        mesh.indices.buffer,
      ]);
      return;
    }
    throw new Error(`Unknown IO request`);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
