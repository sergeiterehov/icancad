import type { SketchEntity } from '@icancad/model';
import { tessellateEntity, type Point2 } from './index';
import { sketchTopology, type SketchTopologyLoopCurve } from './topology';

export interface ProfileLineCurve {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ProfileArcCurve {
  type: 'arc';
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
  reversed?: boolean;
}

export interface ProfileCircleCurve {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
  reversed?: boolean;
}

export type ProfileCurve = ProfileLineCurve | ProfileArcCurve | ProfileCircleCurve;

export interface ProfileLoop {
  curves: ProfileCurve[];
}

export interface ProfileRegion {
  id: string;
  area: number;
  /** 0 for an outermost face, 1+ for faces nested inside another face. */
  depth: number;
  outer: ProfileLoop;
  holes: ProfileLoop[];
  /** Stable edge keys, shared by faces that touch along an edge. */
  edges: string[];
}

// Sketch faces as extrusion profiles: exact lines, arcs and circles with the
// direction the contour walks them, so the kernel rebuilds the same shape the
// sketch shows. Ellipses and beziers are still passed as polylines.
export function sketchProfiles(entities: readonly SketchEntity[]): ProfileRegion[] {
  const topology = sketchTopology(entities);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const regions: ProfileRegion[] = [];
  for (const face of topology.faces) {
    const outer = loopCurves(face.loops[0] ?? [], byId, 'forward');
    if (outer.length === 0) continue;
    regions.push({
      id: face.id,
      area: face.area,
      depth: face.depth,
      outer: { curves: outer },
      holes: face.loops
        .slice(1)
        .map((loop) => ({ curves: loopCurves(loop, byId, 'backward') }))
        .filter((loop) => loop.curves.length > 0),
      edges: [...new Set(face.loops.flat().map((entry) => entry.edgeKey))],
    });
  }
  return regions;
}

interface EntityOrientations {
  forward: ProfileCurve[];
  backward: ProfileCurve[];
}

// Curves for one loop run. Whole entities keep their exact representation;
// partial runs of a circle or arc become the exact arc between their ends.
function runCurves(
  entry: SketchTopologyLoopCurve,
  byId: Map<string, SketchEntity>,
): ProfileCurve[] {
  const entity = byId.get(entry.entityId);
  if (!entity) return polylineCurves(entry.points);
  if (entry.full) {
    const orientations = entityOrientations(entity);
    const start = entry.points[0];
    const end = entry.points[entry.points.length - 1];
    if (start && end) {
      const matches = (curves: ProfileCurve[]) =>
        samePoint(chainStart(curves), start) && samePoint(chainEnd(curves), end);
      if (matches(orientations.forward)) return orientations.forward;
      if (matches(orientations.backward)) return orientations.backward;
    }
    return entry.reversed ? orientations.backward : orientations.forward;
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    const arc = exactArc(entity, entry.points);
    if (arc) return [arc];
  }
  if (entity.type === 'line') {
    const start = entry.points[0];
    const end = entry.points[entry.points.length - 1];
    if (start && end) {
      return [{ type: 'line', x1: start[0], y1: start[1], x2: end[0], y2: end[1] }];
    }
  }
  return polylineCurves(entry.points);
}

// An exact arc from the first to the last point of a run. The run's second
// point tells which way the loop walks the circle; endpoints that came from a
// polygonal fallback are not on the circle and stay polygonal.
function exactArc(
  entity: { cx: number; cy: number; r: number },
  points: readonly Point2[],
): ProfileArcCurve | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const onCircle = (point: Point2) =>
    Math.abs(Math.hypot(point[0] - entity.cx, point[1] - entity.cy) - entity.r) <= 1e-6;
  if (!onCircle(start) || !onCircle(end) || samePoint(start, end, SNAP_TOLERANCE)) return null;
  const startAngle = Math.atan2(start[1] - entity.cy, start[0] - entity.cx);
  const endAngle = Math.atan2(end[1] - entity.cy, end[0] - entity.cx);
  const next = points[1] ?? end;
  const alongTangent =
    (next[0] - start[0]) * -Math.sin(startAngle) +
    (next[1] - start[1]) * Math.cos(startAngle);
  if (alongTangent >= 0) {
    let sweepEnd = endAngle;
    while (sweepEnd <= startAngle) sweepEnd += Math.PI * 2;
    return {
      type: 'arc',
      cx: entity.cx,
      cy: entity.cy,
      r: entity.r,
      startAngle,
      endAngle: sweepEnd,
    };
  }
  let sweepEnd = startAngle;
  while (sweepEnd <= endAngle) sweepEnd += Math.PI * 2;
  return {
    type: 'arc',
    cx: entity.cx,
    cy: entity.cy,
    r: entity.r,
    startAngle: endAngle,
    endAngle: sweepEnd,
    reversed: true,
  };
}

const JOIN_TOLERANCE = 1e-3;
/** OCCT only joins edges that are within 1e-7 of each other. */
const SNAP_TOLERANCE = 1e-9;

