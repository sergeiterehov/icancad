import type { SketchEntity } from '@icancad/model';
import {
  entityEndpoints,
  tessellateEntity,
  unwrapAngle,
  type Point2,
} from './index';
import { sketchCurvesFromPolyline, polylineSagitta, type SketchEntityDraft } from './projection';
import {
  circleCircleIntersections,
  exactCurveIntersections,
  lineCircleIntersections,
  normalizeAngle,
  segmentIntersection,
} from './intersect';

/**
 * Offsets and outlines of sketch curves.
 *
 * A sketch is a set of curves, but a user thinks in chains: the edge of a plate,
 * the profile of a slot. Offsetting that chain by a distance is what "смещение"
 * means, and wrapping it in a closed curve at a distance is what "контур" means.
 * The geometry here keeps lines, arcs and circles exact, since those offsets are
 * again lines, arcs and circles; an ellipse or a Bezier is sampled and fitted,
 * because its exact offset is not a curve of the same family.
 */

/** How the offset curves meet at a corner of the source chain. */
export type OffsetJoin = 'round' | 'miter';

export interface OrientedCurve {
  entity: SketchEntity;
  /** The walk direction is opposite to the entity's own direction. */
  reversed: boolean;
}

export interface CurveChain {
  curves: OrientedCurve[];
  closed: boolean;
}

export type ChainFailure = 'branching' | 'empty';

export interface ChainCollection {
  chains: CurveChain[];
  error?: ChainFailure;
}

/** A point closer than this is the same node of the chain. */
const NODE_TOLERANCE = 1e-3;

/** Curves that can take part in a chain: everything with an end or a loop. */
export function isChainCurve(entity: SketchEntity): boolean {
  return entity.type !== 'point';
}

function isLoopCurve(entity: SketchEntity): boolean {
  return entity.type === 'circle' || entity.type === 'ellipse';
}

function nodeKey(point: Point2): string {
  return `${Math.round(point[0] / NODE_TOLERANCE)}:${Math.round(point[1] / NODE_TOLERANCE)}`;
}

interface NodeUse {
  curve: number;
  /** 0 when the curve starts at this node, 1 when it ends there. */
  end: 0 | 1;
}

function addUse(nodes: Map<string, NodeUse[]>, point: Point2, use: NodeUse) {
  const key = nodeKey(point);
  const list = nodes.get(key) ?? [];
  list.push(use);
  nodes.set(key, list);
  return key;
}

/**
 * Orders curves into chains: a run of curves where every end meets the next
 * one, open from its first node to its last or closed when it comes back. A
 * selection that forks (three curves at one point) has no single chain, and the
 * tool reports `branching` instead of guessing.
 */
export function collectCurveChains(entities: readonly SketchEntity[]): ChainCollection {
  const curves = entities.filter(isChainCurve);
  if (curves.length === 0) return { chains: [], error: 'empty' };

  const nodes = new Map<string, NodeUse[]>();
  const open: number[] = [];
  const loops: number[] = [];
  curves.forEach((entity, index) => {
    if (isLoopCurve(entity)) {
      loops.push(index);
      return;
    }
    const ends = entityEndpoints(entity);
    if (!ends) return;
    open.push(index);
    addUse(nodes, ends[0], { curve: index, end: 0 });
    addUse(nodes, ends[1], { curve: index, end: 1 });
  });
  for (const uses of nodes.values()) {
    if (uses.length > 2) return { chains: [], error: 'branching' };
  }

  const visited = new Set<number>();
  const chains: CurveChain[] = [];

  // Walk from every free end: that is where an open chain begins and ends, so
  // the chain is oriented the way it was drawn rather than randomly.
  const walk = (startCurve: number, startEnd: 0 | 1): CurveChain | null => {
    const used: OrientedCurve[] = [];
    let curve = startCurve;
    let reversed = startEnd === 1;
    for (;;) {
      visited.add(curve);
      const entity = curves[curve]!;
      used.push({ entity, reversed });
      const ends = entityEndpoints(entity);
      if (!ends) break;
      const exit = reversed ? ends[0] : ends[1];
      const uses = nodes.get(nodeKey(exit)) ?? [];
      const next = uses.find((use) => use.curve !== curve && !visited.has(use.curve));
      if (!next) break;
      curve = next.curve;
      // Entering a curve at its end means we travel it backwards.
      reversed = next.end === 1;
    }
    return { curves: used, closed: false };
  };

  for (const index of open) {
    if (visited.has(index)) continue;
    const ends = entityEndpoints(curves[index]!);
    if (!ends) continue;
    const startUses = nodes.get(nodeKey(ends[0])) ?? [];
    const endUses = nodes.get(nodeKey(ends[1])) ?? [];
    // A free end is a node with a single curve; a closed run has none, and is
    // picked up by the loop pass below.
    const fromStart = startUses.length === 1;
    const fromEnd = endUses.length === 1;
    if (!fromStart && !fromEnd) continue;
    const chain = walk(index, fromStart ? 0 : 1);
    if (chain) chains.push(chain);
  }

  // What is left of the open curves belongs to closed runs. Walk them from any
  // curve and keep going until the nodes lead back to the start.
  for (const index of open) {
    if (visited.has(index)) continue;
    const entity = curves[index]!;
    const ends = entityEndpoints(entity);
    if (!ends) continue;
    const used: OrientedCurve[] = [];
    let curve = index;
    let reversed = false;
    const startKey = nodeKey(ends[0]);
    let closed = false;
    for (;;) {
      visited.add(curve);
      used.push({ entity: curves[curve]!, reversed });
      const current = entityEndpoints(curves[curve]!);
      if (!current) break;
      const exit = reversed ? current[0] : current[1];
      const exitKey = nodeKey(exit);
      if (used.length > 1 && exitKey === startKey) {
        closed = true;
        break;
      }
      const uses = nodes.get(exitKey) ?? [];
      const next = uses.find((use) => use.curve !== curve && !visited.has(use.curve));
      if (!next) break;
      curve = next.curve;
      reversed = next.end === 1;
    }
    chains.push({ curves: used, closed });
  }

  for (const index of loops) {
    visited.add(index);
    chains.push({ curves: [{ entity: curves[index]!, reversed: false }], closed: true });
  }

  return { chains };
}

