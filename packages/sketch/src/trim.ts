import type { SketchEntity } from '@icancad/model';
import { ellipseArcPoint, normalizeAngle, tessellateEntity, type Point2 } from './index';
import { exactCurveIntersections, segmentIntersection } from './intersect';

/**
 * Вырез: cutting a piece out of a curve between its crossings.
 *
 * The scissors are a cut, not a new shape: the curve keeps the pieces that are
 * left, and the piece under them is gone. That needs three things of a curve —
 * a parameter along it, the parameters where other geometry crosses it, and the
 * exact piece between two of those parameters — and nothing else. Everything
 * here is exact for lines, arcs, circles and ellipses of the sketch; a curve
 * that has no parameter of its own is refused rather than approximated.
 */

export type TrimFailure = 'selection' | 'unsupported' | 'piece';

/** Two crossings closer than this along a curve are one crossing. */
const PARAMETER_EPSILON = 1e-6;

const TAU = Math.PI * 2;

/** The pieces a curve is cut into, as parameters from its start to its end. */
export interface CurveIntervals {
  /** Where the curve starts and ends, `null` for a closed curve. */
  from: number;
  to: number;
  /** One interval per piece, closed curves included. */
  intervals: Array<[number, number]>;
  closed: boolean;
}

/** How far along a sweep an angle stands, in radians, following its direction. */
function along(angle: number, start: number, sweep: number): number {
  const delta = angle - start;
  return sweep >= 0 ? normalizeAngle(delta) : -normalizeAngle(-delta);
}

/** The ellipse parameter of a point, in radians. */
function ellipseParameter(
  entity: Extract<SketchEntity, { type: 'ellipse' | 'elliptical-arc' }>,
  point: Point2,
): number | null {
  const rotation = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point[0] - entity.cx;
  const dy = point[1] - entity.cy;
  const x = (dx * cos + dy * sin) / (entity.rx || 1);
  const y = (-dx * sin + dy * cos) / (entity.ry || 1);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
  return Math.atan2(y, x);
}

/**
 * Where a point stands along a curve, from 0 at its start to 1 at its end. A
 * closed curve runs once round from its angle zero. A curve without a parameter
 * of its own — a Bezier — has none, and says so.
 */
