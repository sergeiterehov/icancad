import type { SketchConstraintRef, SketchEntity } from '@icancad/model';
import { entityControlPoints, tessellateEntity, type Point2 } from '@icancad/sketch';

export type SketchLine = Extract<SketchEntity, { type: 'line' }>;
export type SketchCurve = Extract<
  SketchEntity,
  { type: 'circle' | 'arc' | 'ellipse' | 'elliptical-arc' }
>;
export type DistanceAxis = 0 | 1;

export interface ClosestPoint {
  point: Point2;
  distance: number;
}

export function isPointRef(ref: SketchConstraintRef, entity: SketchEntity | undefined): boolean {
  return ref.pointIndex !== undefined || entity?.type === 'point';
}

export function isLineRef(ref: SketchConstraintRef, entity: SketchEntity | undefined): boolean {
  return ref.pointIndex === undefined && entity?.type === 'line';
}

export function isCurveRef(ref: SketchConstraintRef, entity: SketchEntity | undefined): boolean {
  return (
    ref.pointIndex === undefined &&
    (entity?.type === 'circle' ||
      entity?.type === 'arc' ||
      entity?.type === 'ellipse' ||
      entity?.type === 'elliptical-arc')
  );
}

/** The point a reference designates, or the first control point of a curve. */
export function refPointOf(
  ref: SketchConstraintRef,
  entity: SketchEntity | undefined,
): Point2 | null {
  if (!entity) return null;
  if (entity.type === 'point') return [entity.x, entity.y];
  return entityControlPoints(entity)[ref.pointIndex ?? 0] ?? null;
}

export function closestOnSegment(point: Point2, start: Point2, end: Point2): ClosestPoint {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2),
        );
  const closest: Point2 = [start[0] + dx * t, start[1] + dy * t];
  return { point: closest, distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]) };
}

/** The point of a curve closest to `point`, straight from its tessellation. */
export function closestPointOnEntity(entity: SketchEntity, point: Point2): ClosestPoint | null {
  if (entity.type === 'point') {
    return {
      point: [entity.x, entity.y],
      distance: Math.hypot(point[0] - entity.x, point[1] - entity.y),
    };
  }
  if (entity.type === 'line') {
    return closestOnSegment(point, [entity.x1, entity.y1], [entity.x2, entity.y2]);
  }
  const circle = circularCenter(entity);
  if (circle) {
    const dx = point[0] - circle.center[0];
    const dy = point[1] - circle.center[1];
    const radial = Math.hypot(dx, dy);
    if (radial < 1e-9) {
      return {
        point: [circle.center[0] + circle.radius, circle.center[1]],
        distance: circle.radius,
      };
    }
    const contact: Point2 = [
      circle.center[0] + (dx / radial) * circle.radius,
      circle.center[1] + (dy / radial) * circle.radius,
    ];
    return { point: contact, distance: Math.abs(radial - circle.radius) };
  }
  const curve = tessellateEntity(entity, 128);
  if (entity.type === 'circle' || entity.type === 'ellipse') {
    const first = curve[0];
    if (first) curve.push(first);
  }
  let best: ClosestPoint | null = null;
  for (let index = 0; index + 1 < curve.length; index += 1) {
    const closest = closestOnSegment(point, curve[index]!, curve[index + 1]!);
    if (!best || closest.distance < best.distance) best = closest;
  }
  return best;
}

export function pointCurveDistance(point: Point2, curve: SketchEntity): number | undefined {
  return closestPointOnEntity(curve, point)?.distance;
}

function circularCenter(entity: SketchEntity): { center: Point2; radius: number } | null {
  if (entity.type === 'circle' || entity.type === 'arc') {
    return { center: [entity.cx, entity.cy], radius: entity.r };
  }
  return null;
}

/**
 * The shortest gap between two curves. Circles and arcs share an analytic
 * answer; an ellipse falls back to the sampled curves.
 */