/** The point where the walk enters a curve. */
export function orientedStart(curve: OrientedCurve): Point2 | null {
  const ends = entityEndpoints(curve.entity);
  if (!ends) return null;
  return curve.reversed ? ends[1] : ends[0];
}

/** The point where the walk leaves a curve. */
export function orientedEnd(curve: OrientedCurve): Point2 | null {
  const ends = entityEndpoints(curve.entity);
  if (!ends) return null;
  return curve.reversed ? ends[0] : ends[1];
}

/** The chain sampled as one polyline, in walk order. */
export function chainPolyline(chain: CurveChain): Point2[] {
  const points: Point2[] = [];
  for (const curve of chain.curves) {
    const samples = tessellateEntity(curve.entity, 48);
    const ordered = curve.reversed ? [...samples].reverse() : samples;
    for (const point of ordered) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-9) continue;
      points.push(point);
    }
  }
  return points;
}

/**
 * Signed distance from a point to the chain: positive when the point lies to
 * the left of the walk, negative to the right. The magnitude is the distance to
 * the nearest place of the chain, so dragging the pointer away from the
 * geometry sets the offset exactly.
 */
export function signedDistanceToChain(chain: CurveChain, point: Point2): number {
  const polyline = chainPolyline(chain);
  if (polyline.length < 2) return 0;
  const count = chain.closed ? polyline.length : polyline.length - 1;
  let best = Number.POSITIVE_INFINITY;
  let side = 1;
  for (let index = 0; index < count; index += 1) {
    const from = polyline[index]!;
    const to = polyline[(index + 1) % polyline.length]!;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) continue;
    const t = Math.min(
      1,
      Math.max(0, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length2),
    );
    const x = from[0] + dx * t;
    const y = from[1] + dy * t;
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < best) {
      best = distance;
      side = dx * (point[1] - from[1]) - dy * (point[0] - from[0]) >= 0 ? 1 : -1;
    }
  }
  if (!Number.isFinite(best)) return 0;
  return side * best;
}

/** The curve's offset as sketches, exact where the family allows it. */
function offsetEntity(entity: SketchEntity, distance: number): SketchEntityDraft[] | null {
  const tolerance = 1e-6;
  switch (entity.type) {
    case 'line': {
      const dx = entity.x2 - entity.x1;
      const dy = entity.y2 - entity.y1;
      const length = Math.hypot(dx, dy);
      if (length < tolerance) return null;
      const nx = (-dy / length) * distance;
      const ny = (dx / length) * distance;
      return [
        {
          type: 'line',
          construction: entity.construction,
          x1: entity.x1 + nx,
          y1: entity.y1 + ny,
          x2: entity.x2 + nx,
          y2: entity.y2 + ny,
        },
      ];
    }
    case 'circle': {
      // The natural direction of a circle is counter-clockwise, so the left of
      // the walk is the inside and a positive distance shrinks the radius.
      const radius = entity.r - distance;
      if (radius <= tolerance) return null;
      return [
        { type: 'circle', construction: entity.construction, cx: entity.cx, cy: entity.cy, r: radius },
      ];
    }
    case 'arc': {
      const ccw = entity.endAngle >= entity.startAngle;
      const radius = entity.r + (ccw ? -distance : distance);
      if (Math.abs(radius) <= tolerance) return null;
      if (radius < 0) {
        // The offset went past the centre: the same normal keeps pointing at
        // the opposite side, so the arc continues there with the same sweep.
        return [
          {
            type: 'arc',
            construction: entity.construction,
            cx: entity.cx,
            cy: entity.cy,
            r: -radius,
            startAngle: entity.startAngle + Math.PI,
            endAngle: entity.endAngle + Math.PI,
          },
        ];
      }
      return [
        {
          type: 'arc',
          construction: entity.construction,
          cx: entity.cx,
          cy: entity.cy,
          r: radius,
          startAngle: entity.startAngle,
          endAngle: entity.endAngle,
        },
      ];
    }
    case 'ellipse':
    case 'elliptical-arc':
    case 'bezier':
      return offsetFitted(entity, distance);
    default:
      return null;
  }
}

/**
 * Offsets a curve that has no offset of its own family: the curve is sampled,
 * every sample is moved along the normal of the polyline, and the result is
 * fitted back into lines, arcs and Beziers.
 */
