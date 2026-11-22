import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  entityControlPoints,
  entityEndpoints,
  sketchProfiles,
  tessellateEntity,
  translateEntity,
  moveEntityControlPoint,
} from '../src/index';

const arc: SketchEntity = {
  id: 'arc',
  type: 'elliptical-arc',
  construction: false,
  cx: 0,
  cy: 0,
  rx: 10,
  ry: 5,
  rotation: 0,
  startAngle: 0,
  endAngle: Math.PI,
};

function ellipseArcPoint(angle: number): [number, number] {
  return [Math.cos(angle) * 10, Math.sin(angle) * 5];
}

describe('elliptical arc geometry', () => {
  it('tessellates only the sweep between its ends', () => {
    const points = tessellateEntity(arc, 16);
    expect(points).toHaveLength(17);
    expect(points[0]![0]).toBeCloseTo(10);
    expect(points[0]![1]).toBeCloseTo(0);
    expect(points[16]![0]).toBeCloseTo(-10);
    expect(points[16]![1]).toBeCloseTo(0);
    expect(points.every((point) => point[1] >= -1e-9)).toBe(true);
  });

  it('reports its ends, centre and both semi-axes as control points', () => {
    expect(entityEndpoints(arc)).toEqual([ellipseArcPoint(0), ellipseArcPoint(Math.PI)]);
    const control = entityControlPoints(arc);
    expect(control).toHaveLength(5);
    expect(control[0]).toEqual([0, 0]);
    expect(control[1]![0]).toBeCloseTo(10);
    expect(control[2]![1]).toBeCloseTo(5);
    expect(control[3]![0]).toBeCloseTo(10);
    expect(control[4]![0]).toBeCloseTo(-10);
  });

  it('rotates its points with the ellipse', () => {
    const turned = { ...arc, rotation: 90 } as SketchEntity;
    const start = entityEndpoints(turned)![0];
    expect(start[0]).toBeCloseTo(0);
    expect(start[1]).toBeCloseTo(10);
  });

  it('translates and resizes through its handles', () => {
    expect(translateEntity(arc, 3, -2)).toMatchObject({ cx: 3, cy: -2, rx: 10, ry: 5 });
    const wider = moveEntityControlPoint(arc, 1, [14, 0]);
    expect(wider).toMatchObject({ rx: 14, rotation: 0, startAngle: 0, endAngle: Math.PI });
    const taller = moveEntityControlPoint(arc, 2, [0, 9]);
    expect(taller).toMatchObject({ rx: 10, ry: 9 });
  });

  it('moves an end within the ellipse without changing its size', () => {
    const moved = moveEntityControlPoint(arc, 4, [-10, 0]);
    expect(moved).toMatchObject({ rx: 10, ry: 5 });
    if (moved.type !== 'elliptical-arc') return;
    expect(moved.endAngle).toBeCloseTo(Math.PI);
  });

  it('builds a closed profile from the arc and a closing line', () => {
    const base: SketchEntity = {
      id: 'base',
      type: 'line',
      construction: false,
      x1: -10,
      y1: 0,
      x2: 10,
      y2: 0,
    };
    const [region] = sketchProfiles([arc, base]);
    expect(region).toBeDefined();
    // The sampled half ellipse is slightly smaller than the exact one.
    expect(region!.area).toBeGreaterThan(70);
    expect(region!.area).toBeLessThan(Math.PI * 10 * 5 * 0.5);
    expect([...region!.outer.keys]).toContain('arc');
  });
});
