import { describe, expect, it } from 'vitest';
import { KernelTaskQueue } from '../src/kernel/scheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('KernelTaskQueue', () => {
  it('runs tasks one at a time in order', async () => {
    const queue = new KernelTaskQueue();
    const events: string[] = [];
    const first = deferred<void>();

    const a = queue.enqueue({
      label: 'a',
      run: async () => {
        events.push('a:start');
        await first.promise;
        events.push('a:end');
      },
    });
    const b = queue.enqueue({
      label: 'b',
      run: async () => {
        events.push('b:start');
      },
    });

    await Promise.resolve();
    expect(events).toEqual(['a:start']);
    expect(queue.snapshot().map((task) => task.status)).toEqual(['running', 'queued']);

    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);
    expect(queue.snapshot()).toEqual([]);
  });

  it('drops queued tasks after a failure', async () => {
    const queue = new KernelTaskQueue();

    const failing = queue.enqueue({
      label: 'failing',
      run: async () => {
        throw new Error('boom');
      },
    });
    const skipped = queue.enqueue({ label: 'skipped', run: async () => 'never' });
    const skippedOutcome = skipped.catch((error: Error) => error.name);

    await expect(failing).rejects.toThrow('boom');
    await expect(skipped).rejects.toThrow('boom');
    expect(await skippedOutcome).toBe('Error');
    expect(queue.snapshot()).toEqual([]);
  });

  it('replaces a queued task with the same key', async () => {
    const queue = new KernelTaskQueue();
    const gate = deferred<void>();
    const started: string[] = [];

    const blocker = queue.enqueue({
      label: 'blocker',
      run: async () => {
        await gate.promise;
      },
    });
    const stale = queue.enqueue({
      label: 'stale',
      key: 'rebuild',
      run: async () => {
        started.push('stale');
      },
    });
    const fresh = queue.enqueue({
      label: 'fresh',
      key: 'rebuild',
      run: async () => {
        started.push('fresh');
      },
    });

    await expect(stale).rejects.toThrow('Superseded');
    gate.resolve();
    await Promise.all([blocker, fresh]);
    expect(started).toEqual(['fresh']);
  });

  it('cancels the running task and the queue', async () => {
    const queue = new KernelTaskQueue();
    const running = deferred<void>();
    const active = queue.enqueue({
      label: 'active',
      run: async () => {
        await running.promise;
      },
    });
    const queued = queue.enqueue({ label: 'queued', run: async () => 'never' });
    const activeOutcome = active.catch((error: Error) => error.name);
    const queuedOutcome = queued.catch((error: Error) => error.name);

    await Promise.resolve();
    expect(queue.cancel()).toBe(2);
    expect(await activeOutcome).toBe('AbortError');
    expect(await queuedOutcome).toBe('AbortError');
    expect(queue.snapshot()).toEqual([]);

    running.resolve();
    await Promise.resolve();
    expect(queue.snapshot()).toEqual([]);
  });
});