function offsetFitted(entity: SketchEntity, distance: number): SketchEntityDraft[] | null {
  const closed = entity.type === 'ellipse';
  const points = tessellateEntity(entity, 96);
  if (points.length < 3) return null;
  const offsetPoints: Point2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const before =
      index > 0 ? points[index - 1]! : closed ? points[points.length - 1]! : points[index]!;
    const after =
      index + 1 < points.length
        ? points[index + 1]!
        : closed
          ? points[0]!
          : points[index]!;
    let dx = after[0] - before[0];
    let dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-12) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }
    const point = points[index]!;
    offsetPoints.push([point[0] - dy * distance, point[1] + dx * distance]);
  }
  const drafts = sketchCurvesFromPolyline(offsetPoints, closed, {
    tolerance: polylineSagitta(offsetPoints),
  });
  if (drafts.length === 0) return null;
  return drafts.map((draft) => ({ ...draft, construction: entity.construction }) as SketchEntityDraft);
}

function draftStart(draft: SketchEntityDraft): Point2 | null {
  switch (draft.type) {
    case 'line':
      return [draft.x1, draft.y1];
    case 'arc':
      return [
        draft.cx + Math.cos(draft.startAngle) * draft.r,
        draft.cy + Math.sin(draft.startAngle) * draft.r,
      ];
    case 'elliptical-arc': {
      const rotation = (draft.rotation * Math.PI) / 180;
      const x = Math.cos(draft.startAngle) * draft.rx;
      const y = Math.sin(draft.startAngle) * draft.ry;
      return [
        draft.cx + x * Math.cos(rotation) - y * Math.sin(rotation),
        draft.cy + x * Math.sin(rotation) + y * Math.cos(rotation),
      ];
    }
    case 'bezier':
      return draft.points[0] ?? null;
    default:
      return null;
  }
}

function draftEnd(draft: SketchEntityDraft): Point2 | null {
  switch (draft.type) {
    case 'line':
      return [draft.x2, draft.y2];
    case 'arc':
      return [
        draft.cx + Math.cos(draft.endAngle) * draft.r,
        draft.cy + Math.sin(draft.endAngle) * draft.r,
      ];
    case 'elliptical-arc': {
      const rotation = (draft.rotation * Math.PI) / 180;
      const x = Math.cos(draft.endAngle) * draft.rx;
      const y = Math.sin(draft.endAngle) * draft.ry;
      return [
        draft.cx + x * Math.cos(rotation) - y * Math.sin(rotation),
        draft.cy + x * Math.sin(rotation) + y * Math.cos(rotation),
      ];
    }
    case 'bezier':
      return draft.points[draft.points.length - 1] ?? null;
    default:
      return null;
  }
}

function setDraftStart(draft: SketchEntityDraft, point: Point2) {
  switch (draft.type) {
    case 'line':
      draft.x1 = point[0];
      draft.y1 = point[1];
      return;
    case 'arc':
      draft.startAngle = unwrapAngle(
        Math.atan2(point[1] - draft.cy, point[0] - draft.cx),
        draft.startAngle,
      );
      return;
    case 'elliptical-arc': {
      const rotation = (draft.rotation * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const dx = point[0] - draft.cx;
      const dy = point[1] - draft.cy;
      const localX = cos * dx + sin * dy;
      const localY = -sin * dx + cos * dy;
      draft.startAngle = unwrapAngle(
        Math.atan2(localY / draft.ry, localX / draft.rx),
        draft.startAngle,
      );
      return;
    }
    case 'bezier': {
      const first = draft.points[0];
      if (first) {
        first[0] = point[0];
        first[1] = point[1];
      }
      return;
    }
    default:
      return;
  }
}

function setDraftEnd(draft: SketchEntityDraft, point: Point2) {
  switch (draft.type) {
    case 'line':
      draft.x2 = point[0];
      draft.y2 = point[1];
      return;
    case 'arc':
      draft.endAngle = unwrapAngle(
        Math.atan2(point[1] - draft.cy, point[0] - draft.cx),
        draft.endAngle,
      );
      return;
    case 'elliptical-arc': {
      const rotation = (draft.rotation * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const dx = point[0] - draft.cx;
      const dy = point[1] - draft.cy;
      const localX = cos * dx + sin * dy;
      const localY = -sin * dx + cos * dy;
      draft.endAngle = unwrapAngle(
        Math.atan2(localY / draft.ry, localX / draft.rx),
        draft.endAngle,
      );
      return;
    }
    case 'bezier': {
      const last = draft.points[draft.points.length - 1];
      if (last) {
        last[0] = point[0];
        last[1] = point[1];
      }
      return;
    }
    default:
      return;
  }
}

function draftPolyline(draft: SketchEntityDraft, segments = 64): Point2[] {
  return tessellateEntity({ ...draft, id: 'draft' } as SketchEntity, segments);
}

function draftIsClosed(draft: SketchEntityDraft): boolean {
  return draft.type === 'circle' || draft.type === 'ellipse';
}

/** Crossings of two offset curves, exact for lines and arcs. */
function draftIntersections(first: SketchEntityDraft, second: SketchEntityDraft): Point2[] {
  const exact = exactCurveIntersections(
    { ...first, id: 'first' } as SketchEntity,
    { ...second, id: 'second' } as SketchEntity,
  );
  if (exact) return exact;
  const a = draftPolyline(first);
  const b = draftPolyline(second);
  const aClosed = draftIsClosed(first);
  const bClosed = draftIsClosed(second);
  const aCount = aClosed ? a.length : a.length - 1;
  const bCount = bClosed ? b.length : b.length - 1;
  const hits: Point2[] = [];
  for (let i = 0; i < aCount; i += 1) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < bCount; j += 1) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit) hits.push(hit.point);
    }
  }
  return hits;
}

