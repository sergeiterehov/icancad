import type { SketchEntity, SketchFrame, Vec3 } from '@icancad/model';
import type { Point2 } from './index';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** A sketch entity without its id, ready to be given one by the caller. */
export type SketchEntityDraft = WithoutId<SketchEntity>;

/** Points closer than this fraction of the curve size are the same point. */
const POINT_TOLERANCE = 1e-7;

/** How far a fit may wander from the points it is fitted to. */
export interface CurveFitOptions {
  /**
   * Absolute distance the curve may miss the points by. A polyline sampled from
   * a real curve misses it by the chord sagitta, so a fit tighter than that can
   * never succeed.
   */
  tolerance?: number;
}

/**
 * The chord sagitta of a polyline: how far its samples sit from the curve they
 * approximate. It is the natural floor for a fit tolerance.
 */
export function polylineSagitta(points: readonly Point2[]): number {
  let worst = 0;
  for (let index = 1; index + 1 < points.length; index += 1) {
    const before = points[index - 1]!;
    const point = points[index]!;
    const after = points[index + 1]!;
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    worst = Math.max(worst, Math.abs((point[0] - before[0]) * dy - (point[1] - before[1]) * dx) / length);
  }
  return worst;
}

function fitLimit(scale: number, options: CurveFitOptions | undefined): number {
  return Math.max(scale * 1e-4, 1e-6, options?.tolerance ?? 0);
}

function distance(first: Point2, second: Point2): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function extent(points: readonly Point2[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY, 1e-6);
}

/** Orthographic projection of a world point onto the sketch plane. */
export function projectPointToFrame(frame: SketchFrame, point: Vec3): Point2 {
  const dx = point[0] - frame.origin[0];
  const dy = point[1] - frame.origin[1];
  const dz = point[2] - frame.origin[2];
  return [
    dx * frame.xAxis[0] + dy * frame.xAxis[1] + dz * frame.xAxis[2],
    dx * frame.yAxis[0] + dy * frame.yAxis[1] + dz * frame.yAxis[2],
  ];
}

export function projectPolylineToFrame(frame: SketchFrame, points: readonly Vec3[]): Point2[] {
  return points.map((point) => projectPointToFrame(frame, point));
}

function simplify(points: readonly Point2[]): Point2[] {
  const scale = extent(points);
  const tolerance = Math.max(scale * POINT_TOLERANCE, 1e-9);
  const result: Point2[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (previous && distance(previous, point) <= tolerance) continue;
    result.push(point);
  }
  return result;
}

/**
 * The straight segment that covers every point, or null when the point set is
 * not flat. A circle seen edge-on projects to a segment that runs out and back,
 * so the span comes from the two farthest points rather than from the ends of
 * the polyline.
 */
function flatSegment(
  points: readonly Point2[],
  options?: CurveFitOptions,
): SketchEntityDraft | null {
  const first = points[0];
  if (!first) return null;
  // The same tolerance decides straight and curved: a polyline sampled from a
  // straight edge wobbles, and fitting that wobble as an arc turns a line into
  // a pair of arcs.
  const tolerance = Math.max(
    extent(points) * 1e-6,
    1e-9,
    options?.tolerance ?? 0,
  );
  const farthest = (from: Point2): Point2 => {
    let found = from;
    let best = 0;
    for (const point of points) {
      const span = distance(from, point);
      if (span > best) {
        best = span;
        found = point;
      }
    }
    return found;
  };
  // Two sweeps land on the ends of the span, whatever point the polyline
  // starts at; the one the polyline starts next to comes first, so the segment
  // keeps the direction of the source curve.
  const far = farthest(first);
  const back = farthest(far);
  const start = distance(first, far) > distance(first, back) ? back : far;
  const end = start === far ? back : far;
  const length = distance(start, end);
  if (length <= tolerance) return null;
  const dx = (end[0] - start[0]) / length;
  const dy = (end[1] - start[1]) / length;
  for (const point of points) {
    const offset = Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx);
    if (offset > tolerance) return null;
  }
  return {
    type: 'line',
    construction: false,
    x1: start[0],
    y1: start[1],
    x2: end[0],
    y2: end[1],
  };
}

function solve2x2(
  a11: number,
  a12: number,
  a21: number,
  a22: number,
  b1: number,
  b2: number,
): [number, number] | null {
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return null;
  return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a21 * b1) / det];
}

