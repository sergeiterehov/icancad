import { createId, type SketchConstraint, type SketchFeature, type SketchEntity } from '@icancad/model';
import {
  curveCrossings,
  curveIntervals,
  curveParameterAt,
  curvePointAt,
  entityControlPoints,
  entityEndpoints,
  intervalDistance,
  isFundamentalEntityId,
  isWholeCurve,
  sketchEntityIndex,
  trimPiece,
  type TrimFailure,
} from '@icancad/sketch';
import { uniqueConstraints } from './constraintModel';
import { projectionEntityIds } from './projection';

/**
 * Вырез: what the pointer cuts, what is left, and how the relations of the cut
 * curve follow the pieces.
 *
 * The geometry is `@icancad/sketch`; this module decides which curve the pointer
 * is on, which of its pieces goes, and what happens to the constraints that
 * named the curve it took apart.
 */

export type { TrimFailure };

/** A piece of a curve that stays, and which end of the source it carries. */
export interface TrimPiecePlan {
  entity: SketchEntity;
  /** The piece that keeps the source's own id. */
  keepsId: boolean;
}

export interface TrimCut {
  source: SketchEntity;
  /** The piece that goes, from its start to its end along the curve. */
  removed: SketchEntity;
  /** Empty when the whole curve goes. */
  kept: TrimPiecePlan[];
  /** The pointer asked for the curve itself, not for a piece of it. */
  whole: boolean;
}

export interface TrimPlan {
  cut: TrimCut;
}

export type TrimPlanResult = { ok: true; plan: TrimPlan } | { ok: false; error: TrimFailure };

const CURVE_TYPES = new Set(['line', 'arc', 'circle', 'ellipse', 'elliptical-arc']);

/** What the tool reads besides the curve under the pointer. */
export interface TrimOptions {
  /** Construction curves take part too: they are cut, and they cut. */
  construction?: boolean;
}

/**
 * The curves the tool may cut. Points, axes and the projected curves of a body
 * are left out — a projection is derived on every rebuild, so a cut in one would
 * not survive. Construction curves are helpers and stand aside unless they are
 * asked for, so a helper drawn across a part does not turn every cut into a cut
 * on it.
 */
export function trimTargets(feature: SketchFeature, options: TrimOptions = {}): SketchEntity[] {
  const derived = new Set(projectionEntityIds(feature));
  return feature.entities.filter(
    (entity) =>
      CURVE_TYPES.has(entity.type) &&
      !derived.has(entity.id) &&
      !isFundamentalEntityId(entity.id) &&
      (options.construction || !entity.construction),
  );
}

/**
 * What the pointer asks to cut: the piece of the nearest curve it stands over.
 * A curve that nothing crosses is one piece — itself — and the pointer removes
 * it whole; a closed curve that only one curve crosses is in the same place.
 */
export function planTrim(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: TrimOptions = {},
): TrimPlanResult {
  const targets = trimTargets(feature, options);
  if (targets.length === 0) return { ok: false, error: 'selection' };
  const at = [pointer[0], pointer[1]] as [number, number];

  // Only the curve under the pointer is cut, so only its crossings are looked
  // for: this runs on every pointer move, and the crossings of a whole sketch
  // would cost more than the plan is worth.
  let source = targets[0]!;
  let closest = Infinity;
  for (const candidate of targets) {
    const distance = curveNearDistance(candidate, at);
    if (distance < closest) {
      closest = distance;
      source = candidate;
    }
  }

  const others = feature.entities.filter(
    (entity) =>
      entity.id !== source.id && (options.construction || !entity.construction),
  );
  const intervals = curveIntervals(source, curveCrossings(source, others));
  if ('error' in intervals) return { ok: false, error: intervals.error };

  let piece: [number, number] | null = null;
  let gap = Infinity;
  for (const interval of intervals.intervals) {
    const distance = intervalDistance(source, interval, at);
    if (distance < gap) {
      gap = distance;
      piece = interval;
    }
  }
  if (!piece) return { ok: false, error: 'piece' };
  const whole = isWholeCurve(piece);
  const removed = trimPiece(source, piece[0], piece[1]);
  if (!removed) return { ok: false, error: 'piece' };

  const kept: TrimPiecePlan[] = [];
  if (!whole) {
    let assigned = false;
    for (const [start, end] of intervals.intervals) {
      if (start === piece[0] && end === piece[1]) continue;
      const keptPiece = trimPiece(source, start, end);
      if (!keptPiece) continue;
      // The piece that carries the curve's own start keeps the id, so the
      // relations of the curve keep naming a curve that still exists.
      const keepsId = !assigned && start <= intervals.from + 1e-9;
      if (keepsId) assigned = true;
      kept.push({ entity: keptPiece, keepsId });
    }
    if (!assigned && kept.length > 0) kept[0] = { ...kept[0]!, keepsId: true };
  }
  return { ok: true, plan: { cut: { source, removed, kept, whole } } };
}

/** How far the nearest point of a curve stands from the pointer, coarsely. */
function curveNearDistance(entity: SketchEntity, pointer: [number, number]): number {
  let best = Infinity;
  for (let index = 0; index <= 24; index += 1) {
    const point = curvePointAt(entity, index / 24);
    if (!point) continue;
    best = Math.min(best, Math.hypot(point[0] - pointer[0], point[1] - pointer[1]));
  }
  return best;
}

/** The preview: the pieces that stay, standing where the cut leaves them. */
export function trimPreviewEntities(plan: TrimPlan): SketchEntity[] {
  return plan.cut.kept.map((piece) => ({ ...piece.entity, id: `${piece.entity.id}#kept` }));
}

