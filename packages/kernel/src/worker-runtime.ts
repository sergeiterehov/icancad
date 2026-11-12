import { KernelEngine, KernelOpError, type OcctLoader } from './engine';
import { loadOcctBrowser } from './occt-browser';
import type {
  KernelFailure,
  KernelRequest,
  KernelSuccess,
  KernelStatusEvent,
} from './protocol';

export interface KernelWorkerScope {
  location: { origin: string };
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<KernelRequest>) => void) | null;
}

export interface KernelWorkerOptions {
  wasmUrl?: string;
  scope?: KernelWorkerScope;
}

export function startKernelWorker(options: KernelWorkerOptions = {}): void {
  const scope = options.scope ?? (self as unknown as KernelWorkerScope);
  const wasmUrl =
    options.wasmUrl ?? new URL('/occt/opencascade.wasm.wasm', scope.location.origin).href;

  const loader: OcctLoader = (onProgress) => loadOcctBrowser(wasmUrl, onProgress);
  const postStatus = (event: KernelStatusEvent) => scope.postMessage(event);
  const engine = new KernelEngine(loader, postStatus);

  scope.onmessage = async (event: MessageEvent<KernelRequest>) => {
    const request = event.data;
    try {
      switch (request.type) {
        case 'health': {
          const result = await engine.init();
          postSuccess(scope, request.id, result);
          break;
        }
        case 'make-box': {
          await engine.init();
          postSuccess(scope, request.id, engine.makeBox(request.params));
          break;
        }
        case 'make-prism': {
          await engine.init();
          postSuccess(scope, request.id, engine.makePrism(request.params));
          break;
        }
        case 'make-face-prism': {
          await engine.init();
          postSuccess(scope, request.id, engine.makeFacePrism(request.params));
          break;
        }
        case 'boolean': {
          await engine.init();
          postSuccess(scope, request.id, engine.booleanShape(request.params));
          break;
        }
        case 'split-solids': {
          await engine.init();
          postSuccess(scope, request.id, engine.splitSolids(request.params));
          break;
        }
        case 'edge-treatment': {
          await engine.init();
          postSuccess(scope, request.id, engine.treatEdges(request.params));
          break;
        }
        case 'tessellate': {
          await engine.init();
          const result = engine.tessellate(request.shapeId, request.quality);
          const transfer: Transferable[] = [
            result.positions.buffer,
            result.normals.buffer,
            result.indices.buffer,
            result.faceIds.buffer,
          ];
          postSuccess(scope, request.id, result, transfer);
          break;
        }
        case 'topology': {
          await engine.init();
          postSuccess(scope, request.id, engine.shapeStats(request.shapeId));
          break;
        }
        case 'dispose': {
          postSuccess(scope, request.id, { disposed: engine.dispose(request.shapeId) });
          break;
        }
        default: {
          const neverRequest: never = request;
          throw new KernelOpError(
            'INVALID_PARAMS',
            `Unknown kernel request: ${JSON.stringify(neverRequest)}`,
          );
        }
      }
    } catch (error) {
      const failure: KernelFailure = {
        id: request.id,
        ok: false,
        error: {
          code: error instanceof KernelOpError ? error.code : 'OP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      };
      scope.postMessage(failure);
    }
  };
}

function postSuccess(
  scope: KernelWorkerScope,
  id: number,
  result: unknown,
  transfer: Transferable[] = [],
): void {
  const success: KernelSuccess = { id, ok: true, result };
  scope.postMessage(success, transfer);
}
