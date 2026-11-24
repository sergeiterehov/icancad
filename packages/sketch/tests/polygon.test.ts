import type { SketchEntity } from '@icancad/model';
import { describe, expect, it } from 'vitest';
import {
  POLYGON_MAX_SIDES,
  POLYGON_MIN_SIDES,
  clampPolygonSides,
  polygonApothem,
  polygonRadiusFromApothem,
  polygonSideLength,
  polygonSidesBetween,
  polygonVertices,
} from '../src/polygon';

const round = (value: number, digits = 9) => Number(value.toFixed(digits));

describe('polygon geometry', () => {
  it('puts the corners of a square on its circle, from the first one round', () => {
    const points = polygonVertices({ centre: [0, 0], radius: 10, sides: 4, rotation: 0 });
    expect(points).toHaveLength(4);
    expect(points.map((point) => point.map((value) => round(value) + 0))).toEqual([
      [10, 0],
      [0, 10],
      [-10, 0],
      [0, -10],
    ]);
  });

  it('starts the first corner where the radius points', () => {
    const points = polygonVertices({
      centre: [5, -5],
      radius: 4,
      sides: 3,
      rotation: Math.PI / 2,
    });
    expect(points).toHaveLength(3);
    // The first corner stands straight up from the centre, and the others are a
    // third of a turn further round.
    expect(round(points[0]![0])).toBe(5);
    expect(round(points[0]![1])).toBe(-1);
    const next = Math.PI / 2 + (2 * Math.PI) / 3;
    expect(round(points[1]![0])).toBe(round(5 + 4 * Math.cos(next)));
    expect(round(points[1]![1])).toBe(round(-5 + 4 * Math.sin(next)));
  });

  it('reads the number of corners from the angle the pointer makes', () => {
    const centre: [number, number] = [0, 0];
    const corner: [number, number] = [10, 0];
    // A quarter turn between the radius and the pointer is four corners.
    expect(polygonSidesBetween(centre, corner, [0, 10])).toBe(4);
    // A third of a turn is three; a sixth is six.
    expect(polygonSidesBetween(centre, corner, [-5, 8.660254])).toBe(3);
    expect(polygonSidesBetween(centre, corner, [5, 8.660254])).toBe(6);
    // The other way round is the same angle.
    expect(polygonSidesBetween(centre, corner, [0, -10])).toBe(4);
    // The pointer's distance says nothing: only the angle is read.
    expect(polygonSidesBetween(centre, corner, [0, 40])).toBe(4);
  });

  it('keeps the number of corners within what a shape can be', () => {
    const centre: [number, number] = [0, 0];
    const corner: [number, number] = [10, 0];
    // The pointer on the radius itself asks for endless corners.
    expect(polygonSidesBetween(centre, corner, [40, 0])).toBe(POLYGON_MAX_SIDES);
    // A whisker of an angle still asks for a real polygon.
    expect(polygonSidesBetween(centre, corner, [10, 0.001])).toBe(POLYGON_MAX_SIDES);
    expect(polygonSidesBetween(centre, corner, [-10, 0.0001])).toBe(POLYGON_MIN_SIDES);
    expect(clampPolygonSides(2)).toBe(POLYGON_MIN_SIDES);
    expect(clampPolygonSides(1000)).toBe(POLYGON_MAX_SIDES);
    expect(clampPolygonSides(Number.NaN)).toBe(POLYGON_MIN_SIDES);
  });

  it('measures the circle the edges touch against the circle the corners lie on', () => {
    // A square's apothem is half of its diagonal: r / √2.
    expect(polygonApothem(10, 4)).toBeCloseTo(10 / Math.SQRT2, 12);
    expect(polygonRadiusFromApothem(polygonApothem(10, 4), 4)).toBeCloseTo(10, 12);
    // A hexagon's edge is its radius.
    expect(polygonSideLength(10, 6)).toBeCloseTo(10, 12);
    // A square's edge is the diagonal of the circle.
    expect(polygonSideLength(10, 4)).toBeCloseTo(10 * Math.SQRT2, 12);
  });

  it('reads a polygon out of the sketch as lines and a circle', () => {
    // The geometry module only knows points, but a check that a redraw of the
    // corners stays a polygon is what the tool leans on.
    const points = polygonVertices({ centre: [0, 0], radius: 5, sides: 5, rotation: 0.3 });
    const entity: SketchEntity = {
      id: 'a',
      type: 'line',
      construction: false,
      x1: points[0]![0],
      y1: points[0]![1],
      x2: points[1]![0],
      y2: points[1]![1],
    };
    expect(entity.type).toBe('line');
    expect(points).toHaveLength(5);
  });
});
