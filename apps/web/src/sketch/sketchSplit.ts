import { createId, type SketchConstraint, type SketchFeature, type SketchEntity } from '@icancad/model';
import {
  curvePointAt,
  entityControlPoints,
  entityEndpoints,
  isFundamentalEntityId,
  sketchEntityIndex,
  trimPiece,
  type Point2,
  type TrimFailure,
} from '@icancad/sketch';
import { uniqueConstraints } from './constraintModel';
import { projectionEntityIds } from './projection';

/**
 * Разделение: adding a point to a curve, so one curve becomes two that meet
 * there.
 *
 * The pieces are exact pieces of the curve the sketch already holds — the same
 * machinery the trim uses — and the new point is a joint between them: a
 * coincident, which is what makes it one point rather than two that happen to
 * touch.
 */

export type SplitFailure = TrimFailure | 'end';

/** A piece of a curve, and where its two ends are. */
export interface SplitPiecePlan {
  entity: SketchEntity;
  keepsId: boolean;
}

export interface SplitPlan {
  source: SketchEntity;
  /** Where the point goes, along the curve and in the sketch. */
  at: { parameter: number; point: Point2 };
  first: SplitPiecePlan;
  second: SplitPiecePlan;
  /** The joint between the pieces; a closed curve has two, one at its seam. */
  joints: Array<{ firstIndex: number; secondIndex: number }>;
  /** What keeps the pieces on the curve they came from, e.g. their centres. */
  ties: SketchConstraint[];
}

export type SplitPlanResult = { ok: true; plan: SplitPlan } | { ok: false; error: SplitFailure };

/** What the tool reads besides the pointer. */
export interface SplitOptions {
  /** Construction curves take part too. */
  construction?: boolean;
}

const CURVE_TYPES = new Set(['line', 'arc', 'circle', 'ellipse', 'elliptical-arc']);
/** A point this close to an end would make a piece of no length. */
const END_EPSILON = 1e-3;

/**
 * The curves the tool may split. As with the scissors, construction curves are
 * helpers and stand aside unless Shift asks for them, and projected curves are
 * derived on every rebuild, so a point put in one would not survive.
 */
export function splitTargets(feature: SketchFeature, options: SplitOptions = {}): SketchEntity[] {
  const derived = new Set(projectionEntityIds(feature));
  return feature.entities.filter(
    (entity) =>
      CURVE_TYPES.has(entity.type) &&
      !derived.has(entity.id) &&
      !isFundamentalEntityId(entity.id) &&
      (options.construction || !entity.construction),
  );
}

/** The nearest point of a curve to the pointer, refined past the first samples. */
function nearestOnCurve(
  entity: SketchEntity,
  pointer: [number, number],
): { parameter: number; point: Point2; distance: number } | null {
  const measure = (parameter: number) => {
    const point = curvePointAt(entity, parameter);
    if (!point) return null;
    return { parameter, point, distance: Math.hypot(point[0] - pointer[0], point[1] - pointer[1]) };
  };
  let best: { parameter: number; point: Point2; distance: number } | null = null;
  const samples = 48;
  for (let index = 0; index <= samples; index += 1) {
    const sample = measure(index / samples);
    if (sample && (!best || sample.distance < best.distance)) best = sample;
  }
  if (!best) return null;
  let step = 1 / samples;
  for (let round = 0; round < 5; round += 1) {
    step /= 4;
    for (let index = -4; index <= 4; index += 1) {
      const parameter = Math.min(1, Math.max(0, best.parameter + step * index));
      const sample = measure(parameter);
      if (sample && sample.distance < best.distance) best = sample;
    }
  }
  return best;
}

/**
 * What the pointer asks for: the curve it stands on, split where it stands. A
 * point that lands on an end of the curve is refused — the two pieces would be
 * the curve and nothing.
 */
export function planSplit(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: SplitOptions = {},
): SplitPlanResult {
  const targets = splitTargets(feature, options);
  if (targets.length === 0) return { ok: false, error: 'selection' };
  const at: [number, number] = [pointer[0], pointer[1]];

  let nearest: { source: SketchEntity; parameter: number; point: Point2; distance: number } | null =
    null;
  for (const candidate of targets) {
    const on = nearestOnCurve(candidate, at);
    if (!on) continue;
    if (!nearest || on.distance < nearest.distance) {
      nearest = { source: candidate, ...on };
    }
  }
  if (!nearest) return { ok: false, error: 'unsupported' };
  const parameter = nearest.parameter;
  if (parameter <= END_EPSILON || parameter >= 1 - END_EPSILON) return { ok: false, error: 'end' };

  const first = trimPiece(nearest.source, 0, parameter);
  const second = trimPiece(nearest.source, parameter, 1);
  if (!first || !second) return { ok: false, error: 'piece' };

  const joints: SplitPlan['joints'] = [];
  const firstEnds = entityEndpoints(first) ?? [];
  const secondEnds = entityEndpoints(second) ?? [];
  const same = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  // Every place the two pieces meet is a joint: the point that was added, and —
  // on a closed curve — the seam the curve already had. The indices are the ones
  // a constraint names, which are not the ends' own order: an arc's points are
  // its centre, then its start and its end.
  for (const end of firstEnds) {
    const other = secondEnds.findIndex((candidate) => same(candidate, end));
    if (other < 0) continue;
    const index = pointIndexAt(first, end);
    const secondIndex = pointIndexAt(second, secondEnds[other]!);
    if (index < 0 || secondIndex < 0) continue;
    joints.push({ firstIndex: index, secondIndex });
  }
  if (joints.length === 0) return { ok: false, error: 'piece' };

  // Both pieces come from one curve and so carry its id; the second one gets a
  // marker of its own, so a relation written in the plan can say which piece it
  // means. The commit gives it a real id.
  const marked: SketchEntity = { ...second, id: `${nearest.source.id}#second` };
  return {
    ok: true,
    plan: {
      source: nearest.source,
      at: { parameter, point: nearest.point },
      first: { entity: first, keepsId: true },
      second: { entity: marked, keepsId: false },
      joints,
      ties: curveTies(first, marked),
    },
  };
}