export function curveParameterAt(entity: SketchEntity, point: Point2): number | null {
  switch (entity.type) {
    case 'line': {
      const dx = entity.x2 - entity.x1;
      const dy = entity.y2 - entity.y1;
      const length = dx * dx + dy * dy;
      if (length < 1e-18) return null;
      return ((point[0] - entity.x1) * dx + (point[1] - entity.y1) * dy) / length;
    }
    case 'circle': {
      const angle = Math.atan2(point[1] - entity.cy, point[0] - entity.cx);
      return normalizeAngle(angle) / TAU;
    }
    case 'arc': {
      const sweep = entity.endAngle - entity.startAngle;
      if (Math.abs(sweep) < 1e-12) return null;
      const angle = Math.atan2(point[1] - entity.cy, point[0] - entity.cx);
      return along(angle, entity.startAngle, sweep) / sweep;
    }
    case 'ellipse': {
      const parameter = ellipseParameter(entity, point);
      if (parameter === null) return null;
      return normalizeAngle(parameter) / TAU;
    }
    case 'elliptical-arc': {
      const sweep = entity.endAngle - entity.startAngle;
      if (Math.abs(sweep) < 1e-12) return null;
      const parameter = ellipseParameter(entity, point);
      if (parameter === null) return null;
      // The point is on the arc, so its angle is the parameter plus a whole
      // number of turns: the one nearest the middle of the sweep is the one
      // being asked about.
      let best = parameter;
      let bestDistance = Infinity;
      for (const candidate of [parameter, parameter + TAU, parameter - TAU]) {
        const at = along(candidate, entity.startAngle, sweep) / sweep;
        const distance = Math.abs(at - 0.5);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      return along(best, entity.startAngle, sweep) / sweep;
    }
    default:
      return null;
  }
}

/** The point a parameter names, or `null` for a curve that has no parameter. */
export function curvePointAt(entity: SketchEntity, parameter: number): Point2 | null {
  switch (entity.type) {
    case 'line':
      return [
        entity.x1 + (entity.x2 - entity.x1) * parameter,
        entity.y1 + (entity.y2 - entity.y1) * parameter,
      ];
    case 'circle': {
      const angle = parameter * TAU;
      return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
    }
    case 'arc': {
      const angle = entity.startAngle + (entity.endAngle - entity.startAngle) * parameter;
      return [entity.cx + Math.cos(angle) * entity.r, entity.cy + Math.sin(angle) * entity.r];
    }
    case 'ellipse': {
      const angle = parameter * TAU;
      const rotation = (entity.rotation * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const x = Math.cos(angle) * entity.rx;
      const y = Math.sin(angle) * entity.ry;
      return [entity.cx + x * cos - y * sin, entity.cy + x * sin + y * cos];
    }
    case 'elliptical-arc':
      return ellipseArcPoint(entity, entity.startAngle + (entity.endAngle - entity.startAngle) * parameter);
    default:
      return null;
  }
}

/**
 * The piece of a curve between two parameters. The piece is the same kind of
 * curve — a line stays a line, an arc stays an arc of the same centre, a circle
 * piece is an arc, an ellipse piece is an elliptical arc — and it keeps the id
 * and the construction flag it is handed.
 */
export function trimPiece(
  entity: SketchEntity,
  from: number,
  to: number,
): SketchEntity | null {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (end - start < PARAMETER_EPSILON) return null;
  switch (entity.type) {
    case 'line': {
      const a = curvePointAt(entity, start);
      const b = curvePointAt(entity, end);
      if (!a || !b) return null;
      return { ...entity, x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
    }
    case 'circle': {
      const startAngle = start * TAU;
      return {
        id: entity.id,
        type: 'arc',
        construction: entity.construction,
        cx: entity.cx,
        cy: entity.cy,
        r: entity.r,
        startAngle,
        endAngle: startAngle + (end - start) * TAU,
      };
    }
    case 'arc': {
      const sweep = entity.endAngle - entity.startAngle;
      return {
        ...entity,
        startAngle: entity.startAngle + sweep * start,
        endAngle: entity.startAngle + sweep * end,
      };
    }
    case 'ellipse':
      return {
        id: entity.id,
        type: 'elliptical-arc',
        construction: entity.construction,
        cx: entity.cx,
        cy: entity.cy,
        rx: entity.rx,
        ry: entity.ry,
        rotation: entity.rotation,
        startAngle: start * TAU,
        endAngle: end * TAU,
      };
    case 'elliptical-arc': {
      const sweep = entity.endAngle - entity.startAngle;
      return {
        ...entity,
        startAngle: entity.startAngle + sweep * start,
        endAngle: entity.startAngle + sweep * end,
      };
    }
    default:
      return null;
  }
}

/**
 * The control-point indices of a curve's two ends.
 *
 * Position is not enough to name an end: an ellipse's own axis handles stand
 * exactly where its start and its end are, so a search by coordinates finds a
 * handle first. A joint that names a handle is not a joint between the pieces.
 */
export function curveEndIndices(entity: SketchEntity): { start: number; end: number } | null {
  switch (entity.type) {
    case 'line':
      return { start: 0, end: 1 };
    case 'arc':
      return { start: 1, end: 2 };
    case 'elliptical-arc':
      return { start: 3, end: 4 };
    case 'bezier':
      return entity.points.length >= 2
        ? { start: 0, end: entity.points.length - 1 }
        : null;
    default:
      return null;
  }
}

/** True when the curve has no ends: its pieces wrap round its own start. */
export function isClosedCurve(entity: SketchEntity): boolean {
  return entity.type === 'circle' || entity.type === 'ellipse';
}

/**
 * The crossings of one curve with one straight segment.
 *
 * A line and a circle answer exactly; an ellipse or an elliptical arc has no
 * closed form with a line, so its own lofted segments are used — the crossing
 * still lands on the ellipse, because its parameter is read back from the
 * point, and only the foot of the seam is approximate.
 */
function segmentCrossings(
  entity: SketchEntity,
  a: Point2,
  b: Point2,
): Point2[] {
  if (entity.type === 'line') {
    const crossing = segmentIntersection([entity.x1, entity.y1], [entity.x2, entity.y2], a, b);
    return crossing ? [crossing.point] : [];
  }
  const segment: SketchEntity = {
    id: `${entity.id}#segment`,
    type: 'line',
    construction: entity.construction,
    x1: a[0],
    y1: a[1],
    x2: b[0],
    y2: b[1],
  };
  const exact = exactCurveIntersections(entity, segment);
  if (exact) return exact;
  const samples = tessellateEntity(entity, 256);
  const points: Point2[] = [];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const crossing = segmentIntersection(samples[index]!, samples[index + 1]!, a, b);
    if (crossing) points.push(crossing.point);
  }
  return points;
}

/** A crossing of one curve with another, and the curve it came from. */
export interface CurveCrossing {
  /** Where it stands along the crossed curve, 0 at its start and 1 at its end. */
  parameter: number;
  /** The curve that runs through it. */
  otherId: string;
}

/**
 * The crossings of one curve with others, with the curve each one came from. A
 * pair with an exact solution is answered exactly; the rest is walked as short
 * segments, so an ellipse or a Bezier cuts a line as reliably as a circle does —
 * and the crossing still knows which curve it belongs to, which is what a joint
 * at that point needs.
 */
export function curveCrossingSources(
  entity: SketchEntity,
  others: readonly SketchEntity[],
): CurveCrossing[] {
  const crossings: CurveCrossing[] = [];
  const add = (point: Point2, otherId: string) => {
    const parameter = curveParameterAt(entity, point);
    if (parameter === null || !Number.isFinite(parameter)) return;
    if (parameter < -PARAMETER_EPSILON || parameter > 1 + PARAMETER_EPSILON) return;
    crossings.push({ parameter: Math.min(1, Math.max(0, parameter)), otherId });
  };
  for (const other of others) {
    if (other.id === entity.id) continue;
    const exact = exactCurveIntersections(entity, other);
    if (exact) {
      for (const point of exact) add(point, other.id);
      continue;
    }
    const samples = tessellateEntity(other, 96);
    for (let index = 0; index < samples.length - 1; index += 1) {
      for (const point of segmentCrossings(entity, samples[index]!, samples[index + 1]!)) {
        add(point, other.id);
      }
    }
  }
  crossings.sort((a, b) => a.parameter - b.parameter);
  return crossings;
}

/**
 * The crossings of one curve with others, as parameters along it, sorted and
 * deduplicated: two curves through the same point are one cut.
 */
export function curveCrossings(
  entity: SketchEntity,
  others: readonly SketchEntity[],
): number[] {
  const unique: number[] = [];
  for (const { parameter } of curveCrossingSources(entity, others)) {
    const previous = unique[unique.length - 1];
    if (previous !== undefined && parameter - previous <= PARAMETER_EPSILON) continue;
    unique.push(parameter);
  }
  return unique;
}

/**
 * The pieces a curve is cut into by the crossings along it. An open curve runs
 * from its own start to its own end; a closed one runs from its first crossing
 * all the way round back to it.
 */
export function curveIntervals(
  entity: SketchEntity,
  crossings: readonly number[],
): CurveIntervals | { error: TrimFailure } {
  const closed = isClosedCurve(entity);
  // A crossing that lands on an end of an open curve is the joint it already
  // has there, not a cut: it would make a piece of no length.
  const breaks = closed
    ? [...crossings]
    : crossings.filter(
        (parameter) => parameter > PARAMETER_EPSILON && parameter < 1 - PARAMETER_EPSILON,
      );
  if (closed) {
    // A loop that nothing crosses — or that only one curve crosses, which leaves
    // it one piece — is the piece: cutting it removes it whole.
    if (breaks.length < 2) return { from: 0, to: 1, intervals: [[0, 1]], closed };
    const intervals: Array<[number, number]> = [];
    for (const [index, from] of breaks.entries()) {
      const to = breaks[(index + 1) % breaks.length]!;
      intervals.push([from, index === breaks.length - 1 ? to + 1 : to]);
    }
    return { from: breaks[0]!, to: breaks[0]! + 1, intervals, closed };
  }
  // A curve nothing crosses is one piece: itself. The tool turns that into a
  // whole removal rather than refusing to act at all.
  if (breaks.length === 0) return { from: 0, to: 1, intervals: [[0, 1]], closed };
  const edges = [0, ...breaks, 1];
  const intervals: Array<[number, number]> = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const from = edges[index]!;
    const to = edges[index + 1]!;
    if (to - from < PARAMETER_EPSILON) continue;
    intervals.push([from, to]);
  }
  return { from: 0, to: 1, intervals, closed };
}

/** True when an interval is the curve itself rather than a piece of it. */
export function isWholeCurve(interval: [number, number]): boolean {
  return interval[1] - interval[0] >= 1 - PARAMETER_EPSILON;
}

/** The nearest point of an interval to a pointer, and how far it stands. */
export function intervalDistance(
  entity: SketchEntity,
  interval: [number, number],
  pointer: Point2,
): number {
  const steps = 24;
  let best = Infinity;
  for (let index = 0; index <= steps; index += 1) {
    const point = curvePointAt(entity, interval[0] + ((interval[1] - interval[0]) * index) / steps);
    if (!point) continue;
    best = Math.min(best, Math.hypot(point[0] - pointer[0], point[1] - pointer[1]));
  }
  return best;
}
