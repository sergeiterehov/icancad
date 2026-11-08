import type {
  KernelRequest,
  KernelRequestPayload,
  KernelResponse,
  KernelStatusEvent,
} from './protocol';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function isStatusEvent(
  data: KernelResponse | KernelStatusEvent,
): data is KernelStatusEvent {
  return 'type' in data && data.type === 'status';
}

export class KernelClient {
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  onStatus?: (event: KernelStatusEvent) => void;

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<KernelResponse | KernelStatusEvent>) => {
      const data = event.data;
      if (isStatusEvent(data)) {
        this.onStatus?.(data);
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        const error = new Error(data.error.message);
        error.name = data.error.code;
        pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Kernel worker crashed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.onStatus?.({ type: 'status', phase: 'error', message: error.message });
    };
  }

  request<T>(payload: KernelRequestPayload): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Kernel client is closed'));
    }
    const id = ++this.sequence;
    const request: KernelRequest = { ...payload, id };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage(request);
    });
  }

  terminate(): void {
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Kernel client terminated'));
    }
    this.pending.clear();
  }
}
