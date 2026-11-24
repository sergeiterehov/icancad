import type { Point2 } from './index';

/**
 * Правильный многоугольник: the shape a sketch draws out of segments.
 *
 * A polygon is not an entity of its own — the sketch holds straight lines and a
 * construction circle — so everything here is the arithmetic between the figure
 * and the circle it stands on: where its corners are, how many of them the
 * pointer asks for, and what radius the circle has when it is the one the edges
 * touch instead of the one the corners lie on.
 */

/** Fewer than three corners is not a polygon; more than this is not a shape. */
export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 64;

/** A regular polygon, as its circle and the angle of its first corner. */
export interface RegularPolygon {
  centre: Point2;
  /** Distance from the centre to a corner — the circle the corners lie on. */
  radius: number;
  sides: number;
  /** Direction of the first corner, in radians from the sketch's X axis. */
  rotation: number;
}

const TAU = Math.PI * 2;

/** How many corners a polygon has when it goes round this circle. */
export function clampPolygonSides(sides: number): number {
  if (!Number.isFinite(sides)) return POLYGON_MIN_SIDES;
  return Math.min(POLYGON_MAX_SIDES, Math.max(POLYGON_MIN_SIDES, Math.round(sides)));
}

/**
 * The number of corners the pointer asks for: the angle it makes with the
 * radius is the angle one edge takes up, so the whole turn divided by that
 * angle is how many edges there are. The distance to the pointer says nothing —
 * the radius is already set by the click before it.
 */
export function polygonSidesBetween(centre: Point2, corner: Point2, cursor: Point2): number {
  const start = Math.atan2(corner[1] - centre[1], corner[0] - centre[0]);
  const aim = Math.atan2(cursor[1] - centre[1], cursor[0] - centre[0]);
  let step = Math.abs(aim - start) % TAU;
  if (step > TAU / 2) step = TAU - step;
  if (step < 1e-6) return POLYGON_MAX_SIDES;
  return clampPolygonSides(TAU / step);
}

/** The corners of the polygon, in order, starting at its first one. */
export function polygonVertices(polygon: RegularPolygon): Point2[] {
  const sides = clampPolygonSides(polygon.sides);
  const points: Point2[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = polygon.rotation + (index * TAU) / sides;
    points.push([
      polygon.centre[0] + Math.cos(angle) * polygon.radius,
      polygon.centre[1] + Math.sin(angle) * polygon.radius,
    ]);
  }
  return points;
}

/** Distance from the centre to the middle of an edge. */
export function polygonApothem(radius: number, sides: number): number {
  return radius * Math.cos(Math.PI / clampPolygonSides(sides));
}

/**
 * The radius of the corners of a polygon whose edges touch a circle of this
 * radius — the other way round of {@link polygonApothem}.
 */
export function polygonRadiusFromApothem(apothem: number, sides: number): number {
  const cosine = Math.cos(Math.PI / clampPolygonSides(sides));
  return cosine <= 1e-9 ? apothem : apothem / cosine;
}

/** Length of one edge of a polygon whose corners lie on this circle. */
export function polygonSideLength(radius: number, sides: number): number {
  return 2 * radius * Math.sin(Math.PI / clampPolygonSides(sides));
}
