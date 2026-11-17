import { describe, expect, it } from 'vitest';
import { FormulaEngineClient } from '../src/client';
import type {
  FormulaResponse,
  FormulaWorkerMessage,
  FormulaWorkerRequest,
  RenameResponse,
} from '../src/protocol';

type Handler = ((event: MessageEvent<FormulaWorkerMessage>) => void) | null;

/** A worker that answers like the real runtime, without Pyodide. */
class FakeWorker {
  onmessage: Handler = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  requests: FormulaWorkerRequest[] = [];
  postMessage(message: FormulaWorkerRequest): void {
    this.requests.push(message);
    if (message.type === 'evaluate') {
      const response = {
        variables: [],
        results: [{ targetId: 'feat', path: 'params.dx', value: 12.5 }],
        engine: { python: '3.13', pyodide: '0.28' },
      } satisfies FormulaResponse;
      queueMicrotask(() => this.emit({ type: 'result', id: message.id, response }));
      return;
    }
    const response = {
      variables: message.request.variables,
      expressions: message.request.expressions.map((source) => ({
        ...source,
        source: source.source.split(message.request.oldName).join(message.request.newName),
      })),
    } satisfies RenameResponse;
    queueMicrotask(() => this.emit({ type: 'renamed', id: message.id, response }));
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(message: FormulaWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<FormulaWorkerMessage>);
  }

  announceReady(): void {
    this.emit({ type: 'status', phase: 'ready' });
  }
}

function clientWith(worker: FakeWorker): FormulaEngineClient {
  // The worker announces readiness once the client has attached its handler.
  return new FormulaEngineClient(() => {
    queueMicrotask(() => worker.announceReady());
    return worker as unknown as Worker;
  });
}

describe('formula engine client', () => {
  it('resolves an evaluation once the worker is ready', async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    await client.boot();
    const response = await client.evaluate({
      variables: [],
      expressions: [{ targetId: 'feat', path: 'params.dx', source: '5 * 2.5' }],
    });
    expect(response.results[0]).toMatchObject({ path: 'params.dx', value: 12.5 });
    expect(worker.requests).toHaveLength(1);
  });

  it('rewrites a variable name in the sources it is given', async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    await client.boot();
    const response = await client.rename({
      oldName: 'width',
      newName: 'w',
      variables: [{ id: 'var_1', name: 'width', type: 'number', source: '10' }],
      expressions: [{ targetId: 'feat', path: 'params.dx', source: 'width / 2' }],
    });
    expect(response.expressions[0]?.source).toBe('w / 2');
    expect(response.variables[0]?.source).toBe('10');
  });

  it('rejects a failed request', async () => {
    const worker = new FakeWorker();
    const client = new FormulaEngineClient(() => worker as unknown as Worker);
    const booted = client.boot();
    worker.announceReady();
    await booted;
    worker.postMessage = (message) => {
      queueMicrotask(() =>
        worker.onmessage?.({
          data: { type: 'error', id: message.id, message: 'boom' },
        } as MessageEvent<FormulaWorkerMessage>),
      );
    };
    await expect(client.evaluate({ variables: [], expressions: [] })).rejects.toThrow('boom');
  });
});
