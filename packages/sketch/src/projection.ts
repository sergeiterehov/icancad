import type { SketchEntity, SketchFrame, Vec3 } from '@icancad/model';
import type { Point2 } from './index';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** A sketch entity without its id, ready to be given one by the caller. */
export type SketchEntityDraft = WithoutId<SketchEntity>;

/** Points closer than this fraction of the curve size are the same point. */
const POINT_TOLERANCE = 1e-7;

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

function isCollinear(points: readonly Point2[]): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return true;
  const length = distance(first, last);
  const tolerance = Math.max(extent(points) * 1e-6, 1e-9);
  if (length <= tolerance) return false;
  const dx = (last[0] - first[0]) / length;
  const dy = (last[1] - first[1]) / length;
  for (const point of points) {
    const offset = Math.abs((point[0] - first[0]) * dy - (point[1] - first[1]) * dx);
    if (offset > tolerance) return false;
  }
  return true;
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

function ellipseFromClosedLoop(points: readonly Point2[]): SketchEntityDraft | null {
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
  if (error > 1e-3) return null;
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

function arcFromOpenCurve(points: readonly Point2[]): SketchEntityDraft | null {
  if (points.length < 4) return null;
  const circle = fitCircle(points);
  if (!circle) return null;
  const scale = extent(points);
  if (circle.r > scale * 1e4) return null;
  let error = 0;
  for (const [x, y] of points) {
    error = Math.max(error, Math.abs(Math.hypot(x - circle.cx, y - circle.cy) - circle.r));
  }
  if (error > Math.max(scale * 1e-4, 1e-6)) return null;
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
  const firstPole: Point2 =
    polesX && polesY
      ? [polesX[0], polesY[0]]
      : [first[0] + (last[0] - first[0]) / 3, first[1] + (last[1] - first[1]) / 3];
  const secondPole: Point2 =
    polesX && polesY
      ? [polesX[1], polesY[1]]
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
): SketchEntityDraft | null {
  const simplified = simplify(points);
  if (simplified.length < 2) return null;
  const first = simplified[0]!;
  const last = simplified[simplified.length - 1]!;
  if (!closed) {
    if (isCollinear(simplified)) {
      return {
        type: 'line',
        construction: false,
        x1: first[0],
        y1: first[1],
        x2: last[0],
        y2: last[1],
      };
    }
    const arc = arcFromOpenCurve(simplified);
    if (arc) return arc;
  } else {
    const ellipse = ellipseFromClosedLoop(simplified);
    if (ellipse) return ellipse;
    const circle = fitCircle(simplified);
    if (circle) {
      const scale = extent(simplified);
      let error = 0;
      for (const [x, y] of simplified) {
        error = Math.max(error, Math.abs(Math.hypot(x - circle.cx, y - circle.cy) - circle.r));
      }
      if (circle.r < scale * 1e4 && error <= Math.max(scale * 1e-4, 1e-6)) {
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
