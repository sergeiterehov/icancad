import { createId, type SketchConstraint, type SketchFeature, type SketchEntity } from '@icancad/model';
import {
  curveCrossings,
  curveIntervals,
  curvePointAt,
  entityControlPoints,
  intervalDistance,
  isFundamentalEntityId,
  trimPiece,
  type TrimFailure,
} from '@icancad/sketch';
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
  kept: TrimPiecePlan[];
}

export interface TrimPlan {
  cut: TrimCut;
}

export type TrimPlanResult = { ok: true; plan: TrimPlan } | { ok: false; error: TrimFailure };

const CURVE_TYPES = new Set(['line', 'arc', 'circle', 'ellipse', 'elliptical-arc']);

/**
 * The curves the tool may cut: the selection when there is one, the whole sketch
 * otherwise. Points, axes, construction helpers that are not curves and the
 * projected curves of a body are left out — a projection is derived on every
 * rebuild, so a cut in one would not survive.
 */
export function trimTargets(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): SketchEntity[] {
  const derived = new Set(projectionEntityIds(feature));
  const usable = feature.entities.filter(
    (entity) =>
      CURVE_TYPES.has(entity.type) && !derived.has(entity.id) && !isFundamentalEntityId(entity.id),
  );
  const picked = new Set(
    selectionKeys
      .map((key) => key.split('#')[0] ?? '')
      .filter((id) => id.length > 0 && !isFundamentalEntityId(id)),
  );
  if (picked.size === 0) return usable;
  const selected = usable.filter((entity) => picked.has(entity.id));
  return selected.length > 0 ? selected : usable;
}

/**
 * What the pointer asks to cut: the piece of the nearest curve it stands over.
 * A curve that nothing crosses has one piece — itself — and that is a delete,
 * not a cut, so it is refused instead of silently removing the curve.
 */
export function planTrim(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
): TrimPlanResult {
  const targets = trimTargets(feature, selectionKeys);
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

  const others = feature.entities.filter((entity) => entity.id !== source.id);
  const intervals = curveIntervals(source, curveCrossings(source, others));
  if ('error' in intervals) return { ok: false, error: intervals.error };

  let piece: [number, number] | null = null;
  let gap = Infinity;
  for (const interval of intervals.intervals) {
    if (interval[1] - interval[0] >= 1 - 1e-9) continue;
    const distance = intervalDistance(source, interval, at);
    if (distance < gap) {
      gap = distance;
      piece = interval;
    }
  }
  const removed = piece ? trimPiece(source, piece[0], piece[1]) : null;
  if (!piece || !removed) return { ok: false, error: 'piece' };

  const kept: TrimPiecePlan[] = [];
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
  if (kept.length === 0) return { ok: false, error: 'piece' };
  if (!assigned) kept[0] = { ...kept[0]!, keepsId: true };
  return { ok: true, plan: { cut: { source, removed, kept } } };
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
  /** The pieces that replaced the cut curve. */
  keptIds: string[];
  /** Relations that had to go because the point they named was cut away. */
  removedConstraintIds: string[];
}

export type TrimCommitResult =
  | { ok: true; commit: TrimCommit }
  | { ok: false; error: TrimFailure };

/**
 * The feature after the cut: the curve replaced by the pieces that are left, and
 * the constraints that named it following those pieces — a relation on the end
 * the cut did not touch moves to the piece that still carries that end, and a
 * relation on a point that is gone goes with it.
 */
export async function commitTrim(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
): Promise<TrimCommitResult> {
  const planned = planTrim(feature, selectionKeys, pointer);
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
      if (ref.pointIndex === undefined) return ref;
      const point = entityControlPoints(cut.source)[ref.pointIndex];
      if (!point) return ref;
      for (const piece of assigned) {
        const index = entityControlPoints(piece.entity).findIndex(
          (candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= 1e-6,
        );
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

  const next: SketchFeature = { ...feature, entities, constraints };
  // Nothing is solved here: a cut takes geometry away and adds nothing, so the
  // pieces are exact pieces of the curves the sketch already held. Solving would
  // only let an under-constrained sketch move something the user did not ask it
  // to move.
  return {
    ok: true,
    commit: { feature: next, keptIds, removedConstraintIds: removed },
  };
}
