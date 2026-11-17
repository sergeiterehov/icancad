import { describe, expect, it } from 'vitest';
import { gridLineRange, niceGridStep } from '../src/viewport/sketchGrid';

describe('sketch grid scale', () => {
  it('keeps the chosen step within a readable factor of the target', () => {
    for (const raw of [0.0007, 0.003, 0.013, 0.07, 0.35, 1, 3.3, 7, 20, 130, 980]) {
      const step = niceGridStep(raw);
      expect(step).toBeGreaterThanOrEqual(raw);
      expect(step / raw).toBeLessThanOrEqual(2);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });

  it('covers the visible range with absolute line multiples', () => {
    const center = 12.3;
    const extent = 47.9;
    const step = 5;
    const { start, end } = gridLineRange(center, extent, step);
    expect(start * step).toBeLessThanOrEqual(center - extent);
    expect(end * step).toBeGreaterThanOrEqual(center + extent);
    expect(start).toBe(Math.floor((center - extent) / step));
  });
});
