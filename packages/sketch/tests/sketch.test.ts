import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import { entityEndpoints, tessellateEntity } from '../src/index';

describe('sketch entity tessellation', () => {
  it('tessellates lines and circles', () => {
    const line: SketchEntity = {
      id: 'l1',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 5,
    };
    expect(tessellateEntity(line)).toEqual([
      [0, 0],
      [10, 5],
    ]);

    const circle: SketchEntity = {
      id: 'c1',
      type: 'circle',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
    };
    const points = tessellateEntity(circle, 8);
    expect(points).toHaveLength(8);
    for (const [x, y] of points) {
      expect(Math.hypot(x, y)).toBeCloseTo(10, 6);
    }
  });

  it('evaluates bezier curves at endpoints', () => {
    const bezier: SketchEntity = {
      id: 'b1',
      type: 'bezier',
      construction: false,
      points: [
        [0, 0],
        [5, 10],
        [10, 0],
      ],
    };
    const points = tessellateEntity(bezier, 10);
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual([0, 0]);
    expect(points[10]?.[0]).toBeCloseTo(10, 6);
    expect(points[10]?.[1]).toBeCloseTo(0, 6);
    expect(entityEndpoints(bezier)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });
});
