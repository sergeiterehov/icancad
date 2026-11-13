import type { SketchFrame } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  projectPointToFrame,
  projectPolylineToFrame,
  sketchCurveFromPolyline,
  sketchPointFromProjected,
} from '../src/projection';
import type { Point2 } from '../src/index';

const xy: SketchFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function ring(cx: number, cy: number, rx: number, ry: number, steps = 48): Point2[] {
  const points: Point2[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  sweep: number,
  steps = 24,
): Point2[] {
  const points: Point2[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = start + (sweep * index) / steps;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return points;
}

describe('sketch projection math', () => {
  it('projects world points onto the sketch plane', () => {
    expect(projectPointToFrame(xy, [3, 4, 9])).toEqual([3, 4]);
    const tilted: SketchFrame = {
      origin: [10, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    };
    expect(projectPolylineToFrame(tilted, [[10, 2, 3]])).toEqual([[2, 3]]);
  });

  it('maps a straight polyline to a line', () => {
    const curve = sketchCurveFromPolyline(
      [
        [0, 0],
        [5, 0.0000001],
        [10, 0],
      ],
      false,
    );
    expect(curve).toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 });
  });

  it('maps a closed ring to a circle', () => {
    const curve = sketchCurveFromPolyline(ring(2, -3, 5, 5), true);
    expect(curve?.type).toBe('circle');
    if (curve?.type !== 'circle') return;
    expect(curve.cx).toBeCloseTo(2, 6);
    expect(curve.cy).toBeCloseTo(-3, 6);
    expect(curve.r).toBeCloseTo(5, 6);
  });

  it('maps a closed ellipse to an ellipse', () => {
    const curve = sketchCurveFromPolyline(ring(1, 2, 8, 3), true);
    expect(curve?.type).toBe('ellipse');
    if (curve?.type !== 'ellipse') return;
    expect(Math.max(curve.rx, curve.ry)).toBeCloseTo(8, 5);
    expect(Math.min(curve.rx, curve.ry)).toBeCloseTo(3, 5);
  });

  it('keeps the sweep direction of projected arcs', () => {
    const counterClockwise = sketchCurveFromPolyline(arcPoints(0, 0, 10, 0, Math.PI), false);
    expect(counterClockwise?.type).toBe('arc');
    if (counterClockwise?.type !== 'arc') return;
    expect(counterClockwise.r).toBeCloseTo(10, 6);
    expect(counterClockwise.endAngle - counterClockwise.startAngle).toBeCloseTo(Math.PI, 4);

    const clockwise = sketchCurveFromPolyline(arcPoints(0, 0, 10, Math.PI, -Math.PI * 1.5), false);
    expect(clockwise?.type).toBe('arc');
    if (clockwise?.type !== 'arc') return;
    expect(clockwise.endAngle - clockwise.startAngle).toBeCloseTo(-Math.PI * 1.5, 4);
  });

  it('falls back to a Bezier for a free-form polyline', () => {
    const points: Point2[] = [];
    for (let index = 0; index <= 20; index += 1) {
      const t = index / 20;
      points.push([t * 10, Math.sin(t * Math.PI * 2) * 5 + t * 3]);
    }
    const curve = sketchCurveFromPolyline(points, false);
    expect(curve?.type).toBe('bezier');
    if (curve?.type !== 'bezier') return;
    expect(curve.points[0]).toEqual([0, 0]);
    expect(curve.points[curve.points.length - 1]?.[0]).toBeCloseTo(10, 6);
  });

  it('builds a point entity', () => {
    expect(sketchPointFromProjected([4, 5])).toEqual({
      type: 'point',
      construction: false,
      x: 4,
      y: 5,
    });
  });
});