function solve3x3(matrix: number[][], rhs: number[]): [number, number, number] | null {
  const m = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(m[row]![column]!) > Math.abs(m[pivot]![column]!)) pivot = row;
    }
    const value = m[pivot]![column]!;
    if (Math.abs(value) < 1e-14) return null;
    [m[column], m[pivot]] = [m[pivot]!, m[column]!];
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = m[row]![column]! / m[column]![column]!;
      for (let k = column; k < 4; k += 1) m[row]![k] = m[row]![k]! - factor * m[column]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

function fitCircle(points: readonly Point2[]): { cx: number; cy: number; r: number } | null {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sx3 = 0;
  let sy3 = 0;
  let sxy2 = 0;
  let sx2y = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sx3 += x * x * x;
    sy3 += y * y * y;
    sxy2 += x * y * y;
    sx2y += x * x * y;
  }
  const n = points.length;
  const solved = solve3x3(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [sx3 + sxy2, sx2y + sy3, sxx + syy],
  );
  if (!solved) return null;
  const [a, b, c] = solved;
  const cx = a / 2;
  const cy = b / 2;
  const radiusSquared = c + cx * cx + cy * cy;
  if (!(radiusSquared > 0)) return null;
  return { cx, cy, r: Math.sqrt(radiusSquared) };
}

function ellipseFromClosedLoop(
  points: readonly Point2[],
  options?: CurveFitOptions,
): SketchEntityDraft | null {
  if (points.length < 6) return null;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - cx) * (x - cx);
    syy += (y - cy) * (y - cy);
    sxy += (x - cx) * (y - cy);
  }
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(axis);
  const sin = Math.sin(axis);
  // Least squares for the implicit form (u/rx)^2 + (v/ry)^2 = 1, which is
  // linear in 1/rx^2 and 1/ry^2 and therefore exact for a sampled ellipse.
  let su = 0;
  let sv = 0;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  for (const [x, y] of points) {
    const u = (x - cx) * cos + (y - cy) * sin;
    const v = -(x - cx) * sin + (y - cy) * cos;
    su += u * u;
    sv += v * v;
    suu += u * u * u * u;
    svv += v * v * v * v;
    suv += u * u * v * v;
  }
  const solved = solve2x2(suu, suv, suv, svv, su, sv);
  if (!solved) return null;
  const [inverseMajor, inverseMinor] = solved;
  if (!(inverseMajor > 0) || !(inverseMinor > 0)) return null;
  let rx = 1 / Math.sqrt(inverseMajor);
  let ry = 1 / Math.sqrt(inverseMinor);
  let rotation = (axis * 180) / Math.PI;
  if (ry > rx) {
    [rx, ry] = [ry, rx];
    rotation += 90;
  }
  const scale = Math.max(rx, ry);
  if (!Number.isFinite(scale) || scale <= 1e-6) return null;
  let error = 0;
  for (const [x, y] of points) {
    const u = ((x - cx) * cos + (y - cy) * sin) / rx;
    const v = (-(x - cx) * sin + (y - cy) * cos) / ry;
    error = Math.max(error, Math.abs(Math.hypot(u, v) - 1));
  }
  if (error > Math.max(1e-3, (options?.tolerance ?? 0) / scale)) return null;
  if (Math.abs(rx - ry) <= scale * 1e-3) {
    const radius = (rx + ry) / 2;
    return { type: 'circle', construction: false, cx, cy, r: radius };
  }
  return {
    type: 'ellipse',
    construction: false,
    cx,
    cy,
    rx,
    ry,
    rotation: ((rotation % 180) + 180) % 180,
  };
}

function arcFromOpenCurve(
  points: readonly Point2[],
  options?: CurveFitOptions,
): SketchEntityDraft | null {
  // Three points define a circle, which is the smallest arc worth reporting.
  if (points.length < 3) return null;
  const circle = fitCircle(points);
  if (!circle) return null;
  const scale = extent(points);
  if (circle.r > scale * 1e4) return null;
  let error = 0;
  for (const [x, y] of points) {
    error = Math.max(error, Math.abs(Math.hypot(x - circle.cx, y - circle.cy) - circle.r));
  }
  if (error > fitLimit(scale, options)) return null;
  const angles = points.map(([x, y]) => Math.atan2(y - circle.cy, x - circle.cx));
  let sweep = 0;
  for (let index = 1; index < angles.length; index += 1) {
    let delta = angles[index]! - angles[index - 1]!;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    sweep += delta;
  }
  const limit = Math.PI * 2;
  if (Math.abs(sweep) < 1e-4) return null;
  sweep = Math.max(-limit, Math.min(limit, sweep));
  // An arc that barely leaves its own chord is a straight edge with noise on
  // it, not a curve with a radius of half a metre.
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chord = distance(first, last);
  const half = chord / 2;
  const bulge =
    Math.abs(sweep) >= Math.PI
      ? circle.r
      : circle.r - Math.sqrt(Math.max(circle.r * circle.r - half * half, 0));
  if (bulge <= Math.max(fitLimit(scale, options), chord * 0.02)) {
    return {
      type: 'line',
      construction: false,
      x1: first[0],
      y1: first[1],
      x2: last[0],
      y2: last[1],
    };
  }
  const startAngle = angles[0]!;
  return {
    type: 'arc',
    construction: false,
    cx: circle.cx,
    cy: circle.cy,
    r: circle.r,
    startAngle,
    endAngle: startAngle + sweep,
  };
}

