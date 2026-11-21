export type KernelTaskStatus = 'queued' | 'running';

export interface KernelTask {
  id: number;
  key: string | null;
  label: string;
  status: KernelTaskStatus;
}

export interface KernelTaskOptions<T> {
  label: string;
  key?: string;
  run: () => Promise<T>;
  /**
   * Called when a newer task with the same key arrives while this one runs.
   * The queue is one worker wide, so the running task still has to answer its
   * current request; this asks it to stop at the next place it can.
   */
  supersede?: () => void;
}

export class KernelTaskCancelledError extends Error {
  constructor(message = 'Kernel task cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

interface QueueEntry {
  id: number;
  key: string | null;
  label: string;
  run: () => Promise<unknown>;
  supersede?: () => void;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type Listener = (tasks: KernelTask[]) => void;

export class KernelTaskQueue {
  private sequence = 0;
  private queue: QueueEntry[] = [];
  private running: { entry: QueueEntry; abandoned: boolean } | null = null;
  private readonly listeners = new Set<Listener>();

  enqueue<T>(options: KernelTaskOptions<T>): Promise<T> {
    const key = options.key ?? null;
    if (key) {
      const index = this.queue.findIndex((entry) => entry.key === key);
      if (index >= 0) {
        const [stale] = this.queue.splice(index, 1);
        if (stale) {
          stale.reject(new KernelTaskCancelledError('Superseded by a newer task'));
          this.emit();
        }
      }
      // A running task with the same key is work nobody will see any more.
      // It cannot be cancelled in the worker without losing the request it is
      // waiting on, but it can stop at its next step.
      if (this.running?.entry.key === key) this.running.entry.supersede?.();
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: ++this.sequence,
        key,
        label: options.label,
        run: options.run as () => Promise<unknown>,
        supersede: options.supersede,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.emit();
      void this.pump();
    });
  }

  cancel(reason: Error = new KernelTaskCancelledError()): number {
    const queued = this.queue.splice(0);
    for (const entry of queued) entry.reject(reason);

    let cancelled = queued.length;
    if (this.running) {
      this.running.abandoned = true;
      this.running.entry.reject(reason);
      this.running = null;
      cancelled += 1;
    }

    this.emit();
    return cancelled;
  }

  snapshot(): KernelTask[] {
    const tasks: KernelTask[] = [];
    if (this.running) {
      tasks.push({
        id: this.running.entry.id,
        key: this.running.entry.key,
        label: this.running.entry.label,
        status: 'running',
      });
    }
    for (const entry of this.queue) {
      tasks.push({ id: entry.id, key: entry.key, label: entry.label, status: 'queued' });
    }
    return tasks;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const entry = this.queue.shift();
    if (!entry) {
      this.emit();
      return;
    }

    const slot = { entry, abandoned: false };
    this.running = slot;
    this.emit();

    try {
      const result = await entry.run();
      if (!slot.abandoned) entry.resolve(result);
    } catch (error) {
      if (!slot.abandoned) {
        const failure = error instanceof Error ? error : new Error(String(error));
        entry.reject(failure);
        this.cancelQueued(failure);
      }
    } finally {
      if (this.running === slot) {
        this.running = null;
        this.emit();
        void this.pump();
      }
    }
  }

  private cancelQueued(reason: Error): void {
    const queued = this.queue.splice(0);
    for (const entry of queued) entry.reject(reason);
    if (queued.length > 0) this.emit();
  }

  private emit(): void {
    const tasks = this.snapshot();
    for (const listener of this.listeners) listener(tasks);
  }
}

export const kernelTaskQueue = new KernelTaskQueue();
