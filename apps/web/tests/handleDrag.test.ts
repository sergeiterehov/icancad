import { describe, expect, it } from 'vitest';
import { handleDragValue } from '../src/quick/handleDrag';

describe('handle drag math', () => {
  const base = { axisX: 1, axisY: 0, pixelsPerMm: 4 };

  it('maps screen movement along the axis to millimetres', () => {
    expect(handleDragValue({ ...base, startValue: 0, deltaX: 100, deltaY: 0 })).toBe(25);
  });

  it('ignores movement across the axis', () => {
    expect(handleDragValue({ ...base, startValue: 3, deltaX: 0, deltaY: 80 })).toBe(3);
  });

  it('continues from the current distance in both directions', () => {
    expect(handleDragValue({ ...base, startValue: 9, deltaX: -48, deltaY: 0 })).toBe(-3);
  });

  it('amplifies rather than dividing by zero when the axis faces the camera', () => {
    const value = handleDragValue({
      ...base,
      pixelsPerMm: 0.01,
      startValue: 0,
      deltaX: 10,
      deltaY: 0,
    });
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(50);
  });
});