// Sketch topology knows which way a loop walks an edge, but the contour handed
// to the kernel must also join exactly. Orient every contour by walking it and
// matching endpoints, so rounding in either pass cannot produce an open wire.
function loopCurves(
  loop: readonly SketchTopologyLoopCurve[],
  byId: Map<string, SketchEntity>,
  seed: 'forward' | 'backward',
): ProfileCurve[] {
  // A run cut by intersections only covers part of its entity. The topology
  // gives those pieces in loop order; keep circles and arcs exact so the
  // extruded side stays one curved face instead of a fan of flat strips.
  if (loop.some((entry) => !entry.full)) {
    return snapChain(loop.flatMap((entry) => runCurves(entry, byId)));
  }

  const pairs: EntityOrientations[] = [];
  for (const entry of loop) {
    const entity = byId.get(entry.entityId);
    if (!entity) continue;
    const orientations = entityOrientations(entity);
    if (orientations.forward.length > 0) pairs.push(orientations);
  }
  if (pairs.length === 0) return [];
  const preferred = orient(pairs, seed);
  if (preferred && closes(preferred)) return snapChain(preferred);
  const opposite = orient(pairs, seed === 'forward' ? 'backward' : 'forward');
  if (opposite && closes(opposite)) return snapChain(opposite);
  return snapChain(preferred ?? opposite ?? pairs.flatMap((pair) => pair.forward));
}

// An arc keeps the endpoints its centre, radius and angles imply, while a line
// keeps the points it was drawn from. Those differ by rounding, and OCCT will
// not join edges that are further apart than its 1e-7 tolerance, so lines are
// stretched to land exactly on the neighbouring curve.
function snapChain(curves: readonly ProfileCurve[]): ProfileCurve[] {
  const result: ProfileCurve[] = curves.map((curve) => ({ ...curve }));
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]!;
    const next = result[(index + 1) % result.length]!;
    const end = curveEnd(current);
    const start = curveStart(next);
    if (samePoint(end, start, SNAP_TOLERANCE)) continue;
    if (current.type === 'line') {
      current.x2 = start[0];
      current.y2 = start[1];
    } else if (next.type === 'line') {
      next.x1 = end[0];
      next.y1 = end[1];
    }
  }
  return result;
}

function orient(pairs: readonly EntityOrientations[], seed: 'forward' | 'backward'): ProfileCurve[] | null {
  const curves: ProfileCurve[] = [];
  let point: Point2 | null = null;
  for (const pair of pairs) {
    let picked: ProfileCurve[];
    if (point === null) {
      picked = seed === 'forward' ? pair.forward : pair.backward;
    } else {
      const candidates = [pair.forward, pair.backward];
      const start = point;
      const match = candidates.find((candidate) => samePoint(chainStart(candidate), start));
      if (!match) return null;
      picked = match;
    }
    curves.push(...picked);
    point = chainEnd(picked);
  }
  return curves;
}

function closes(curves: readonly ProfileCurve[]): boolean {
  return samePoint(chainStart(curves), chainEnd(curves));
}

function chainStart(curves: readonly ProfileCurve[]): Point2 {
  return curveStart(curves[0]!);
}

function chainEnd(curves: readonly ProfileCurve[]): Point2 {
  return curveEnd(curves[curves.length - 1]!);
}

function curveStart(curve: ProfileCurve): Point2 {
  if (curve.type === 'line') return [curve.x1, curve.y1];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.endAngle : curve.startAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}

function curveEnd(curve: ProfileCurve): Point2 {
  if (curve.type === 'line') return [curve.x2, curve.y2];
  if (curve.type === 'circle') return [curve.cx + curve.r, curve.cy];
  const angle = curve.reversed ? curve.startAngle : curve.endAngle;
  return [curve.cx + Math.cos(angle) * curve.r, curve.cy + Math.sin(angle) * curve.r];
}

function samePoint(a: Point2, b: Point2, tolerance = JOIN_TOLERANCE): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

// Both ways of walking one entity. `forward` follows the direction the entity
// was drawn; `backward` walks the same geometry the other way round.
function entityOrientations(entity: SketchEntity): EntityOrientations {
  switch (entity.type) {
    case 'line':
      return {
        forward: [{ type: 'line', x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 }],
        backward: [{ type: 'line', x1: entity.x2, y1: entity.y2, x2: entity.x1, y2: entity.y1 }],
      };
    case 'arc': {
      // OCCT arcs always run counter-clockwise, while a sketch arc may have
      // been drawn clockwise: swap the angles and keep the drawn sweep as the
      // `reversed` flag of the counter-clockwise edge.
      const naturalCcw = entity.endAngle >= entity.startAngle;
      const base = {
        type: 'arc' as const,
        cx: entity.cx,
        cy: entity.cy,
        r: entity.r,
        startAngle: naturalCcw ? entity.startAngle : entity.endAngle,
        endAngle: naturalCcw ? entity.endAngle : entity.startAngle,
      };
      return {
        forward: [{ ...base, ...(naturalCcw ? {} : { reversed: true }) }],
        backward: [{ ...base, ...(naturalCcw ? { reversed: true } : {}) }],
      };
    }
    case 'circle':
      return {
        forward: [{ type: 'circle', cx: entity.cx, cy: entity.cy, r: entity.r }],
        backward: [{ type: 'circle', cx: entity.cx, cy: entity.cy, r: entity.r, reversed: true }],
      };
    case 'ellipse':
    case 'bezier': {
      const points: Point2[] = tessellateEntity(entity);
      const closed = entity.type === 'ellipse';
      const backwardPoints = [...points].reverse();
      return {
        forward: polylineCurves(closed ? [...points, points[0]!] : points),
        backward: polylineCurves(
          closed ? [...backwardPoints, backwardPoints[0]!] : backwardPoints,
        ),
      };
    }
    case 'point':
      return { forward: [], backward: [] };
  }
}

function polylineCurves(points: readonly Point2[]): ProfileCurve[] {
  const curves: ProfileCurve[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    curves.push({ type: 'line', x1: from[0], y1: from[1], x2: to[0], y2: to[1] });
  }
  return curves;
}
