import type { Feature } from '@icancad/model';
import { beforeEach, describe, expect, it } from 'vitest';
import { timelineDuration, useKernelStore } from '../src/stores/kernelStore';

const feature = (id: string, suppressed = false) => ({ id, suppressed }) as Feature;

describe('timeline timing', () => {
  beforeEach(() => {
    useKernelStore.setState({ operationMs: {} });
  });

  it('sums the measured operations and skips suppressed ones', () => {
    const features = [feature('a'), feature('b', true), feature('c')];
    expect(timelineDuration(features, { a: 12, b: 8, c: 4 })).toBe(16);
    expect(timelineDuration(features, { a: 12 })).toBe(12);
  });

  it('records one duration per operation and clears them with the scene', () => {
    useKernelStore.getState().setOperationMs('a', 12.5);
    useKernelStore.getState().setOperationMs('b', 3);
    expect(useKernelStore.getState().operationMs).toEqual({ a: 12.5, b: 3 });
    useKernelStore.getState().clearScene();
    expect(useKernelStore.getState().operationMs).toEqual({});
  });
});
