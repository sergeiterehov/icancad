import {
  createId,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  curveCrossingSources,
  curveEndIndices,
  curveParameterAt,
  curvePointAt,
  entityControlPoints,
  extendCurve,
  isFundamentalEntityId,
  sketchEntityIndex,
  type ExtendFailure as ExtendShapeFailure,
  type ExtendShape,
  type Point2,
} from '@icancad/sketch';
import { pointOnCurveType, uniqueConstraints } from './constraintModel';
import { projectionEntityIds } from './projection';

/**
 * Продление: the tool around `extendCurve`. The geometry stretches one end along
 * the curve's own course; this module decides which curve the gesture took hold
 * of, what stops the stretch, and what happens to the relations that named the
 * end it moved.
 */

export type ExtendFailure = ExtendShapeFailure | 'selection';

/** A point of other geometry the new end lands on. */
export interface ExtendLandingPoint {
  entityId: string;
  pointIndex: number;
}

/** What the new end meets, and so what holds it there. */
export interface ExtendLanding {
  /** A point of the sketch stands exactly at the new end: a joint says so. */
  points: ExtendLandingPoint[];
  /** No point is there, so the curves the end lands on hold it instead. */
  curveIds: string[];
}

export interface ExtendPlan {
  source: SketchEntity;
  /** The curve stretched: the preview is this in place of the source. */
  entity: SketchEntity;
  /** The end that grows. */
  end: 'start' | 'end';
  /** The control-point index of that end, which is what a relation names. */
  endIndex: number;
  /** Where the end stood, and where it stands now. */
  from: Point2;
  to: Point2;
  landing: ExtendLanding;
}

export type ExtendPlanResult = { ok: true; plan: ExtendPlan } | { ok: false; error: ExtendFailure };

/** What the tool reads besides the pointer. */
export interface ExtendOptions {
  /** Construction curves take part too. */
  construction?: boolean;
  /**
   * The curve the gesture took hold of, and the end it took: a stretch begins on
   * the geometry, so the press decides what grows and the pointer only says how
   * far.
   */
  grip?: { entityId: string; end: 'start' | 'end' };
  /**
   * The curve the pointer is on — the magnet's target. The stretch lands on it
   * rather than wherever the pointer stands, so the end meets it exactly.
   */
  snapTo?: string;
}

const CURVE_TYPES = new Set(['line', 'arc', 'elliptical-arc']);

/**
 * The curves the tool may stretch. A closed curve has no end to grow, and a
 * Bezier would have to give up its control points to grow at all — both stand
 * aside. Construction curves are helpers and are left out unless Shift asks for
 * them, as with the scissors and the split.
 */
