import type { SketchEntity } from '@icancad/model';
import type { Point2 } from './index';

/**
 * Crossings between sketch curves. Profile building and the sketch tools share
 * these, so a tool that trims an entity and the topology that turns the entity
 * into a face agree on where the crossing is.
 */

export const INTERSECTION_EPSILON = 1e-9;

/** A crossing of two segments, with the parameter of the point on each. */
export interface SegmentCrossing {
  point: Point2;
  /** Position on the first segment, 0 at its start and 1 at its end. */
  t: number;
  /** Position on the second segment. */
  u: number;
}

// Crossing point of two polyline segments, with the parameters needed to split
// both entities at the same place.
export function segmentIntersection(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
): SegmentCrossing | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  const clamped = Math.min(1, Math.max(0, t));
  return {
    point: [a[0] + rx * clamped, a[1] + ry * clamped],
    t: clamped,
    u: Math.min(1, Math.max(0, u)),
  };
}

const TAU = Math.PI * 2;

export function normalizeAngle(angle: number): number {
  let value = angle % TAU;
  if (value < 0) value += TAU;
  return value;
}

/** A circle or an arc: the circle it belongs to, plus the sweep it covers. */
export interface CircleArc {
  cx: number;
  cy: number;
  r: number;
  /** Set for arcs: true when the angle lies inside the drawn sweep. */
  onArc?: (angle: number) => boolean;
}

export function circleOf(entity: SketchEntity): CircleArc | null {
  if (entity.type === 'circle') return { cx: entity.cx, cy: entity.cy, r: entity.r };
  if (entity.type !== 'arc') return null;
  const { cx, cy, r, startAngle, endAngle } = entity;
  const naturalCcw = endAngle >= startAngle;
  const from = naturalCcw ? startAngle : endAngle;
  const sweep = normalizeAngle(naturalCcw ? endAngle - startAngle : startAngle - endAngle);
  return {
    cx,
    cy,
    r,
    onArc: (angle) => normalizeAngle(angle - from) <= sweep + 1e-9,
  };
}

/** True when the angle lies on the circle's arc, or on the whole circle. */
export function onCircle(circle: CircleArc, angle: number): boolean {
  return !circle.onArc || circle.onArc(angle);
}

export function circleCircleIntersections(first: CircleArc, second: CircleArc): Point2[] {
  const dx = second.cx - first.cx;
  const dy = second.cy - first.cy;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return [];
  if (
    distance > first.r + second.r + 1e-9 ||
    distance < Math.abs(first.r - second.r) - 1e-9
  ) {
    return [];
  }
  const along =
    (distance * distance + first.r * first.r - second.r * second.r) / (2 * distance);
  const height = Math.sqrt(Math.max(0, first.r * first.r - along * along));
  const mx = first.cx + (along * dx) / distance;
  const my = first.cy + (along * dy) / distance;
  const points: Point2[] =
    height < 1e-9
      ? [[mx, my]]
      : [
          [mx - (dy / distance) * height, my + (dx / distance) * height],
          [mx + (dy / distance) * height, my - (dx / distance) * height],
        ];
  return points.filter((point) => {
    const angle = Math.atan2(point[1] - first.cy, point[0] - first.cx);
    const secondAngle = Math.atan2(point[1] - second.cy, point[0] - second.cx);
    return onCircle(first, angle) && onCircle(second, secondAngle);
  });
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Crossings of a line with a circle. The line is a segment unless `extend` is
 * set, which the tools need to find where a lengthened edge meets a curve.
 */
export function lineCircleIntersections(
  circle: CircleArc,
  line: LineSegment,
  options?: { extend?: boolean },
): Point2[] {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-18) return [];
  const projection = ((circle.cx - line.x1) * dx + (circle.cy - line.y1) * dy) / length2;
  const footX = line.x1 + projection * dx;
  const footY = line.y1 + projection * dy;
  const distance2 = (footX - circle.cx) ** 2 + (footY - circle.cy) ** 2;
  if (distance2 > circle.r * circle.r + 1e-9) return [];
  const offset = Math.sqrt(Math.max(0, circle.r * circle.r - distance2) / length2);
  const parameters = offset < 1e-9 ? [projection] : [projection - offset, projection + offset];
  const inRange = (value: number) =>
    options?.extend ? true : value >= -1e-9 && value <= 1 + 1e-9;
  return parameters
    .filter(inRange)
    .map((value): Point2 => [line.x1 + dx * value, line.y1 + dy * value])
    .filter((point) => onCircle(circle, Math.atan2(point[1] - circle.cy, point[0] - circle.cx)));
}

function asLine(entity: SketchEntity): LineSegment | null {
  return entity.type === 'line'
    ? { x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 }
    : null;
}

/**
 * Exact crossings for circles, arcs and lines. Splitting at chord intersections
 * would leave the intersection slightly off the real circle and force the
 * profile to stay polygonal; exact points keep partial runs as real arcs.
 * `null` means the pair has no exact solution, so the caller falls back to the
 * tessellated curves.
 */
export function exactCurveIntersections(
  first: SketchEntity,
  second: SketchEntity,
): Point2[] | null {
  const firstCircle = circleOf(first);
  const secondCircle = circleOf(second);
  if (firstCircle && secondCircle) return circleCircleIntersections(firstCircle, secondCircle);
  if (firstCircle) {
    const line = asLine(second);
    if (line) return lineCircleIntersections(firstCircle, line);
    return null;
  }
  if (secondCircle) {
    const line = asLine(first);
    if (line) return lineCircleIntersections(secondCircle, line);
    return null;
  }
  return null;
}
