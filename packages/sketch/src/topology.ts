import type { SketchEntity } from '@icancad/model';
import { entityControlPoints, entityEndpoints, tessellateEntity, type Point2 } from './index';

const NODE_TOLERANCE = 1e-3;

export interface SketchTopologyPoint {
  id: string;
  x: number;
  y: number;
  kind: 'end' | 'center' | 'isolated';
}

export interface SketchTopologyEdge {
  id: string;
  start: string;
  end: string;
  closed: boolean;
  length: number;
  points: Point2[];
}

export interface SketchTopologyLoopCurve {
  entityId: string;
  /** True when the loop walks the entity against its natural direction. */
  reversed: boolean;
  /** The portion of the entity used by this loop, in loop direction. */
  points: Point2[];
  /** The run uses the whole entity, so the exact curve can be used. */
  full: boolean;
  /** Stable identity of the geometric edge, shared by adjacent faces. */
  edgeKey: string;
}

export interface SketchTopologyFace {
  id: string;
  area: number;
  /** Entity ids of the outer contour, in order. */
  boundary: string[];
  /** Entity ids of the inner contours (holes). */
  holes: string[][];
  outline: Point2[];
  /** Point contours of the holes, for filling and picking the face. */
  holeOutlines: Point2[][];
  /** Ordered contours: the first loop is the outer boundary, the rest are holes. */
  loops: SketchTopologyLoopCurve[][];
  /** How many other contours enclose this face; 0 means an outermost face. */
  depth: number;
}

export interface SketchTopology {
  points: SketchTopologyPoint[];
  edges: SketchTopologyEdge[];
  faces: SketchTopologyFace[];
}

interface Node {
  x: number;
  y: number;
}

interface Segment {
  entityId: string;
  from: number;
  to: number;
}

function nodeKey(point: Point2): string {
  return `${Math.round(point[0] / NODE_TOLERANCE)}:${Math.round(point[1] / NODE_TOLERANCE)}`;
}