function distanceBetween(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

/** Longest miter a corner may produce before it is treated as a gap. */
const MAX_MITER_FACTOR = 12;

interface Run {
  sourceId: string;
  drafts: SketchEntityDraft[];
}

function runStart(run: Run): Point2 | null {
  const first = run.drafts[0];
  return first ? draftStart(first) : null;
}

function runEnd(run: Run): Point2 | null {
  const last = run.drafts[run.drafts.length - 1];
  return last ? draftEnd(last) : null;
}

function joinArc(
  corner: Point2,
  from: Point2,
  to: Point2,
  radius: number,
  construction: boolean,
  apex: Point2 | null = null,
): SketchEntityDraft | null {
  if (radius <= 1e-6 || distanceBetween(from, to) <= 1e-9) return null;
  const startAngle = Math.atan2(from[1] - corner[1], from[0] - corner[0]);
  const endAngle = Math.atan2(to[1] - corner[1], to[0] - corner[0]);
  // A round join at a corner of a valid offset is the short way round. A long
  // arc here would wrap the joiner through the shape, which is the sign that
  // the distance itself no longer fits the chain.
  const ccwSweep = normalizeAngle(endAngle - startAngle);
  let sweep = ccwSweep > Math.PI ? ccwSweep - Math.PI * 2 : ccwSweep;
  if (apex) {
    // A cap is a half turn, and both ways are the same length: the direction of
    // travel at the chain's end says which way wraps around the tip instead of
    // curling into the shape.
    const bulge = (candidate: number): number => {
      const angle = startAngle + candidate / 2;
      return (
        Math.cos(angle) * apex[0] +
        Math.sin(angle) * apex[1]
      );
    };
    const alternative = ccwSweep - Math.PI * 2;
    sweep = bulge(ccwSweep) >= bulge(alternative) ? ccwSweep : alternative;
  }
  return {
    type: 'arc',
    construction,
    cx: corner[0],
    cy: corner[1],
    r: radius,
    startAngle,
    endAngle: startAngle + sweep,
  };
}

interface JoinResult {
  pieces: SketchEntityDraft[];
  role: 'join' | 'cap';
}

/**
 * Joins the end of one offset run to the start of the next. The pair either
 * meets at a crossing of the two offset curves (the inside of a corner), gets a
 * gap piece (the outside of a corner: an arc for round, a line or a miter point
 * for sharp), or the runs already touch.
 */
function joinRuns(
  first: Run,
  second: Run,
  corner: Point2,
  radius: number,
  join: OffsetJoin,
  construction: boolean,
  /** False when curves between the two runs were swallowed: there is no corner. */
  roundCorner = true,
): JoinResult {
  const endA = draftEnd(first.drafts[first.drafts.length - 1]!);
  const startB = draftStart(second.drafts[0]!);
  if (!endA || !startB) return { pieces: [], role: 'join' };
  const gap = distanceBetween(endA, startB);
  if (gap <= 1e-6) {
    const middle: Point2 = [(endA[0] + startB[0]) / 2, (endA[1] + startB[1]) / 2];
    setDraftEnd(first.drafts[first.drafts.length - 1]!, middle);
    setDraftStart(second.drafts[0]!, middle);
    return { pieces: [], role: 'join' };
  }

  const reach = Math.max(radius * MAX_MITER_FACTOR, 1e-3);
  const hits = draftIntersections(
    first.drafts[first.drafts.length - 1]!,
    second.drafts[0]!,
  )
    .filter((hit) => distanceBetween(hit, corner) <= reach)
    .sort((a, b) => distanceBetween(a, corner) - distanceBetween(b, corner));
  const bounded = hits[0];
  if (bounded) {
    setDraftEnd(first.drafts[first.drafts.length - 1]!, bounded);
    setDraftStart(second.drafts[0]!, bounded);
    return { pieces: [], role: 'join' };
  }

  const last = first.drafts[first.drafts.length - 1]!;
  const firstOfSecond = second.drafts[0]!;
  const support = supportCandidates(last, firstOfSecond)
    .map((point) => ({ point, distance: distanceBetween(point, corner) }))
    .filter((entry) => entry.distance <= reach)
    .sort((a, b) => a.distance - b.distance);
  const supportHit = support[0]?.point;
  if (supportHit) {
    const incoming = draftEndTangent(last);
    const outgoing = draftStartTangent(firstOfSecond);
    const aheadFirst =
      incoming &&
      (supportHit[0] - endA[0]) * incoming[0] + (supportHit[1] - endA[1]) * incoming[1] >= 0;
    const behindSecond =
      outgoing &&
      (supportHit[0] - startB[0]) * outgoing[0] + (supportHit[1] - startB[1]) * outgoing[1] <=
        0;
    // The two sides cross under their own ends: that is a sharp corner, and
    // extending the pieces to the crossing continues it. A round arc there
    // would wrap a semicircle through the shape, which reads as a stray arc.
    const sharpInside = aheadFirst === false && behindSecond === false;
    if (sharpInside || join === 'miter') {
      setDraftEnd(last, supportHit);
      setDraftStart(firstOfSecond, supportHit);
      return { pieces: [], role: 'join' };
    }
  }

  if (join === 'round' && roundCorner) {
    const arc = joinArc(corner, endA, startB, radius, construction);
    // A corner that is all but tangent leaves the two ends on one ray from the
    // corner, and an arc between them would have no length: the sketch would
    // carry a zero-sweep arc that cannot be solved. The ends meet instead, or
    // the straight join below covers a gap the arc would have covered.
    const short =
      arc && arc.type === 'arc' ? Math.abs(arc.endAngle - arc.startAngle) * radius : 0;
    if (arc && short > 1e-3) return { pieces: [arc], role: 'join' };
    if (gap <= Math.max(radius * 1e-2, 1e-3)) {
      const middle: Point2 = [(endA[0] + startB[0]) / 2, (endA[1] + startB[1]) / 2];
      setDraftEnd(last, middle);
      setDraftStart(firstOfSecond, middle);
      return { pieces: [], role: 'join' };
    }
  }

  return {
    pieces: [
      {
        type: 'line',
        construction,
        x1: endA[0],
        y1: endA[1],
        x2: startB[0],
        y2: startB[1],
      },
    ],
    role: 'join',
  };
}

/** Direction of travel at the end of a draft. */
function draftEndTangent(draft: SketchEntityDraft): Point2 | null {
  const samples = draftPolyline(draft, 16);
  const last = samples[samples.length - 1];
  const before = samples[samples.length - 2];
  if (!last || !before) return null;
  const dx = last[0] - before[0];
  const dy = last[1] - before[1];
  const length = Math.hypot(dx, dy);
  return length < 1e-12 ? null : [dx / length, dy / length];
}

/** Direction of travel at the start of a draft. */
function draftStartTangent(draft: SketchEntityDraft): Point2 | null {
  const samples = draftPolyline(draft, 16);
  const first = samples[0];
  const second = samples[1];
  if (!first || !second) return null;
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const length = Math.hypot(dx, dy);
  return length < 1e-12 ? null : [dx / length, dy / length];
}

/** Where the supports of two drafts cross, ignoring where each one ends. */
function supportCandidates(first: SketchEntityDraft, second: SketchEntityDraft): Point2[] {
  const circle = (draft: SketchEntityDraft) =>
    draft.type === 'circle' || draft.type === 'arc'
      ? { cx: draft.cx, cy: draft.cy, r: draft.r }
      : null;
  const line = (draft: SketchEntityDraft) =>
    draft.type === 'line'
      ? { x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2 }
      : null;
  const firstCircle = circle(first);
  const secondCircle = circle(second);
  const firstLine = line(first);
  const secondLine = line(second);
  if (firstLine && secondLine) {
    const hit = infiniteLineIntersection(firstLine, secondLine);
    return hit ? [hit] : [];
  }
  if (firstCircle && secondLine) {
    return lineCircleIntersections(firstCircle, secondLine, { extend: true });
  }
  if (secondCircle && firstLine) {
    return lineCircleIntersections(secondCircle, firstLine, { extend: true });
  }
  if (firstCircle && secondCircle) {
    return circleCircleIntersections(firstCircle, secondCircle);
  }
  return [];
}

function infiniteLineIntersection(
  first: { x1: number; y1: number; x2: number; y2: number },
  second: { x1: number; y1: number; x2: number; y2: number },
): Point2 | null {
  const rx = first.x2 - first.x1;
  const ry = first.y2 - first.y1;
  const sx = second.x2 - second.x1;
  const sy = second.y2 - second.y1;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((second.x1 - first.x1) * sy - (second.y1 - first.y1) * sx) / denominator;
  return [first.x1 + rx * t, first.y1 + ry * t];
}

export interface OffsetPiece {
  curve: SketchEntityDraft;
  /** The source curve this piece is an offset of; null for joins and caps. */
  sourceId: string | null;
  role: 'offset' | 'join' | 'cap';
}

export interface OffsetLoop {
  pieces: OffsetPiece[];
  /** True when the last piece meets the first one. */
  closed: boolean;
}

export type OffsetFailure = 'distance' | 'degenerate' | 'self-intersection';

export type OffsetResult =
  | { ok: true; loops: OffsetLoop[] }
  | { ok: false; reason: OffsetFailure };

export interface OffsetOptions {
  /** Signed distance: positive offsets to the left of the chain walk. */
  distance: number;
  join: OffsetJoin;
}

function constructionOf(chain: CurveChain): boolean {
  return chain.curves.every((curve) => curve.entity.construction);
}

/** Builds one offset run per curve of the chain, in walk order. */
function buildRuns(chain: CurveChain, distance: number): Run[] | null {
  const runs: Run[] = [];
  for (const curve of chain.curves) {
    const run = offsetRun(curve, distance);
    if (!run) return null;
    runs.push(run);
  }
  return runs;
}

function offsetRun(curve: OrientedCurve, distance: number): Run | null {
  const natural = curve.reversed ? -distance : distance;
  const drafts = offsetEntity(curve.entity, natural);
  if (!drafts || drafts.length === 0) return null;
  // A curve the walk travels backwards gives an offset in its own direction:
  // turning it round keeps every run starting where the walk enters it, which
  // is what the joins below assume.
  const oriented = curve.reversed ? [...drafts].reverse().map(reverseDraft) : drafts;
  return { sourceId: curve.entity.id, drafts: oriented };
}

/**
 * True when the offset of a curve folds over its own centre: an arc closer to
 * the stroke than the stroke is wide ends up on the far side of its centre.
 * Such a curve carries no boundary of the band, only a self-crossing, so a
 * stroke leaves it out and its neighbours meet across it.
 */
function foldsThroughCentre(entity: SketchEntity, distance: number): boolean {
  if (entity.type !== 'arc') return false;
  const ccw = entity.endAngle >= entity.startAngle;
  return entity.r + (ccw ? -distance : distance) < 0;
}

/**
 * The runs of one side of a stroke. A folded curve is `null`: the side skips it
 * and the neighbours are joined across it. The first and last curve of an open
 * chain are never dropped — the ends of the stroke are built from them, so a
 * fold there is an offset that does not exist and the side fails instead.
 */
function buildSideRuns(chain: CurveChain, distance: number, keepEnds: boolean): (Run | null)[] | null {
  const runs: (Run | null)[] = [];
  const last = chain.curves.length - 1;
  for (let index = 0; index < chain.curves.length; index += 1) {
    const curve = chain.curves[index]!;
    const natural = curve.reversed ? -distance : distance;
    const edge = keepEnds && (index === 0 || index === last);
    if (!edge && foldsThroughCentre(curve.entity, natural)) {
      runs.push(null);
      continue;
    }
    const run = offsetRun(curve, distance);
    if (!run) return null;
    runs.push(run);
  }
  return runs;
}

function addOffsetPieces(loop: OffsetLoop, run: Run) {
  for (const draft of run.drafts) {
    loop.pieces.push({ curve: draft, sourceId: run.sourceId, role: 'offset' });
  }
}

/**
 * The offset of a chain: one loop that follows the chain at the given distance.
 * An open chain stays open, a closed chain stays closed.
 *
 * The corner style is the one the caller asked for, at every distance. A corner
 * that cannot be rounded — the pieces cross under their own ends — is extended
 * to the crossing instead, but an offset the distance itself cannot express
 * fails with `self-intersection` rather than quietly turning every corner
 * sharp, which would be a shape the user did not ask for.
 */
export function offsetChain(chain: CurveChain, options: OffsetOptions): OffsetResult {
  const distance = options.distance;
  if (Math.abs(distance) < 1e-9) return { ok: false, reason: 'distance' };
  const runs = buildSideRuns(chain, distance, true);
  if (!runs) return { ok: false, reason: 'distance' };
  if (chain.curves.length === 1 && isLoopCurve(chain.curves[0]!.entity)) {
    const loop: OffsetLoop = { pieces: [], closed: true };
    addOffsetPieces(loop, runs[0]!);
    if (!loopIsSimple(loop)) return { ok: false, reason: 'self-intersection' };
    return { ok: true, loops: [loop] };
  }

  const kept = runs
    .map((run, index) => ({ run, index }))
    .filter((entry): entry is { run: Run; index: number } => entry.run !== null);
  if (kept.length === 0) return { ok: false, reason: 'distance' };
  const construction = constructionOf(chain);
  const loop: OffsetLoop = { pieces: [], closed: chain.closed };
  const radius = Math.abs(distance);
  for (let position = 0; position < kept.length; position += 1) {
    const entry = kept[position]!;
    addOffsetPieces(loop, entry.run);
    const isLast = position === kept.length - 1;
    if (isLast && !chain.closed) break;
    const next = kept[(position + 1) % kept.length]!;
    const corner = orientedEnd(chain.curves[entry.index]!);
    if (!corner) continue;
    const acrossGap = next.index !== (entry.index + 1) % chain.curves.length;
    const joined = joinRuns(
      entry.run,
      next.run,
      corner,
      radius,
      options.join,
      construction,
      !acrossGap,
    );
    for (const draft of joined.pieces) {
      loop.pieces.push({ curve: draft, sourceId: null, role: joined.role });
    }
  }
  if (!loopIsSimple(loop, chain.closed)) return { ok: false, reason: 'self-intersection' };
  if (chain.closed && !keepsWinding(chain, loop)) return { ok: false, reason: 'distance' };
  return { ok: true, loops: [loop] };
}

function reverseDraft(draft: SketchEntityDraft): SketchEntityDraft {
  switch (draft.type) {
    case 'line':
      return { ...draft, x1: draft.x2, y1: draft.y2, x2: draft.x1, y2: draft.y1 };
    case 'arc':
      return { ...draft, startAngle: draft.endAngle, endAngle: draft.startAngle };
    case 'elliptical-arc':
      return { ...draft, startAngle: draft.endAngle, endAngle: draft.startAngle };
    case 'bezier':
      return { ...draft, points: [...draft.points].reverse() };
    default:
      return draft;
  }
}

function capArc(
  corner: Point2,
  from: Point2,
  to: Point2,
  radius: number,
  construction: boolean,
  apex: Point2 | null,
): OffsetPiece[] {
  const arc = joinArc(corner, from, to, radius, construction, apex);
  return arc ? [{ curve: arc, sourceId: null, role: 'cap' }] : [];
}

/**
 * The outline of a chain: a closed curve that wraps it like a stroke.
 *
 * An open chain gets one loop — the two sides of the stroke joined by caps at
 * its ends. A closed chain gets two loops, the outside and the inside of the
 * stroke, which is the ring around it. The corners keep the style the caller
 * asked for: the stroke is never quietly rebuilt with sharp corners, and an
 * inside loop that cannot be built at all is left out instead of failing the
 * whole outline.
 */
export function outlineChain(chain: CurveChain, options: OffsetOptions): OffsetResult {
  const distance = Math.abs(options.distance);
  if (distance < 1e-9) return { ok: false, reason: 'distance' };
  const construction = constructionOf(chain);
  const radius = distance;

  if (chain.closed) {
    if (chain.curves.length === 1 && isLoopCurve(chain.curves[0]!.entity)) {
      const outward = buildRuns(chain, distance);
      const inward = buildRuns(chain, -distance);
      const loops: OffsetLoop[] = [];
      for (const run of [outward?.[0], inward?.[0]]) {
        if (!run) continue;
        const loop: OffsetLoop = { pieces: [], closed: true };
        addOffsetPieces(loop, run);
        loops.push(loop);
      }
      if (loops.length === 0) return { ok: false, reason: 'distance' };
      return { ok: true, loops: orderLoops(loops) };
    }
    // Either side of the stroke can run out of room on its own; the other one is
    // still the whole outline of what is left.
    const sides = [
      closedLoop(chain, distance, options.join, construction),
      closedLoop(chain, -distance, options.join, construction),
    ].filter((side): side is { ok: true; loops: OffsetLoop[] } => side.ok);
    if (sides.length === 0) {
      return closedLoop(chain, distance, options.join, construction);
    }
    return { ok: true, loops: orderLoops(sides.flatMap((side) => side.loops)) };
  }

  const left = buildSideRuns(chain, distance, true);
  const right = buildSideRuns(chain, -distance, true);
  if (!left || !right) return { ok: false, reason: 'distance' };

  // Forward along the left side, round the end, back along the right side, and
  // round the start: one closed loop whose inside is the stroke.
  const forwardSteps: SideStep[] = chain.curves.map((curve, index) => ({
    run: left[index] ?? null,
    corner: orientedEnd(curve),
  }));
  const reverseSteps: SideStep[] = [];
  for (let index = chain.curves.length - 1; index >= 0; index -= 1) {
    const run = right[index];
    reverseSteps.push({
      run: run
        ? {
            sourceId: run.sourceId,
            drafts: [...run.drafts].reverse().map(reverseDraft),
          }
        : null,
      corner: orientedStart(chain.curves[index]!),
    });
  }
  const forward = assembleSide(forwardSteps, radius, options.join, construction);
  const backward = assembleSide(reverseSteps, radius, options.join, construction);
  if (!forward.startPoint || !forward.endPoint || !backward.startPoint || !backward.endPoint) {
    return { ok: false, reason: 'degenerate' };
  }

  const loop: OffsetLoop = { pieces: [...forward.pieces], closed: true };
  const endPoint = orientedEnd(chain.curves[chain.curves.length - 1]!);
  const startPoint = orientedStart(chain.curves[0]!);
  if (!endPoint || !startPoint) return { ok: false, reason: 'degenerate' };
  loop.pieces.push(
    ...capPiece(
      endPoint,
      forward.endPoint,
      backward.startPoint,
      radius,
      options.join,
      construction,
      forward.endTangent,
    ),
  );
  loop.pieces.push(...backward.pieces);
  loop.pieces.push(
    ...capPiece(
      startPoint,
      backward.endPoint,
      forward.startPoint,
      radius,
      options.join,
      construction,
      backward.endTangent,
    ),
  );
  if (!loopIsSimple(loop)) return { ok: false, reason: 'self-intersection' };
  return { ok: true, loops: [loop] };
}

/** The loops of a stroke: the outside first, so a caller has no doubt which is which. */
function orderLoops(loops: OffsetLoop[]): OffsetLoop[] {
  return [...loops].sort((first, second) => Math.abs(loopArea(second)) - Math.abs(loopArea(first)));
}

/** Signed area of the polygon a loop follows. */
function loopArea(loop: OffsetLoop): number {
  const points: Point2[] = [];
  for (const piece of loop.pieces) {
    for (const point of tessellateEntity({ ...piece.curve, id: 'piece' } as SketchEntity, 12)) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-9) continue;
      points.push(point);
    }
  }
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** Signed area of the chain the offsets follow. */
function chainArea(chain: CurveChain): number {
  const points = chainPolyline(chain);
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * A valid offset keeps the walk of the chain. When the distance is larger than
 * the space a closed chain leaves, the offset folds through itself and comes
 * back with the opposite walk: that shape is refused instead of drawn.
 */
function keepsWinding(chain: CurveChain, loop: OffsetLoop): boolean {
  const source = Math.sign(chainArea(chain));
  const offset = Math.sign(loopArea(loop));
  return source === 0 || offset === 0 || source === offset;
}

interface SideStep {
  /** The run of this curve, or null when the stroke folds through it. */
  run: Run | null;
  /** The source corner the run ends at, or null when it is the last one. */
  corner: Point2 | null;
}

interface Side {
  pieces: OffsetPiece[];
  startPoint: Point2 | null;
  endPoint: Point2 | null;
  /** Direction of travel where the side ends; it tells a cap which way to bulge. */
  endTangent: Point2 | null;
}

/**
 * Joins the runs of one side of an outline in the order the loop walks them.
 * The pieces are the very drafts the joins trim, so the stored geometry and the
 * joined geometry cannot drift apart.
 */
function assembleSide(
  steps: SideStep[],
  radius: number,
  join: OffsetJoin,
  construction: boolean,
): Side {
  const side: Side = { pieces: [], startPoint: null, endPoint: null, endTangent: null };
  const kept = steps.filter((step) => step.run);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const run = step.run;
    if (run) {
      for (const draft of run.drafts) {
        side.pieces.push({ curve: draft, sourceId: run.sourceId, role: 'offset' });
      }
    }
    if (!run) continue;
    // The next run may be a few curves away: the stroke swallowed the ones in
    // between, so the join spans the gap rather than wrapping a corner no
    // boundary of the band follows.
    let ahead = index + 1;
    while (ahead < steps.length && !steps[ahead]!.run) ahead += 1;
    const next = steps[ahead]?.run;
    if (!next || !step.corner) continue;
    // The next kept run may be a few curves away: the stroke swallowed the ones
    // in between, so there is no corner left to round there.
    const joined = joinRuns(run, next, step.corner, radius, join, construction, ahead === index + 1);
    for (const draft of joined.pieces) {
      side.pieces.push({ curve: draft, sourceId: null, role: 'join' });
    }
  }
  // A join trims the draft it meets, so the ends are read once every join has
  // been made.
  const firstRun = kept[0]?.run ?? null;
  const lastRun = kept[kept.length - 1]?.run ?? null;
  side.startPoint = firstRun ? runStart(firstRun) : null;
  side.endPoint = lastRun ? runEnd(lastRun) : null;
  const lastDraft = lastRun?.drafts[lastRun.drafts.length - 1];
  side.endTangent = lastDraft ? draftEndTangent(lastDraft) : null;
  return side;
}