function bezierFromPoints(points: readonly Point2[], closed: boolean): SketchEntityDraft {
  const source = closed ? [...points, points[0]!] : [...points];
  const first = source[0]!;
  const last = source[source.length - 1]!;
  // Chord-length parameterization, then least squares for the two free poles
  // while the endpoints stay on the curve. A closed curve reuses the first
  // point as its last pole, which keeps the result closed.
  const lengths = [0];
  for (let index = 1; index < source.length; index += 1) {
    lengths.push(lengths[index - 1]! + distance(source[index - 1]!, source[index]!));
  }
  const total = lengths[lengths.length - 1]! || 1;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let bx = 0;
  let by = 0;
  let ax = 0;
  let ay = 0;
  for (let index = 1; index < source.length - 1; index += 1) {
    const t = lengths[index]! / total;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    const [x, y] = source[index]!;
    const rx = x - b0 * first[0] - b3 * last[0];
    const ry = y - b0 * first[1] - b3 * last[1];
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    bx += b1 * rx;
    by += b2 * rx;
    ax += b1 * ry;
    ay += b2 * ry;
  }
  const polesX = solve2x2(a11, a12, a12, a22, bx, by);
  const polesY = solve2x2(a11, a12, a12, a22, ax, ay);
  // A nearly degenerate curve makes the least-squares poles shoot far outside
  // the points, which draws a loop nobody asked for, so wild poles fall back to
  // the chord rule.
  const reach = extent(source) * 3;
  const inside = (pole: Point2): boolean =>
    pole[0] >= Math.min(first[0], last[0]) - reach &&
    pole[0] <= Math.max(first[0], last[0]) + reach &&
    pole[1] >= Math.min(first[1], last[1]) - reach &&
    pole[1] <= Math.max(first[1], last[1]) + reach;
  const solvedPoles =
    polesX && polesY ? ([[polesX[0], polesY[0]], [polesX[1], polesY[1]]] as Point2[]) : null;
  const usable = solvedPoles && inside(solvedPoles[0]!) && inside(solvedPoles[1]!);
  const firstPole: Point2 = usable
    ? solvedPoles[0]!
    : [first[0] + (last[0] - first[0]) / 3, first[1] + (last[1] - first[1]) / 3];
  const secondPole: Point2 = usable
    ? solvedPoles[1]!
    : [last[0] + (first[0] - last[0]) / 3, last[1] + (first[1] - last[1]) / 3];
  return {
    type: 'bezier',
    construction: false,
    points: [first, firstPole, secondPole, closed ? first : last],
  };
}

/**
 * The sketch curve that best represents a projected polyline: a line, an arc,
 * a circle, an ellipse, or a cubic Bezier for everything else.
 */
export function sketchCurveFromPolyline(
  points: readonly Point2[],
  closed: boolean,
  options?: CurveFitOptions,
): SketchEntityDraft | null {
  const simplified = simplify(points);
  if (simplified.length < 2) return null;
  // A flat projection is a line whether the source curve was open or closed:
  // a circle seen edge-on covers a segment twice.
  const flat = flatSegment(simplified, options);
  if (flat) return flat;
  if (!closed) {
    const arc = arcFromOpenCurve(simplified, options);
    if (arc) return arc;
  } else {
    const ellipse = ellipseFromClosedLoop(simplified, options);
    if (ellipse) return ellipse;
    const circle = fitCircle(simplified);
    if (circle) {
      const scale = extent(simplified);
      let error = 0;
      for (const [x, y] of simplified) {
        error = Math.max(error, Math.abs(Math.hypot(x - circle.cx, y - circle.cy) - circle.r));
      }
      if (circle.r < scale * 1e4 && error <= fitLimit(scale, options)) {
        return { type: 'circle', construction: false, cx: circle.cx, cy: circle.cy, r: circle.r };
      }
    }
  }
  return bezierFromPoints(simplified, closed);
}