export interface TrimCommit {
  feature: SketchFeature;
  /** The pieces that replaced the cut curve; empty when the curve went whole. */
  keptIds: string[];
  /** Relations that had to go because the point they named was cut away. */
  removedConstraintIds: string[];
  /** Joints made where the cut left a piece standing on other geometry. */
  addedConstraintIds: string[];
}

export type TrimCommitResult =
  | { ok: true; commit: TrimCommit }
  | { ok: false; error: TrimFailure };

/**
 * The feature after the cut: the curve replaced by the pieces that are left, the
 * constraints that named it following those pieces — a relation on an end the
 * cut did not touch moves to the piece that still carries that end, and a
 * relation on a point that is gone goes with it — and a joint wherever the new
 * end of a piece lands on a point the sketch already has.
 */
export async function commitTrim(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: TrimOptions = {},
): Promise<TrimCommitResult> {
  const planned = planTrim(feature, pointer, options);
  if (!planned.ok) return planned;
  const { cut } = planned.plan;

  const assigned = cut.kept.map((piece) => ({
    entity: piece.keepsId ? piece.entity : { ...piece.entity, id: createId('entity') },
    keepsId: piece.keepsId,
  }));
  const entities: SketchEntity[] = [];
  for (const entity of feature.entities) {
    if (entity.id !== cut.source.id) {
      entities.push(entity);
      continue;
    }
    for (const piece of assigned) entities.push(piece.entity);
  }
  const keptIds = assigned.map((piece) => piece.entity.id);

  const removed: string[] = [];
  const constraints: SketchConstraint[] = [];
  for (const constraint of feature.constraints) {
    let broken = false;
    const refs = constraint.refs.map((ref) => {
      if (ref.entityId !== cut.source.id) return ref;
      // A relation on the curve as a whole goes when the curve does.
      if (assigned.length === 0 || ref.pointIndex === undefined) {
        if (assigned.length === 0) broken = true;
        return ref;
      }
      const point = entityControlPoints(cut.source)[ref.pointIndex];
      if (!point) return ref;
      for (const piece of assigned) {
        const index = pointIndexOf(piece.entity, point);
        if (index >= 0) return { ...ref, entityId: piece.entity.id, pointIndex: index };
      }
      broken = true;
      return ref;
    });
    if (broken) {
      removed.push(constraint.id);
      continue;
    }
    constraints.push({ ...constraint, refs } as SketchConstraint);
  }

  // A piece that ends where the cut met another curve leaves its end on that
  // curve. Where the sketch already has a point there — the end of another cut,
  // a joint — the two are the same point and a joint says so; where the curve
  // only passes through, the point is held on the curve instead.
  const added: SketchConstraint[] = [];
  const sourceEnds = entityEndpoints(cut.source) ?? [];
  const others = entities.filter((entity) => entity.id !== cut.source.id);
  const same = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  for (const piece of assigned) {
    for (const point of entityEndpoints(piece.entity) ?? []) {
      // An end the cut created, not an end the curve already had.
      if (sourceEnds.some((end) => same(end, point))) continue;
      const index = pointIndexOf(piece.entity, point);
      if (index < 0) continue;
      const pieceRef = { entityId: piece.entity.id, pointIndex: index };
      const near = others
        .filter((other) => other.id !== piece.entity.id)
        .map((other) => ({ other, at: pointIndexOf(other, point) }));
      const joint = near.find((candidate) => candidate.at >= 0);
      if (joint) {
        added.push({
          id: createId('con'),
          type: 'coincident',
          auto: true,
          refs: [pieceRef, { entityId: joint.other.id, pointIndex: joint.at }],
        } as SketchConstraint);
        continue;
      }
      // Nothing of the sketch has a point there, so the cut end is held on the
      // curves that run through it: the point the cut made is their crossing.
      for (const { other } of near) {
        const type = pointOnCurveType(other);
        if (!type) continue;
        if (!pointLiesOn(other, point)) continue;
        added.push({
          id: createId('con'),
          type,
          auto: true,
          refs: [pieceRef, { entityId: other.id }],
        } as SketchConstraint);
      }
    }
  }
  const unique = uniqueConstraints(added, constraints, sketchEntityIndex(entities));

  const next: SketchFeature = { ...feature, entities, constraints: [...constraints, ...unique] };
  // Nothing is solved here: a cut takes geometry away and adds nothing, so the
  // pieces are exact pieces of the curves the sketch already held. Solving would
  // only let an under-constrained sketch move something the user did not ask it
  // to move.
  return {
    ok: true,
    commit: {
      feature: next,
      keptIds,
      removedConstraintIds: removed,
      addedConstraintIds: unique.map((constraint) => constraint.id),
    },
  };
}

/** The relation that holds a point on a curve, or null for a curve without one. */
function pointOnCurveType(
  entity: SketchEntity,
): 'point-on-line' | 'point-on-circle' | 'point-on-ellipse' | null {
  switch (entity.type) {
    case 'line':
      return 'point-on-line';
    case 'circle':
    case 'arc':
      return 'point-on-circle';
    case 'ellipse':
    case 'elliptical-arc':
      return 'point-on-ellipse';
    default:
      return null;
  }
}

/** True when a point sits on a curve, inside its own sweep. */
function pointLiesOn(entity: SketchEntity, point: readonly [number, number]): boolean {
  const parameter = curveParameterAt(entity, [point[0], point[1]]);
  if (parameter === null || parameter < -1e-9 || parameter > 1 + 1e-9) return false;
  const at = curvePointAt(entity, Math.min(1, Math.max(0, parameter)));
  return Boolean(at) && Math.hypot(at![0] - point[0], at![1] - point[1]) <= 1e-6;
}

/** The index of a point among the control points of an entity, or -1. */
function pointIndexOf(entity: SketchEntity, point: readonly [number, number]): number {
  return entityControlPoints(entity).findIndex(
    (candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= 1e-6,
  );
}