/** Joins the two sides of a stroke at one of its ends. */
function capPiece(
  corner: Point2,
  from: Point2,
  to: Point2,
  radius: number,
  join: OffsetJoin,
  construction: boolean,
  apex: Point2 | null,
): OffsetPiece[] {
  if (join === 'round') return capArc(corner, from, to, radius, construction, apex);
  return [
    {
      curve: {
        type: 'line',
        construction,
        x1: from[0],
        y1: from[1],
        x2: to[0],
        y2: to[1],
      },
      sourceId: null,
      role: 'cap',
    },
  ];
}

function closedLoop(
  chain: CurveChain,
  distance: number,
  join: OffsetJoin,
  construction: boolean,
): OffsetResult {
  const runs = buildSideRuns(chain, distance, false);
  if (!runs) return { ok: false, reason: 'distance' };
  const kept = runs
    .map((run, index) => ({ run, index }))
    .filter((entry): entry is { run: Run; index: number } => entry.run !== null);
  if (kept.length === 0) return { ok: false, reason: 'distance' };
  const loop: OffsetLoop = { pieces: [], closed: true };
  const radius = Math.abs(distance);
  for (let position = 0; position < kept.length; position += 1) {
    const entry = kept[position]!;
    addOffsetPieces(loop, entry.run);
    const next = kept[(position + 1) % kept.length]!;
    const corner = orientedEnd(chain.curves[entry.index]!);
    if (!corner) continue;
    const acrossGap = next.index !== (entry.index + 1) % chain.curves.length;
    const joined = joinRuns(entry.run, next.run, corner, radius, join, construction, !acrossGap);
    for (const draft of joined.pieces) {
      loop.pieces.push({ curve: draft, sourceId: null, role: joined.role });
    }
  }
  if (!loopIsSimple(loop)) return { ok: false, reason: 'self-intersection' };
  if (!keepsWinding(chain, loop)) return { ok: false, reason: 'distance' };
  return { ok: true, loops: [loop] };
}

