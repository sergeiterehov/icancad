import { describe, expect, it } from 'vitest';
import type { SketchEntity } from '@icancad/model';
import {
  entityEndpoints,
  moveEntityControlPoint,
  tessellateEntity,
  translateEntity,
  unwrapAngle,
} from '../src/index';

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

  it('translates whole entities for drag moves', () => {
    const line: SketchEntity = {
      id: 'l1',
      type: 'line',
      construction: false,
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 5,
    };
    expect(translateEntity(line, 4, -2)).toMatchObject({ x1: 4, y1: -2, x2: 14, y2: 3 });

    const arc: SketchEntity = {
      id: 'a1',
      type: 'arc',
      construction: false,
      cx: 0,
      cy: 0,
      r: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    expect(translateEntity(arc, 3, 7)).toMatchObject({ cx: 3, cy: 7, r: 10 });
  });
});

describe('arc angle continuity', () => {
  const arc: SketchEntity = {
    id: 'a1',
    type: 'arc',
    construction: false,
    cx: 0,
    cy: 0,
    r: 10,
    startAngle: Math.PI,
    endAngle: 0,
  };

  it('keeps the start angle on its branch when the handle crosses it', () => {
    const moved = moveEntityControlPoint(arc, 1, [-10, -0.5]);
    expect(moved.type).toBe('arc');
    if (moved.type !== 'arc') return;
    expect(moved.startAngle).toBeGreaterThan(Math.PI);
    expect(moved.endAngle - moved.startAngle).toBeLessThan(0);
  });

  it('unwraps an angle to the representation closest to the reference', () => {
    expect(unwrapAngle(-Math.PI + 0.01, Math.PI)).toBeCloseTo(Math.PI + 0.01, 6);
    expect(unwrapAngle(Math.PI - 0.01, -Math.PI)).toBeCloseTo(-Math.PI - 0.01, 6);
    expect(unwrapAngle(0.5, 0.4)).toBeCloseTo(0.5, 6);
  });
});
