import { describe, expect, it } from 'vitest';
import { arcDraftEndAngle, arcStartAngle } from '../src/sketch/arcDraft';

describe('arc draft angles', () => {
  const origin: [number, number] = [0, 0];
  const start: [number, number] = [10, 0];

  it('measures the start point around the centre', () => {
    expect(arcStartAngle(origin, [0, 10])).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps the sweep when the third point crosses the atan2 branch cut', () => {
    const previous = Math.PI - 0.05;
    const point: [number, number] = [Math.cos(Math.PI + 0.02) * 10, Math.sin(Math.PI + 0.02) * 10];
    expect(arcDraftEndAngle(origin, start, point, previous)).toBeCloseTo(Math.PI + 0.02, 6);
  });

  it('starts a small clockwise sweep from the start angle', () => {
    expect(arcDraftEndAngle(origin, start, [10, -0.01], 0)).toBeLessThan(0);
  });

  it('stops at one full turn', () => {
    const point: [number, number] = [Math.cos(0.1) * 10, Math.sin(0.1) * 10];
    expect(arcDraftEndAngle(origin, start, point, Math.PI * 2 - 0.01)).toBeCloseTo(Math.PI * 2, 6);
  });
});