function hash(values: readonly string[]): string {
  let result = 2166136261;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    result ^= 44;
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function polygonArea(points: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function closedLoop(entity: SketchEntity): boolean {
  return entity.type === 'circle' || entity.type === 'ellipse';
}

// Crossing point of two polyline segments, with the parameters needed to split
// both entities at the same place.
function segmentIntersection(
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
): { point: Point2; t: number; u: number } | null {
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

function normalizeAngle(angle: number): number {
  let value = angle % TAU;
  if (value < 0) value += TAU;
  return value;
}

interface CircleLike {
  cx: number;
  cy: number;
  r: number;
  /** Set for arcs: true when the angle lies inside the drawn sweep. */
  onArc?: (angle: number) => boolean;
}

function circleOf(entity: SketchEntity): CircleLike | null {
  if (entity.type === 'circle') return { cx: entity.cx, cy: entity.cy, r: entity.r };
  if (entity.type !== 'arc') return null;
  const { cx, cy, r, startAngle, endAngle } = entity;
  const naturalCcw = endAngle >= startAngle;
  const from = naturalCcw ? startAngle : endAngle;
  const sweep = normalizeAngle((naturalCcw ? endAngle - startAngle : startAngle - endAngle));
  return {
    cx,
    cy,
    r,
    onArc: (angle) => normalizeAngle(angle - from) <= sweep + 1e-9,
  };
}

// Exact crossings for circles, arcs and lines. Splitting at chord intersections
// would leave the intersection slightly off the real circle and force the
// profile to stay polygonal; exact points keep partial runs as real arcs.
function exactIntersections(first: SketchEntity, second: SketchEntity): Point2[] | null {
  const firstCircle = circleOf(first);
  const secondCircle = circleOf(second);
  if (firstCircle && secondCircle) {
    const dx = secondCircle.cx - firstCircle.cx;
    const dy = secondCircle.cy - firstCircle.cy;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) return [];
    if (
      distance > firstCircle.r + secondCircle.r + 1e-9 ||
      distance < Math.abs(firstCircle.r - secondCircle.r) - 1e-9
    ) {
      return [];
    }
    const along = (distance * distance + firstCircle.r * firstCircle.r - secondCircle.r * secondCircle.r) / (2 * distance);
    const height = Math.sqrt(Math.max(0, firstCircle.r * firstCircle.r - along * along));
    const mx = firstCircle.cx + (along * dx) / distance;
    const my = firstCircle.cy + (along * dy) / distance;
    const points: Point2[] =
      height < 1e-9
        ? [[mx, my]]
        : [
            [mx - (dy / distance) * height, my + (dx / distance) * height],
            [mx + (dy / distance) * height, my - (dx / distance) * height],
          ];
    return points.filter((point) => {
      const angle = Math.atan2(point[1] - firstCircle.cy, point[0] - firstCircle.cx);
      const secondAngle = Math.atan2(point[1] - secondCircle.cy, point[0] - secondCircle.cx);
      return (
        (!firstCircle.onArc || firstCircle.onArc(angle)) &&
        (!secondCircle.onArc || secondCircle.onArc(secondAngle))
      );
    });
  }
  if (firstCircle && second.type === 'line') return lineCircle(firstCircle, second);
  if (secondCircle && first.type === 'line') return lineCircle(secondCircle, first);
  return null;
}

function lineCircle(circle: CircleLike, line: SketchEntity): Point2[] {
  if (line.type !== 'line') return [];
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
  return parameters
    .filter((value) => value >= -1e-9 && value <= 1 + 1e-9)
    .map((value): Point2 => [line.x1 + dx * value, line.y1 + dy * value])
    .filter((point) => {
      if (!circle.onArc) return true;
      return circle.onArc(Math.atan2(point[1] - circle.cy, point[0] - circle.cx));
    });
}



// Sketch geometry as the object it becomes after the sketch is finished: points,
// edges and the faces bounded by those edges. Construction geometry is ignored.
export function sketchTopology(entities: readonly SketchEntity[]): SketchTopology {
  const curveEntities = entities.filter(
    (entity) => !entity.construction && entity.type !== 'point',
  );

  const nodes: Node[] = [];
  const nodeIndex = new Map<string, number>();
  // Every reported point remembers the sketch control points that define it, so
  // its id follows the sketch entity rather than the traversal order.
  const nodeRefs = new Map<number, { entityId: string; index: number }[]>();

  const resolveNode = (point: Point2): number => {
    const key = nodeKey(point);
    const existing = nodeIndex.get(key);
    if (existing !== undefined) return existing;
    const node = { x: point[0], y: point[1] };
    nodes.push(node);
    nodeIndex.set(key, nodes.length - 1);
    return nodes.length - 1;
  };

  const registerRef = (node: number, entityId: string, index: number) => {
    const list = nodeRefs.get(node) ?? [];
    list.push({ entityId, index });
    nodeRefs.set(node, list);
  };

  const controlIndexOf = (entity: SketchEntity, point: Point2): number => {
    const key = nodeKey(point);
    const index = entityControlPoints(entity).findIndex(
      (candidate) => nodeKey(candidate) === key,
    );
    return index < 0 ? 0 : index;
  };

  const stableNodeId = (node: number): string => {
    const refs = nodeRefs.get(node);
    if (!refs || refs.length === 0) return `pt_${node}`;
    const [best] = [...refs].sort((a, b) =>
      a.entityId === b.entityId ? a.index - b.index : a.entityId < b.entityId ? -1 : 1,
    );
    return `pt_${best!.entityId}_${best!.index}`;
  };

  interface CurveData {
    entity: SketchEntity;
    polyline: Point2[];
    closed: boolean;
    /** Intersections that must be inserted into each polyline segment. */
    splits: Map<number, { t: number; point: Point2 }[]>;
  }

  const edges: SketchTopologyEdge[] = [];
  const curves: CurveData[] = [];

  for (const entity of curveEntities) {
    const polyline = tessellateEntity(entity);
    if (polyline.length < 2) continue;
    const closed = closedLoop(entity);

    let length = 0;
    for (let index = 0; index < polyline.length - 1; index += 1) {
      const a = polyline[index]!;
      const b = polyline[index + 1]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (closed) {
      const a = polyline[polyline.length - 1]!;
      const b = polyline[0]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }

    const endpoints = entityEndpoints(entity);
    edges.push({
      id: entity.id,
      start: '',
      end: '',
      closed: closed || (endpoints ? nodeKey(endpoints[0]) === nodeKey(endpoints[1]) : false),
      length,
      points: polyline,
    });
    curves.push({ entity, polyline, closed, splits: new Map() });
  }

  // Curves are tessellated independently, so crossings are not vertices yet.
  // Split every segment at its intersections with the other curves before the
  // half-edge traversal; without this two crossing circles stay two loops
  // instead of becoming three faces.
  const segmentCount = (curve: CurveData) =>
    curve.closed ? curve.polyline.length : curve.polyline.length - 1;
  const addSplit = (
    curve: CurveData,
    index: number,
    split: { t: number; point: Point2 },
  ) => {
    const list = curve.splits.get(index) ?? [];
    list.push(split);
    curve.splits.set(index, list);
  };
  const projectOntoCurve = (
    curve: CurveData,
    point: Point2,
  ): { index: number; t: number } | null => {
    const { polyline } = curve;
    let best: { index: number; t: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < segmentCount(curve); index += 1) {
      const from = polyline[index]!;
      const to = polyline[(index + 1) % polyline.length]!;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const length2 = dx * dx + dy * dy;
      const t =
        length2 === 0
          ? 0
          : Math.min(1, Math.max(0, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length2));
      const x = from[0] + dx * t;
      const y = from[1] + dy * t;
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { index, t };
      }
    }
    return best;
  };
  const addExactSplit = (curve: CurveData, point: Point2) => {
    const projection = projectOntoCurve(curve, point);
    if (!projection) return;
    addSplit(curve, projection.index, { t: projection.t, point });
  };

  for (let a = 0; a < curves.length; a += 1) {
    for (let b = a + 1; b < curves.length; b += 1) {
      const first = curves[a]!;
      const second = curves[b]!;
      const exact = exactIntersections(first.entity, second.entity);
      if (exact) {
        for (const point of exact) {
          addExactSplit(first, point);
          addExactSplit(second, point);
        }
        continue;
      }
      for (let i = 0; i < segmentCount(first); i += 1) {
        const a1 = first.polyline[i]!;
        const a2 = first.polyline[(i + 1) % first.polyline.length]!;
        for (let j = 0; j < segmentCount(second); j += 1) {
          const b1 = second.polyline[j]!;
          const b2 = second.polyline[(j + 1) % second.polyline.length]!;
          const hit = segmentIntersection(a1, a2, b1, b2);
          if (!hit) continue;
          addSplit(first, i, { t: hit.t, point: hit.point });
          addSplit(second, j, { t: hit.u, point: hit.point });
        }
      }
    }
  }

  const segments: Segment[] = [];
  for (const curve of curves) {
    const { entity, polyline, splits } = curve;
    const nodeIds = polyline.map((point) => resolveNode(point));
    const count = segmentCount(curve);
    for (let index = 0; index < count; index += 1) {
      const endIndex = (index + 1) % polyline.length;
      let previous = nodeIds[index]!;
      const points = (splits.get(index) ?? []).sort((a, b) => a.t - b.t);
      for (const split of points) {
        if (split.t <= 1e-9 || split.t >= 1 - 1e-9) continue;
        const node = resolveNode(split.point);
        if (node === previous) continue;
        segments.push({ entityId: entity.id, from: previous, to: node });
        previous = node;
      }
      const endNode = nodeIds[endIndex]!;
      if (endNode !== previous) {
        segments.push({ entityId: entity.id, from: previous, to: endNode });
      }
    }

    const endpoints = entityEndpoints(entity);
    if (endpoints) {
      registerRef(nodeIds[0]!, entity.id, controlIndexOf(entity, endpoints[0]));
      registerRef(
        nodeIds[nodeIds.length - 1]!,
        entity.id,
        controlIndexOf(entity, endpoints[1]),
      );
    }
    if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse') {
      registerRef(resolveNode([entity.cx, entity.cy]), entity.id, 0);
    }
  }

  const points: SketchTopologyPoint[] = [];
  const seenNodes = new Set<number>();
  const addPoint = (index: number, kind: SketchTopologyPoint['kind']) => {
    if (seenNodes.has(index)) return;
    seenNodes.add(index);
    const node = nodes[index];
    if (!node) return;
    points.push({ id: stableNodeId(index), x: node.x, y: node.y, kind });
  };
  for (const entity of curveEntities) {
    const endpoints = entityEndpoints(entity);
    if (endpoints) {
      addPoint(resolveNode(endpoints[0]), 'end');
      addPoint(resolveNode(endpoints[1]), 'end');
    }
    if (entity.type === 'circle' || entity.type === 'arc' || entity.type === 'ellipse') {
      addPoint(resolveNode([entity.cx, entity.cy]), 'center');
    }
  }
  for (const entity of entities) {
    if (entity.type === 'point' && !entity.construction) {
      const node = resolveNode([entity.x, entity.y]);
      registerRef(node, entity.id, 0);
      addPoint(node, 'isolated');
    }
  }

  for (const edge of edges) {
    const polyline = edge.points;
    if (polyline.length === 0) continue;
    edge.start = stableNodeId(resolveNode(polyline[0]!));
    edge.end = edge.closed
      ? edge.start
      : stableNodeId(resolveNode(polyline[polyline.length - 1]!));
  }

  const polylines = new Map<string, Point2[]>();
  for (const edge of edges) polylines.set(edge.id, edge.points);
  return {
    points,
    edges,
    faces: findFaces(nodes, segments, polygonArea, pointInPolygon, polylines),
  };
}

function findFaces(
  nodes: Node[],
  segments: Segment[],
  area: (points: readonly Point2[]) => number,
  contains: (point: Point2, polygon: readonly Point2[]) => boolean,
  polylines: Map<string, Point2[]>,
): SketchTopologyFace[] {
  // Drop dangling segments so open chains never take part in face detection.
  const live = segments.map(() => true);
  const degree = new Map<number, number>();
  const bump = (node: number, delta: number) =>
    degree.set(node, (degree.get(node) ?? 0) + delta);
  for (const segment of segments) {
    bump(segment.from, 1);
    bump(segment.to, 1);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < segments.length; index += 1) {
      if (!live[index]) continue;
      const segment = segments[index]!;
      if ((degree.get(segment.from) ?? 0) <= 1 || (degree.get(segment.to) ?? 0) <= 1) {
        live[index] = false;
        bump(segment.from, -1);
        bump(segment.to, -1);
        changed = true;
      }
    }
  }

  // Half-edge traversal: at each node the next half-edge is the one immediately
  // clockwise from the reverse of the incoming edge, which keeps faces on the left.
  const outgoing = new Map<number, number[]>();
  const nextOf = new Map<number, number>();
  const angleAt = (from: number, to: number): number => {
    const a = nodes[from]!;
    const b = nodes[to]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const segmentTotals = new Map<string, number>();
  const halfEdges: { segment: number; from: number; to: number; angle: number }[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (!live[index]) continue;
    const segment = segments[index]!;
    segmentTotals.set(segment.entityId, (segmentTotals.get(segment.entityId) ?? 0) + 1);
    halfEdges.push({ segment: index, from: segment.from, to: segment.to, angle: angleAt(segment.from, segment.to) });
    halfEdges.push({ segment: index, from: segment.to, to: segment.from, angle: angleAt(segment.to, segment.from) });
  }
  halfEdges.forEach((halfEdge, index) => {
    const list = outgoing.get(halfEdge.from) ?? [];
    list.push(index);
    outgoing.set(halfEdge.from, list);
  });
  for (const [node, list] of outgoing) {
    list.sort((a, b) => halfEdges[a]!.angle - halfEdges[b]!.angle);
    outgoing.set(node, list);
  }
  halfEdges.forEach((halfEdge, index) => {
    const list = outgoing.get(halfEdge.to) ?? [];
    if (list.length === 0) return;
    const incomingAngle = angleAt(halfEdge.to, halfEdge.from);
    // The list is sorted clockwise from the reverse direction.
    let best = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const candidate of list) {
      let delta = incomingAngle - halfEdges[candidate]!.angle;
      while (delta <= 0) delta += Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
    if (best >= 0) nextOf.set(index, best);
  });

  const visited = new Set<number>();
  const loops: {
    points: Point2[];
    entityIds: string[];
    curves: SketchTopologyLoopCurve[];
  }[] = [];
  halfEdges.forEach((_, start) => {
    if (visited.has(start)) return;
    const cycle: number[] = [];
    let current: number | undefined = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      cycle.push(current);
      current = nextOf.get(current);
    }
    if (cycle.length < 3) return;
    const points = cycle.map((index) => {
      const node = nodes[halfEdges[index]!.from]!;
      return [node.x, node.y] as Point2;
    });
    if (area(points) <= 0) return;
    const entityIds: string[] = [];
    for (const index of cycle) {
      const entityId = segments[halfEdges[index]!.segment]!.entityId;
      if (entityIds[entityIds.length - 1] !== entityId) entityIds.push(entityId);
    }
    if (entityIds.length > 1 && entityIds[0] === entityIds[entityIds.length - 1]) entityIds.pop();

    const curves: SketchTopologyLoopCurve[] = [];
    let index = 0;
    while (index < cycle.length) {
      const entityId = segments[halfEdges[cycle[index]!]!.segment]!.entityId;
      const startHalf = halfEdges[cycle[index]!]!;
      let end = index;
      while (
        end + 1 < cycle.length &&
        segments[halfEdges[cycle[end + 1]!]!.segment]!.entityId === entityId
      ) {
        end += 1;
      }
      const endHalf = halfEdges[cycle[end]!]!;
      const polyline = polylines.get(entityId) ?? [];
      const from = nodes[startHalf.from]!;
      const to = nodes[endHalf.to]!;
      const reversed = directionOfRun(polyline, from, to) === 'reversed';
      const runPoints: Point2[] = [];
      for (let step = index; step <= end; step += 1) {
        const node = nodes[halfEdges[cycle[step]!]!.from]!;
        runPoints.push([node.x, node.y]);
      }
      runPoints.push([to.x, to.y]);
      const startKey = nodeKey([from.x, from.y]);
      const endKey = nodeKey([to.x, to.y]);
      // Two arcs can share endpoints on the same circle (lens vs crescent), so
      // the length is part of the edge identity.
      let runLength = 0;
      for (let step = 1; step < runPoints.length; step += 1) {
        const previous = runPoints[step - 1]!;
        const point = runPoints[step]!;
        runLength += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      }
      curves.push({
        entityId,
        reversed,
        points: runPoints,
        full: end - index + 1 === (segmentTotals.get(entityId) ?? -1),
        edgeKey: `${entityId}|${[startKey, endKey].sort().join('-')}|${runLength.toFixed(6)}`,
      });
      index = end + 1;
    }

    // The loop starts at an arbitrary half-edge, which can cut a single
    // geometric run in two. Join the last and first runs when they belong to
    // the same entity; otherwise adjacent faces would describe the same arc
    // with different edge keys just because they started elsewhere.
    if (curves.length > 1) {
      const first = curves[0]!;
      const last = curves[curves.length - 1]!;
      if (first.entityId === last.entityId) {
        const mergedPoints = [...last.points, ...first.points.slice(1)];
        let mergedLength = 0;
        for (let step = 1; step < mergedPoints.length; step += 1) {
          const previous = mergedPoints[step - 1]!;
          const point = mergedPoints[step]!;
          mergedLength += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        }
        const startKey = nodeKey(mergedPoints[0]!);
        const endKey = nodeKey(mergedPoints[mergedPoints.length - 1]!);
        curves.splice(0, 1);
        curves.pop();
        curves.unshift({
          entityId: first.entityId,
          reversed: last.reversed,
          points: mergedPoints,
          full: mergedPoints.length - 1 === (segmentTotals.get(first.entityId) ?? -1),
          edgeKey: `${first.entityId}|${[startKey, endKey].sort().join('-')}|${mergedLength.toFixed(6)}`,
        });
      }
    }
    loops.push({ points, entityIds, curves });
  });

  // A loop is a hole only when every one of its points is inside the outer
  // contour. Testing a single point wrongly turns an overlapping circle into a
  // hole: its first vertex may lie inside the other circle even though the
  // loops cross.
  const loopInside = (inner: readonly Point2[], outer: readonly Point2[]): boolean =>
    inner.every((point) => contains(point, outer));

  const entries = loops.map((loop) => {
    const holeContours = loops
      .filter((candidate) => candidate !== loop && loopInside(candidate.points, loop.points))
      .filter(
        (candidate) =>
          !loops.some(
            (other) =>
              other !== loop &&
              other !== candidate &&
              loopInside(candidate.points, other.points) &&
              loopInside(other.points, loop.points),
          ),
      );
    const holes = holeContours.map((candidate) => candidate.entityIds);
    return {
      loop,
      holes,
      holeContours,
      base: hash([...loop.entityIds.sort(), '|', ...holes.flat().sort()]),
      id: '',
    };
  });

  // Faces of intersecting curves share the same boundary entities, so the
  // entity ids alone are not unique. Number such faces by area and by the
  // centroid relative to their own bounding box, which stays the same when the
  // sketch is translated.
  const normalizedCentroid = (points: readonly Point2[]): Point2 => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      sumX += point[0];
      sumY += point[1];
    }
    return [sumX / points.length - minX, sumY / points.length - minY];
  };
  const byBase = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = byBase.get(entry.base) ?? [];
    group.push(entry);
    byBase.set(entry.base, group);
  }
  for (const group of byBase.values()) {
    if (group.length === 1) {
      group[0]!.id = `face_${group[0]!.base}`;
      continue;
    }
    group.sort((left, right) => {
      const areaDiff = area(left.loop.points) - area(right.loop.points);
      if (Math.abs(areaDiff) > 1e-9) return areaDiff;
      const [leftX, leftY] = normalizedCentroid(left.loop.points);
      const [rightX, rightY] = normalizedCentroid(right.loop.points);
      if (Math.abs(leftX - rightX) > 1e-9) return leftX - rightX;
      return leftY - rightY;
    });
    group.forEach((entry, index) => {
      entry.id = `face_${entry.base}-${index}`;
    });
  }

  const faces: SketchTopologyFace[] = [];
  for (const { loop, holes, holeContours, id } of entries) {
    // A hole must be walked opposite to the outer contour.
    const holeLoops = holeContours.map((candidate) =>
      [...candidate.curves].reverse().map((curve) => ({
        ...curve,
        reversed: !curve.reversed,
        points: [...curve.points].reverse(),
      })),
    );
    faces.push({
      id,
      area: area(loop.points),
      boundary: loop.entityIds,
      holes,
      outline: loop.points,
      holeOutlines: holeContours.map((candidate) => candidate.points),
      loops: [loop.curves, ...holeLoops],
      depth: loops.filter(
        (candidate) => candidate !== loop && loopInside(loop.points, candidate.points),
      ).length,
    });
  }
  return faces;
}

function directionOfRun(polyline: Point2[], from: Node, to: Node): 'forward' | 'reversed' {
  const keyFrom = nodeKey([from.x, from.y]);
  const keyTo = nodeKey([to.x, to.y]);
  const count = polyline.length;
  const pairs: [number, number][] = [];
  for (let index = 0; index < count - 1; index += 1) pairs.push([index, index + 1]);
  pairs.push([count - 1, 0]);
  for (const [a, b] of pairs) {
    const keyA = nodeKey(polyline[a]!);
    const keyB = nodeKey(polyline[b]!);
    if (keyA === keyFrom && keyB === keyTo) return 'forward';
    if (keyA === keyTo && keyB === keyFrom) return 'reversed';
  }
  return 'forward';
}
