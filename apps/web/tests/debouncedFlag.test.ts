import { describe, expect, it } from 'vitest';
import { debouncedFlag, type DebouncedFlagState } from '../src/hooks/useDebouncedFlag';

function run(values: Array<[boolean, number]>, delay = 100): DebouncedFlagState {
  const initial: DebouncedFlagState = { visible: false, since: null };
  return values.reduce<DebouncedFlagState>(
    (state, [value, now]) => debouncedFlag(state, value, now, delay),
    initial,
  );
}

describe('debouncedFlag', () => {
  it('hides work that finishes before the delay', () => {
    const state = run([
      [true, 0],
      [false, 40],
    ]);
    expect(state.visible).toBe(false);
  });

  it('shows work that lasts the whole delay', () => {
    const state = run([
      [true, 0],
      [true, 60],
      [true, 100],
    ]);
    expect(state.visible).toBe(true);
  });

  it('hides at once when the work is over', () => {
    const state = run([
      [true, 0],
      [true, 100],
      [false, 101],
    ]);
    expect(state.visible).toBe(false);
  });

  it('starts the delay again after a gap', () => {
    const state = run([
      [true, 0],
      [false, 50],
      [true, 60],
      [true, 120],
    ]);
    expect(state.visible).toBe(false);
  });

  it('shows at once without a delay', () => {
    expect(debouncedFlag({ visible: false, since: null }, true, 0, 0).visible).toBe(true);
  });
});