/**
 * A loop is simple when it does not cross itself. An offset that is too large
 * for a slot folds the geometry inside out, and a fitting answer is to refuse
 * the operation rather than to leave a shape the user did not ask for.
 */
export function loopIsSimple(loop: OffsetLoop, closed = true): boolean {
  const points: Point2[] = [];
  for (const piece of loop.pieces) {
    const samples = tessellateEntity({ ...piece.curve, id: 'piece' } as SketchEntity, 24);
    for (const point of samples) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-9) continue;
      points.push(point);
    }
  }
  // A loop that ends where it started must not count its closing point twice:
  // the ring is closed by adjacency, not by a repeated sample.
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) points.pop();
  if (points.length < 2) return false;
  // Most pairs of a loop are far apart, so the boxes answer before the exact
  // test does: a contour of a long chain is otherwise a quadratic number of
  // segment tests on every pointer move.
  const boxes: Box[] = [];
  for (let index = 0; index < points.length; index += 1) {
    boxes.push(segmentBox(points[index]!, points[(index + 1) % points.length]!));
  }
  if (!closed) {
    const segments = points.length - 1;
    for (let i = 0; i < segments; i += 1) {
      const a1 = points[i]!;
      const a2 = points[i + 1]!;
      const box = boxes[i]!;
      for (let j = i + 2; j < segments; j += 1) {
        if (!boxesMeet(box, boxes[j]!)) continue;
        const b1 = points[j]!;
        const b2 = points[j + 1]!;
        if (segmentIntersection(a1, a2, b1, b2)) return false;
      }
    }
    return true;
  }
  if (points.length < 4) return false;
  // The last point closes the ring back to the first, so every segment is
  // tested against all the others except its two neighbours.
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % count]!;
    const box = boxes[i]!;
    for (let step = 2; step < count - 1; step += 1) {
      const j = (i + step) % count;
      if (!boxesMeet(box, boxes[j]!)) continue;
      const b1 = points[j]!;
      const b2 = points[(j + 1) % count]!;
      if (segmentIntersection(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function segmentBox(first: Point2, second: Point2): Box {
  return {
    x1: Math.min(first[0], second[0]),
    y1: Math.min(first[1], second[1]),
    x2: Math.max(first[0], second[0]),
    y2: Math.max(first[1], second[1]),
  };
}

/** Boxes grown by a hair, so a touch on a box edge still reaches the exact test. */
function boxesMeet(first: Box, second: Box): boolean {
  const slack = 1e-9;
  return (
    first.x1 <= second.x2 + slack &&
    second.x1 <= first.x2 + slack &&
    first.y1 <= second.y2 + slack &&
    second.y1 <= first.y2 + slack
  );
}
