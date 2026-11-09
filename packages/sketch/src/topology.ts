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

export interface SketchTopologyFace {
  id: string;
  area: number;
  /** Entity ids of the outer contour, in order. */
  boundary: string[];
  /** Entity ids of the inner contours (holes). */
  holes: string[][];
  outline: Point2[];
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

  const edges: SketchTopologyEdge[] = [];
  const segments: Segment[] = [];

  for (const entity of curveEntities) {
    const polyline = tessellateEntity(entity);
    if (polyline.length < 2) continue;
    const closed = closedLoop(entity);
    const nodeIds = polyline.map((point) => resolveNode(point));

    let length = 0;
    for (let index = 0; index < polyline.length - 1; index += 1) {
      const a = polyline[index]!;
      const b = polyline[index + 1]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
      segments.push({ entityId: entity.id, from: nodeIds[index]!, to: nodeIds[index + 1]! });
    }
    if (closed) {
      const a = polyline[polyline.length - 1]!;
      const b = polyline[0]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
      segments.push({
        entityId: entity.id,
        from: nodeIds[nodeIds.length - 1]!,
        to: nodeIds[0]!,
      });
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

    edges.push({
      id: entity.id,
      start: '',
      end: '',
      closed: closed || (endpoints ? nodeKey(endpoints[0]) === nodeKey(endpoints[1]) : false),
      length,
      points: polyline,
    });
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

  return { points, edges, faces: findFaces(nodes, segments, polygonArea, pointInPolygon) };
}

function findFaces(
  nodes: Node[],
  segments: Segment[],
  area: (points: readonly Point2[]) => number,
  contains: (point: Point2, polygon: readonly Point2[]) => boolean,
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

  const halfEdges: { segment: number; from: number; to: number; angle: number }[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (!live[index]) continue;
    const segment = segments[index]!;
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
  const loops: { points: Point2[]; entityIds: string[] }[] = [];
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
    loops.push({ points, entityIds });
  });

  const faces: SketchTopologyFace[] = [];
  for (const loop of loops) {
    const holes = loops
      .filter((candidate) => candidate !== loop && contains(candidate.points[0]!, loop.points))
      .filter(
        (candidate) =>
          !loops.some(
            (other) =>
              other !== loop &&
              other !== candidate &&
              contains(candidate.points[0]!, other.points) &&
              contains(other.points[0]!, loop.points),
          ),
      )
      .map((candidate) => candidate.entityIds);
    faces.push({
      id: `face_${hash([...loop.entityIds.sort(), '|', ...holes.flat().sort()])}`,
      area: area(loop.points),
      boundary: loop.entityIds,
      holes,
      outline: loop.points,
    });
  }
  return faces;
}