export function curveCurveGap(
  first: SketchEntity,
  second: SketchEntity,
): { distance: number; first: Point2; second: Point2 } | null {
  const a = circularCenter(first);
  const b = circularCenter(second);
  if (a && b) {
    const dx = b.center[0] - a.center[0];
    const dy = b.center[1] - a.center[1];
    const centers = Math.hypot(dx, dy);
    if (centers === 0) {
      return {
        distance: Math.abs(a.radius - b.radius),
        first: [a.center[0] + a.radius, a.center[1]],
        second: [b.center[0] + b.radius, b.center[1]],
      };
    }
    const ux = dx / centers;
    const uy = dy / centers;
    if (centers > a.radius + b.radius) {
      return {
        distance: centers - a.radius - b.radius,
        first: [a.center[0] + ux * a.radius, a.center[1] + uy * a.radius],
        second: [b.center[0] - ux * b.radius, b.center[1] - uy * b.radius],
      };
    }
    if (centers < Math.abs(a.radius - b.radius)) {
      const sign = a.radius >= b.radius ? 1 : -1;
      return {
        distance: Math.abs(a.radius - b.radius) - centers,
        first: [a.center[0] + ux * sign * a.radius, a.center[1] + uy * sign * a.radius],
        second: [b.center[0] + ux * sign * b.radius, b.center[1] + uy * sign * b.radius],
      };
    }
    // Intersecting circles have no gap; the crossing is the closest place.
    const crossing: Point2 = [(a.center[0] + b.center[0]) / 2, (a.center[1] + b.center[1]) / 2];
    return { distance: 0, first: crossing, second: crossing };
  }
  const sampled = tessellateEntity(first, 96);
  let best: { distance: number; first: Point2; second: Point2 } | null = null;
  for (const candidate of sampled) {
    const closest = closestPointOnEntity(second, candidate);
    if (!closest) continue;
    if (!best || closest.distance < best.distance) {
      best = { distance: closest.distance, first: candidate, second: closest.point };
    }
  }
  return best;
}

/** The point of a curve where the other coordinate equals the point's. */
export function axisCrossingOnCurve(
  entity: SketchEntity,
  point: Point2,
  axis: DistanceAxis,
): Point2 | null {
  const other: DistanceAxis = axis === 0 ? 1 : 0;
  if (entity.type === 'line') {
    const start: Point2 = [entity.x1, entity.y1];
    const delta = other === 0 ? entity.x2 - entity.x1 : entity.y2 - entity.y1;
    if (Math.abs(delta) < 1e-9) return null;
    const t = (point[other] - start[other]) / delta;
    return [start[0] + (entity.x2 - entity.x1) * t, start[1] + (entity.y2 - entity.y1) * t];
  }
  const circle = circularCenter(entity);
  if (circle) {
    const offset = point[other] - circle.center[other];
    if (Math.abs(offset) > circle.radius) return null;
    const spread = Math.sqrt(Math.max(0, circle.radius * circle.radius - offset * offset));
    const first: Point2 =
      other === 1
        ? [circle.center[0] + spread, circle.center[1] + offset]
        : [circle.center[0] + offset, circle.center[1] + spread];
    const second: Point2 =
      other === 1
        ? [circle.center[0] - spread, circle.center[1] + offset]
        : [circle.center[0] + offset, circle.center[1] - spread];
    return Math.abs(first[axis] - point[axis]) <= Math.abs(second[axis] - point[axis])
      ? first
      : second;
  }
  // An arbitrary curve: follow its sampled outline for the closest crossing.
  const curve = tessellateEntity(entity, 128);
  let best: Point2 | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of curve) {
    const error = Math.abs(candidate[other] - point[other]);
    if (
      error < bestError - 1e-9 ||
      (Math.abs(error - bestError) <= 1e-9 &&
        best !== null &&
        Math.abs(candidate[axis] - point[axis]) < Math.abs(best[axis] - point[axis]))
    ) {
      bestError = error;
      best = candidate;
    }
  }
  return best;
}

export function axisDistance(point: Point2, crossing: Point2, axis: DistanceAxis): number {
  return Math.abs(point[axis] - crossing[axis]);
}

/**
 * A line direction that does not depend on which endpoint comes first. A
 * projected line can be regenerated with its ends swapped; the side of a point
 * must survive that.
 */
export function canonicalLine(line: SketchLine): {
  start: Point2;
  direction: Point2;
  flipped: boolean;
} {
  const startFirst = line.x1 < line.x2 || (line.x1 === line.x2 && line.y1 <= line.y2);
  return startFirst
    ? {
        start: [line.x1, line.y1],
        direction: [line.x2 - line.x1, line.y2 - line.y1],
        flipped: false,
      }
    : {
        start: [line.x2, line.y2],
        direction: [line.x1 - line.x2, line.y1 - line.y2],
        flipped: true,
      };
}

/** `1` when the point is left of the canonical line direction, `-1` right. */
export function lineSide(point: Point2, line: SketchLine): number {
  const { start, direction } = canonicalLine(line);
  const cross = direction[0] * (point[1] - start[1]) - direction[1] * (point[0] - start[0]);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

/** `1` outside a circle or arc, `-1` inside, `0` on it. */
export function curveSide(point: Point2, curve: SketchEntity): number {
  const circle = circularCenter(curve);
  if (!circle) return 0;
  const radial = Math.hypot(point[0] - circle.center[0], point[1] - circle.center[1]);
  const offset = radial - circle.radius;
  if (Math.abs(offset) < 1e-9) return 0;
  return offset > 0 ? 1 : -1;
}

export function axisSide(point: Point2, crossing: Point2, axis: DistanceAxis): number {
  const offset = point[axis] - crossing[axis];
  if (Math.abs(offset) < 1e-9) return 0;
  return offset > 0 ? 1 : -1;
}