/** The projected sketch entity of a vertex. */
export function sketchPointFromProjected(point: Point2): SketchEntityDraft {
  return { type: 'point', construction: false, x: point[0], y: point[1] };
}

/**
 * The sketch curves that follow a projected polyline. A long contour is rarely
 * one primitive: the profile of a turned part is a chain of lines and arcs, so
 * a polyline that no single fit describes is split at its worst point until
 * every piece is a line, an arc, a circle, an ellipse or a short Bezier.
 */
export function sketchCurvesFromPolyline(
  points: readonly Point2[],
  closed: boolean,
  options?: CurveFitOptions,
): SketchEntityDraft[] {
  const simplified = simplify(points);
  if (simplified.length < 2) return [];
  const curves: SketchEntityDraft[] = [];
  const split = (part: Point2[], isClosed: boolean, depth: number): void => {
    const draft = sketchCurveFromPolyline(part, isClosed, options);
    if (!draft) return;
    if (draft.type !== 'bezier' || part.length < 5 || depth >= 8) {
      curves.push(draft);
      return;
    }
    // Split where the polyline is furthest from the one circle that would
    // cover it: that is the joint between two primitives, not the middle.
    const first = part[0]!;
    const last = part[part.length - 1]!;
    const length = distance(first, last);
    const circle = fitCircle(part);
    let index = Math.floor(part.length / 2);
    let worst = -1;
    for (let candidate = 1; candidate < part.length - 1; candidate += 1) {
      const point = part[candidate]!;
      const offset = circle
        ? Math.abs(Math.hypot(point[0] - circle.cx, point[1] - circle.cy) - circle.r)
        : length > 1e-9
          ? Math.abs(
              ((point[0] - first[0]) * (last[1] - first[1]) -
                (point[1] - first[1]) * (last[0] - first[0])) /
                length,
            )
          : 0;
      if (offset > worst) {
        worst = offset;
        index = candidate;
      }
    }
    if (index <= 0 || index >= part.length - 1) return;
    split(part.slice(0, index + 1), false, depth + 1);
    split(part.slice(index), false, depth + 1);
  };
  split(simplified, closed, 0);
  return curves;
}

function arcPoint(arc: Extract<SketchEntityDraft, { type: 'arc' }>, angle: number): Point2 {
  return [arc.cx + Math.cos(angle) * arc.r, arc.cy + Math.sin(angle) * arc.r];
}