/**
 * What makes the pieces one curve rather than two that touch: a line needs
 * nothing, an arc needs the same centre and the same radius, an ellipse the same
 * centre and the same two axes, and a circle — which becomes two arcs — the same
 * again, with its seam joined by the joints.
 */
function curveTies(first: SketchEntity, second: SketchEntity): SketchConstraint[] {
  const ties: SketchConstraint[] = [];
  const coincident = (a: number, b: number) =>
    ties.push({
      id: createId('con'),
      type: 'coincident',
      auto: true,
      refs: [
        { entityId: first.id, pointIndex: a },
        { entityId: second.id, pointIndex: b },
      ],
    } as SketchConstraint);
  const pair = first.type === 'arc' || first.type === 'elliptical-arc';
  if (!pair || first.type !== second.type) return ties;
  // Both pieces have a centre, and an ellipse's axes are points of its own, so
  // the same centre and the same axes is the same ellipse.
  coincident(0, 0);
  if (first.type === 'arc') {
    ties.push({
      id: createId('con'),
      type: 'equal',
      auto: true,
      refs: [{ entityId: first.id }, { entityId: second.id }],
    } as SketchConstraint);
  } else {
    coincident(1, 1);
    coincident(2, 2);
  }
  return ties;
}

function pointIndexAt(entity: SketchEntity, point: Point2): number {
  return entityControlPoints(entity).findIndex(
    (candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= 1e-6,
  );
}

/** The preview: the two pieces the curve will be, and nothing else. */
export function splitPreviewEntities(plan: SplitPlan): SketchEntity[] {
  return [plan.first.entity, plan.second.entity];
}

export interface SplitCommit {
  feature: SketchFeature;
  /** The two pieces; the first keeps the curve's id. */
  keptIds: string[];
  addedConstraintIds: string[];
  removedConstraintIds: string[];
}

export type SplitCommitResult =
  | { ok: true; commit: SplitCommit }
  | { ok: false; error: SplitFailure };

/**
 * The feature after the split: the curve replaced by its two pieces, the
 * relations that named it following them, and a joint where the new point is.
 */
export async function commitSplit(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: SplitOptions = {},
): Promise<SplitCommitResult> {
  const planned = planSplit(feature, pointer, options);
  if (!planned.ok) return { ok: false, error: planned.error };
  const { plan } = planned;
  const second = { ...plan.second.entity, id: createId('entity') };
  const pieces = [plan.first.entity, second];

  const entities: SketchEntity[] = [];
  for (const entity of feature.entities) {
    if (entity.id !== plan.source.id) entities.push(entity);
    else entities.push(...pieces);
  }
  const keptIds = pieces.map((piece) => piece.id);

  // Relations on a point move to the piece that carries that point; relations
  // on the curve as a whole stay with the piece that kept its id.
  const removed: string[] = [];
  const constraints: SketchConstraint[] = [];
  for (const constraint of feature.constraints) {
    let broken = false;
    const refs = constraint.refs.map((ref) => {
      if (ref.entityId !== plan.source.id) return ref;
      if (ref.pointIndex === undefined) return ref;
      const point = entityControlPoints(plan.source)[ref.pointIndex];
      if (!point) return ref;
      for (const piece of pieces) {
        const index = pointIndexAt(piece, point);
        if (index >= 0) return { ...ref, entityId: piece.id, pointIndex: index };
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

  const added: SketchConstraint[] = plan.joints.map(
    (joint) =>
      ({
        id: createId('con'),
        type: 'coincident',
        auto: true,
        refs: [
          { entityId: pieces[0]!.id, pointIndex: joint.firstIndex },
          { entityId: pieces[1]!.id, pointIndex: joint.secondIndex },
        ],
      }) as SketchConstraint,
  );
  // The ties name the pieces, and the second one only gets its id now.
  for (const tie of plan.ties) {
    added.push({
      ...tie,
      refs: tie.refs.map((ref) =>
        ref.entityId === plan.second.entity.id ? { ...ref, entityId: pieces[1]!.id } : ref,
      ),
    } as SketchConstraint);
  }
  const unique = uniqueConstraints(added, constraints, sketchEntityIndex(entities));

  const next: SketchFeature = { ...feature, entities, constraints: [...constraints, ...unique] };
  // Nothing is solved: a split adds no geometry, only a point already on the
  // curve, so the pieces are exact and the sketch must not move.
  return {
    ok: true,
    commit: {
      feature: next,
      keptIds,
      addedConstraintIds: unique.map((constraint) => constraint.id),
      removedConstraintIds: removed,
    },
  };
}
