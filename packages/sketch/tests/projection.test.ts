import type { SketchFrame } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  projectPointToFrame,
  projectPolylineToFrame,
  polylineSagitta,
  sketchCurveFromPolyline,
  sketchCurvesFromPolyline,
  sketchPointFromProjected,
  stitchCurves,
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

  it('maps a ring seen edge-on to a line across it', () => {
    // Every point of a horizontal circle lands on one horizontal segment; the
    // polyline starts at one end and runs out and back.
    const edgeOn: Point2[] = [];
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      edgeOn.push([Math.cos(angle) * 9, 30]);
    }
    const curve = sketchCurveFromPolyline(edgeOn, true);
    expect(curve).toMatchObject({ type: 'line', y1: 30, y2: 30 });
    if (curve?.type !== 'line') return;
    expect(Math.min(curve.x1, curve.x2)).toBeCloseTo(-9, 6);
    expect(Math.max(curve.x1, curve.x2)).toBeCloseTo(9, 6);
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

  it('keeps Bezier poles near a nearly straight curve', () => {
    const nearlyFlat: Point2[] = [];
    for (let index = 0; index <= 20; index += 1) {
      const t = index / 20;
      nearlyFlat.push([t * 10, Math.sin(t * Math.PI) * 0.05]);
    }
    const curve = sketchCurveFromPolyline(nearlyFlat, false);
    if (curve?.type === 'bezier') {
      for (const [x, y] of curve.points) {
        expect(x).toBeGreaterThan(-10);
        expect(x).toBeLessThan(20);
        expect(Math.abs(y)).toBeLessThan(1);
      }
    } else if (curve?.type === 'line') {
      expect(Math.abs(curve.y1 - curve.y2)).toBeLessThan(0.1);
    }
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

  it('splits a long contour into lines and arcs instead of one Bezier', () => {
    // A profile of two tangent arcs, sampled the way a mesh samples a surface.
    const points: Point2[] = [];
    for (let index = 0; index <= 20; index += 1) {
      const angle = (index / 20) * Math.PI;
      points.push([10 - Math.cos(angle) * 10, Math.sin(angle) * 10]);
    }
    for (let index = 1; index <= 10; index += 1) {
      const angle = (index / 10) * Math.PI;
      points.push([10 + Math.cos(angle) * 5, -Math.sin(angle) * 5 - 5]);
    }
    const single = sketchCurveFromPolyline(points, false);
    expect(single?.type).toBe('bezier');
    const curves = sketchCurvesFromPolyline(points, false);
    expect(curves.length).toBeGreaterThan(1);
    for (const curve of curves) {
      expect(['line', 'arc', 'circle']).toContain(curve.type);
    }
  });

  it('accepts a fit as loose as the sampling of the polyline', () => {
    // Samples of a circle that sit a little inside it: a tighter fit would
    // report a Bezier for geometry that is clearly an arc.
    const points = arcPoints(0, 0, 10, 0, Math.PI / 2).map(([x, y], index) => {
      // Samples that wobble either side of the circle, as a mesh would.
      const wobble = (index % 2 === 0 ? 1 : -1) * 0.02;
      const scale = 1 + wobble / 10;
      return [x * scale, y * scale] as Point2;
    });
    expect(sketchCurveFromPolyline(points, false)?.type).toBe('bezier');
    const tolerance = polylineSagitta(points);
    expect(tolerance).toBeGreaterThan(0);
    const curve = sketchCurveFromPolyline(points, false, { tolerance: tolerance * 40 });
    expect(curve?.type).toBe('arc');
  });

  it('keeps a noisy straight edge a line instead of a huge-radius arc', () => {
    // A silhouette read from a mesh wobbles by a few hundredths of a millimetre;
    // fitting that as an arc gives a radius of half a metre, which is no use.
    const points: Point2[] = [];
    for (let index = 0; index <= 12; index += 1) {
      const t = index / 12;
      points.push([t * 10, (index % 2 === 0 ? 1 : -1) * 0.02]);
    }
    // The tolerance a mesh-sampled polyline earns is its own sagitta.
    const curve = sketchCurveFromPolyline(points, false, { tolerance: 0.05 });
    expect(curve?.type).toBe('line');
  });

  it('joins the ends of curves that are meant to meet', () => {
    const first = sketchCurveFromPolyline(
      [
        [0, 0],
        [5, 0],
      ],
      false,
    )!;
    const second = sketchCurveFromPolyline(
      [
        [5.05, 0.03],
        [5.05, 4],
        [4.9, 8],
      ],
      false,
    )!;
    const stitched = stitchCurves([first, second], 0.2);
    const firstEnd = [stitched[0]!.type === 'line' ? stitched[0]!.x2 : 0, stitched[0]!.type === 'line' ? stitched[0]!.y2 : 0];
    const secondStart =
      stitched[1]!.type === 'line'
        ? [stitched[1]!.x1, stitched[1]!.y1]
        : stitched[1]!.type === 'arc'
          ? [
              stitched[1]!.cx + Math.cos(stitched[1]!.startAngle) * stitched[1]!.r,
              stitched[1]!.cy + Math.sin(stitched[1]!.startAngle) * stitched[1]!.r,
            ]
          : [0, 0];
    expect(firstEnd[0]).toBeCloseTo(secondStart[0]!, 9);
    expect(firstEnd[1]).toBeCloseTo(secondStart[1]!, 9);
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