/** The circle through three points, or null when they are in a line. */
function circleThrough(
  first: Point2,
  middle: Point2,
  last: Point2,
): { cx: number; cy: number; r: number } | null {
  const ax = first[0];
  const ay = first[1];
  const bx = middle[0];
  const by = middle[1];
  const cx = last[0];
  const cy = last[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const aSquared = ax * ax + ay * ay;
  const bSquared = bx * bx + by * by;
  const cSquared = cx * cx + cy * cy;
  const centerX = (aSquared * (by - cy) + bSquared * (cy - ay) + cSquared * (ay - by)) / d;
  const centerY = (aSquared * (cx - bx) + bSquared * (ax - cx) + cSquared * (bx - ax)) / d;
  return { cx: centerX, cy: centerY, r: Math.hypot(ax - centerX, ay - centerY) };
}

function openEnds(curve: SketchEntityDraft): [Point2, Point2] | null {
  switch (curve.type) {
    case 'line':
      return [
        [curve.x1, curve.y1],
        [curve.x2, curve.y2],
      ];
    case 'arc':
      return [arcPoint(curve, curve.startAngle), arcPoint(curve, curve.endAngle)];
    case 'bezier': {
      const first = curve.points[0];
      const last = curve.points[curve.points.length - 1];
      return first && last ? [first, last] : null;
    }
    default:
      return null;
  }
}

function withEnds(
  curve: SketchEntityDraft,
  start: Point2,
  end: Point2,
): SketchEntityDraft {
  switch (curve.type) {
    case 'line':
      return { ...curve, x1: start[0], y1: start[1], x2: end[0], y2: end[1] };
    case 'arc': {
      // Keep the sweep: the arc is refitted through its own middle, so only the
      // ends move and the curve keeps its shape.
      const middle = arcPoint(curve, (curve.startAngle + curve.endAngle) / 2);
      const circle = circleThrough(start, middle, end);
      if (!circle) {
        return { type: 'line', construction: curve.construction, x1: start[0], y1: start[1], x2: end[0], y2: end[1] };
      }
      const startAngle = Math.atan2(start[1] - circle.cy, start[0] - circle.cx);
      const endAngle = Math.atan2(end[1] - circle.cy, end[0] - circle.cx);
      const middleAngle = Math.atan2(middle[1] - circle.cy, middle[0] - circle.cx);
      const forward = Math.sign(curve.endAngle - curve.startAngle) || 1;
      const sweepOf = (from: number, to: number, direction: number): number => {
        let sweep = to - from;
        if (direction > 0) while (sweep <= 0) sweep += Math.PI * 2;
        else while (sweep >= 0) sweep -= Math.PI * 2;
        return sweep;
      };
      const covers = (from: number, sweep: number, angle: number): boolean => {
        let offset = angle - from;
        if (sweep > 0) while (offset < 0) offset += Math.PI * 2;
        else while (offset > 0) offset -= Math.PI * 2;
        return sweep > 0 ? offset <= sweep : offset >= sweep;
      };
      let sweep = sweepOf(startAngle, endAngle, forward);
      if (!covers(startAngle, sweep, middleAngle)) {
        sweep = sweepOf(startAngle, endAngle, -forward);
      }
      return {
        ...curve,
        cx: circle.cx,
        cy: circle.cy,
        r: circle.r,
        startAngle,
        endAngle: startAngle + sweep,
      };
    }
    case 'bezier': {
      const points = [...curve.points];
      points[0] = start;
      points[points.length - 1] = end;
      return { ...curve, points };
    }
    default:
      return curve;
  }
}

/**
 * Joins the ends of curves that are meant to meet. A projected contour is built
 * from separate pieces — the outline of a face, the boundary edges it runs into
 * — and each piece is fitted independently, so their ends miss each other by a
 * fraction of a millimetre and the sketch never sees a closed region.
 */
export function stitchCurves(
  curves: readonly SketchEntityDraft[],
  tolerance: number,
): SketchEntityDraft[] {
  if (!(tolerance > 0) || curves.length < 2) return [...curves];
  interface End {
    curve: number;
    side: 'start' | 'end';
    at: Point2;
  }
  const ends: End[] = [];
  curves.forEach((curve, index) => {
    const pair = openEnds(curve);
    if (!pair) return;
    ends.push({ curve: index, side: 'start', at: pair[0] });
    ends.push({ curve: index, side: 'end', at: pair[1] });
  });

  const clusterOf: number[] = ends.map((_end, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (clusterOf[current] !== current) current = clusterOf[current]!;
    return current;
  };
  for (let first = 0; first < ends.length; first += 1) {
    for (let second = first + 1; second < ends.length; second += 1) {
      if (ends[first]!.curve === ends[second]!.curve) continue;
      if (distance(ends[first]!.at, ends[second]!.at) > tolerance) continue;
      const rootFirst = find(first);
      const rootSecond = find(second);
      if (rootFirst !== rootSecond) clusterOf[rootSecond] = rootFirst;
    }
  }

  const targets = new Map<number, Point2>();
  const sums = new Map<number, { x: number; y: number; count: number }>();
  ends.forEach((end, index) => {
    const root = find(index);
    const sum = sums.get(root) ?? { x: 0, y: 0, count: 0 };
    sum.x += end.at[0];
    sum.y += end.at[1];
    sum.count += 1;
    sums.set(root, sum);
  });
  for (const [root, sum] of sums) {
    if (sum.count > 1) targets.set(root, [sum.x / sum.count, sum.y / sum.count]);
  }
  if (targets.size === 0) return [...curves];

  const next: SketchEntityDraft[] = [...curves];
  const moved = new Map<number, { start?: Point2; end?: Point2 }>();
  ends.forEach((end, index) => {
    const target = targets.get(find(index));
    if (!target) return;
    const entry = moved.get(end.curve) ?? {};
    entry[end.side] = target;
    moved.set(end.curve, entry);
  });
  for (const [index, change] of moved) {
    const curve = curves[index]!;
    const pair = openEnds(curve);
    if (!pair) continue;
    next[index] = withEnds(curve, change.start ?? pair[0], change.end ?? pair[1]);
  }
  return next;
}