export function extendTargets(feature: SketchFeature, options: ExtendOptions = {}): SketchEntity[] {
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
 * What the pointer asks for: the curve it took hold of, stretched to where the
 * pointer stands — or, without a grip, the nearest end whose own course runs
 * under the pointer.
 */
export function planExtend(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: ExtendOptions = {},
): ExtendPlanResult {
  const targets = extendTargets(feature, options);
  if (targets.length === 0) return { ok: false, error: 'selection' };
  const at: Point2 = [pointer[0], pointer[1]];
  const grip = options.grip;
  const pool = grip ? targets.filter((target) => target.id === grip.entityId) : targets;
  if (pool.length === 0) return { ok: false, error: 'selection' };

  let best: { source: SketchEntity; shape: ExtendShape } | null = null;
  let inside = false;
  for (const source of pool) {
    const result = extendCurve(source, at, grip?.end);
    if (!result.ok) {
      if (result.error === 'inside') inside = true;
      continue;
    }
    // The pointer only says how far: what the stretch passes on the way is
    // crossed, not stopped at. A curve the pointer itself is on is the one it
    // lands on, and there the end meets it exactly.
    const shape =
      options.snapTo && options.snapTo !== source.id
        ? landOnCurve(source, result.shape, feature, options.snapTo)
        : result.shape;
    if (!best || nearer(at, shape, best.shape)) best = { source, shape };
  }
  if (!best) return { ok: false, error: inside ? 'inside' : 'unsupported' };

  const { source, shape } = best;
  const indices = curveEndIndices(shape.entity);
  if (!indices) return { ok: false, error: 'unsupported' };
  return {
    ok: true,
    plan: {
      source,
      entity: shape.entity,
      end: shape.end,
      endIndex: indices[shape.end],
      from: shape.from,
      to: shape.to,
      landing: landingAt(shape, feature, options),
    },
  };
}

/**
 * Which of two stretches the pointer means: the one whose end it stands nearer
 * to. Two curves sharing a corner both stretch toward the same point, and the
 * one the pointer leans to wins.
 */
function nearer(pointer: Point2, a: ExtendShape, b: ExtendShape): boolean {
  const to = (shape: ExtendShape) =>
    Math.hypot(pointer[0] - shape.from[0], pointer[1] - shape.from[1]);
  const gap = to(a) - to(b);
  if (Math.abs(gap) > 1e-9) return gap < 0;
  return (
    Math.hypot(pointer[0] - a.to[0], pointer[1] - a.to[1]) <
    Math.hypot(pointer[0] - b.to[0], pointer[1] - b.to[1])
  );
}

/**
 * The end lands on the curve the pointer is on: the crossing of the stretch with
 * that curve becomes the new end, so the two meet exactly rather than nearly.
 * The pointer runs the stretch, so a curve it is not on is crossed and not
 * stopped at.
 */
function landOnCurve(
  source: SketchEntity,
  shape: ExtendShape,
  feature: SketchFeature,
  curveId: string,
): ExtendShape {
  const target = feature.entities.find((entity) => entity.id === curveId);
  if (!target) return shape;
  // Where the old end stands on the stretched curve: everything past it is what
  // the tool added, and only what the tool added can be landed on.
  const old = curveParameterAt(shape.entity, shape.from);
  if (old === null) return shape;
  let landing: { point: Point2; distance: number } | null = null;
  for (const crossing of curveCrossingSources(shape.entity, [target])) {
    const gap =
      shape.end === 'end' ? crossing.parameter - old : old - crossing.parameter;
    if (gap <= 1e-6) continue;
    const point = curvePointAt(shape.entity, crossing.parameter);
    if (!point) continue;
    const distance = Math.hypot(point[0] - shape.to[0], point[1] - shape.to[1]);
    if (!landing || distance < landing.distance) landing = { point, distance };
  }
  if (!landing) return shape;
  // The crossing lies on the curve's own course, so stretching to it lands the
  // end exactly on it.
  const landed = extendCurve(source, landing.point, shape.end);
  return landed.ok ? landed.shape : shape;
}

/** The relations the new end will be held by, if the sketch has any there. */
function landingAt(
  shape: ExtendShape,
  feature: SketchFeature,
  options: ExtendOptions,
): ExtendLanding {
  const others = feature.entities.filter(
    (entity) =>
      entity.id !== shape.entity.id && (options.construction || !entity.construction),
  );
  const same = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  const points: ExtendLandingPoint[] = [];
  for (const other of others) {
    const index = entityControlPoints(other).findIndex((point) => same(point, shape.to));
    if (index >= 0) points.push({ entityId: other.id, pointIndex: index });
  }
  if (points.length > 0) return { points, curveIds: [] };
  // No point of the sketch is there, so the curves that run through the new end
  // hold it. The end is the curve's own end, which is parameter 1 at its finish
  // and 0 at its start.
  const own = shape.end === 'end' ? 1 : 0;
  const curveIds = [
    ...new Set(
      curveCrossingSources(shape.entity, others)
        .filter((crossing) => Math.abs(crossing.parameter - own) <= 1e-5)
        .map((crossing) => crossing.otherId),
    ),
  ];
  return { points: [], curveIds };
}

/** The preview: the curve grown, standing where the click will leave it. */
export function extendPreviewEntities(plan: ExtendPlan): SketchEntity[] {
  return [plan.entity];
}

export interface ExtendCommit {
  feature: SketchFeature;
  /** The stretched curve; it keeps the curve's own id. */
  keptIds: string[];
  /** The point left standing where the old end was, when it carried relations. */
  pointId: string | null;
  addedConstraintIds: string[];
}

export type ExtendCommitResult =
  | { ok: true; commit: ExtendCommit }
  | { ok: false; error: ExtendFailure };

/**
 * The feature after the stretch: the curve grown, the relations that named the
 * end it moved standing where that end was, and a joint wherever the new end
 * lands on the sketch.
 */
export async function commitExtend(
  feature: SketchFeature,
  pointer: readonly [number, number],
  options: ExtendOptions = {},
): Promise<ExtendCommitResult> {
  const planned = planExtend(feature, pointer, options);
  if (!planned.ok) return { ok: false, error: planned.error };
  const { plan } = planned;

  // The end that grows may carry relations: a dimension to it, a joint with
  // another curve. They describe the corner that stood there, so they stay
  // there — on a point of their own, which keeps the curve free to grow.
  const tied = feature.constraints.filter((constraint) =>
    constraint.refs.some(
      (ref) => ref.entityId === plan.source.id && ref.pointIndex === plan.endIndex,
    ),
  );
  const point: SketchEntity | null =
    tied.length === 0
      ? null
      : {
          id: createId('entity'),
          type: 'point',
          construction: false,
          x: plan.from[0],
          y: plan.from[1],
        };

  const entities: SketchEntity[] = [];
  for (const entity of feature.entities) {
    if (entity.id !== plan.source.id) {
      entities.push(entity);
      continue;
    }
    entities.push(plan.entity);
    if (point) entities.push(point);
  }

  const constraints: SketchConstraint[] = feature.constraints.map((constraint) => {
    if (!point || !tied.includes(constraint)) return constraint;
    return {
      ...constraint,
      refs: constraint.refs.map((ref) =>
        ref.entityId === plan.source.id && ref.pointIndex === plan.endIndex
          ? { entityId: point.id, pointIndex: 0 }
          : ref,
      ),
    } as SketchConstraint;
  });

  const added: SketchConstraint[] = [];
  const endRef = { entityId: plan.entity.id, pointIndex: plan.endIndex };
  for (const landing of plan.landing.points) {
    added.push({
      id: createId('con'),
      type: 'coincident',
      auto: true,
      refs: [endRef, { entityId: landing.entityId, pointIndex: landing.pointIndex }],
    } as SketchConstraint);
  }
  for (const id of plan.landing.curveIds) {
    const other = entities.find((entity) => entity.id === id);
    if (!other) continue;
    const type = pointOnCurveType(other);
    if (!type) continue;
    added.push({
      id: createId('con'),
      type,
      auto: true,
      refs: [endRef, { entityId: other.id }],
    } as SketchConstraint);
  }
  const unique = uniqueConstraints(added, constraints, sketchEntityIndex(entities));

  const next: SketchFeature = { ...feature, entities, constraints: [...constraints, ...unique] };
  // Nothing is solved: a stretch adds no geometry and changes none, so the curve
  // is exact and the sketch must not move.
  return {
    ok: true,
    commit: {
      feature: next,
      keptIds: [plan.entity.id],
      pointId: point?.id ?? null,
      addedConstraintIds: unique.map((constraint) => constraint.id),
    },
  };
}
