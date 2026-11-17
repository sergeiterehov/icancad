import {
  createId,
  type ConstraintType,
  type ParamValue,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  entityControlPoints,
  isFundamentalEntityId,
  sketchEntityIndex,
  type Point2,
} from '@icancad/sketch';
import { useUiStore } from '../stores/uiStore';
import { solveSketch } from './client';
import {
  axisCrossingOnCurve,
  axisDistance,
  axisSide,
  canonicalLine,
  curveCurveGap,
  curveSide,
  isCurveRef,
  isLineRef,
  isPointRef,
  lineSide,
  pointCurveDistance,
  refPointOf,
  type DistanceAxis,
} from './distance';
import { projectionEntityIds } from './projection';
import { constraintsForSolve, sketchHasFormulaError } from './resolvedConstraints';

export interface ConstraintAction {
  key: string;
  type: ConstraintType;
  refs: SketchConstraintRef[];
  value?: number;
}

export class ConstraintSolveError extends Error {
  constructor(readonly code: 'conflict' | 'failed') {
    super(code);
  }
}

export function constraintEntityIds(constraint: SketchConstraint): Set<string> {
  return new Set(constraint.refs.map((ref) => ref.entityId));
}

/** Ids of all geometry a set of constraints refers to. */
export function constraintsGeometryIds(constraints: Iterable<SketchConstraint>): string[] {
  const ids = new Set<string>();
  for (const constraint of constraints) {
    for (const ref of constraint.refs) ids.add(ref.entityId);
  }
  return [...ids];
}

/** Constraint types whose value is a number the user edits. */
const NUMERIC_TYPES: ReadonlySet<ConstraintType> = new Set([
  'distance',
  'horizontal-distance',
  'vertical-distance',
  'angle',
  'radius',
  'diameter',
]);

export function isNumericConstraintType(type: ConstraintType): boolean {
  return NUMERIC_TYPES.has(type);
}

/**
 * Types whose references carry no order. `angle` and `symmetric` keep their
 * order: the first line of an angle and the center of a symmetry are roles.
 */
const UNORDERED_TYPES: ReadonlySet<ConstraintType> = new Set([
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'tangent',
  'equal',
  'distance',
  'horizontal-distance',
  'vertical-distance',
  'point-on-line',
  'point-on-circle',
  'point-on-ellipse',
  'fix',
]);

function normalizedRef(ref: SketchConstraintRef, entities?: Map<string, SketchEntity>): string {
  const entity = entities?.get(ref.entityId);
  const index = ref.pointIndex ?? (entity?.type === 'point' ? 0 : undefined);
  return index === undefined ? ref.entityId : `${ref.entityId}#${index}`;
}

/**
 * A key that names the meaning of a constraint rather than the object. Two
 * constraints with the same key say the same thing, so the second one is a
 * duplicate even if its reference order or value differs.
 */
export function constraintKey(
  constraint: SketchConstraint,
  entities?: Map<string, SketchEntity>,
): string {
  const refs = constraint.refs.map((ref) => normalizedRef(ref, entities));
  // Symmetry mirrors the first two references about the last one. The mirrored
  // pair has no order, but the center or the mirror line does.
  if (constraint.type === 'symmetric' && refs.length === 3 && entities) {
    const lineIndex = constraint.refs.findIndex(
      (ref) => ref.pointIndex === undefined && entities?.get(ref.entityId)?.type === 'line',
    );
    if (lineIndex >= 0) {
      const line = refs[lineIndex]!;
      const pair = refs.filter((_, index) => index !== lineIndex).sort();
      return `symmetric|${[...pair, line].join(',')}`;
    }
    return `symmetric|${[...refs.slice(0, 2).sort(), refs[2]!].join(',')}`;
  }
  if (UNORDERED_TYPES.has(constraint.type)) refs.sort();
  return `${constraint.type}|${refs.join(',')}`;
}

/** The constraints that say something the sketch does not already say. */
export function uniqueConstraints(
  constraints: readonly SketchConstraint[],
  existing: readonly SketchConstraint[],
  entities?: Map<string, SketchEntity>,
): SketchConstraint[] {
  const seen = new Set(existing.map((constraint) => constraintKey(constraint, entities)));
  const added: SketchConstraint[] = [];
  for (const constraint of constraints) {
    const key = constraintKey(constraint, entities);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(constraint);
  }
  return added;
}

/** Ids of the constraints that refer to any of the given geometry. */
export function constraintIdsForEntities(
  feature: SketchFeature,
  entityIds: Iterable<string>,
): string[] {
  const targets = new Set(entityIds);
  return feature.constraints
    .filter((constraint) => constraint.refs.some((ref) => targets.has(ref.entityId)))
    .map((constraint) => constraint.id);
}

export function refPoint(
  ref: SketchConstraintRef,
  entities: Map<string, SketchEntity>,
): Point2 | null {
  const entity = entities.get(ref.entityId);
  if (!entity) return null;
  if (entity.type === 'point') return [entity.x, entity.y];
  return entityControlPoints(entity)[ref.pointIndex ?? 0] ?? null;
}

function distanceBetween(
  a: SketchConstraintRef,
  b: SketchConstraintRef,
  entities: Map<string, SketchEntity>,
): number | undefined {
  const first = refPoint(a, entities);
  const second = refPoint(b, entities);
  if (!first || !second) return undefined;
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

type Line = Extract<SketchEntity, { type: 'line' }>;

/** Angle between two segments in degrees as `acos` of their direction cosine. */
function segmentAngle(first: Line, second: Line): number | undefined {
  const a = [first.x2 - first.x1, first.y2 - first.y1] as const;
  const b = [second.x2 - second.x1, second.y2 - second.y1] as const;
  const denominator = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]);
  if (denominator === 0) return undefined;
  const cosine = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** How far apart two undirected segments point, in [0, 90]. */
function directionAngle(first: Line, second: Line): number | undefined {
  const angle = segmentAngle(first, second);
  return angle === undefined ? undefined : Math.min(angle, 180 - angle);
}

/** Distance from a point to the infinite line through the segment. */
export function pointToLineDistance(point: Point2, line: Line): number | undefined {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return undefined;
  return Math.abs((dx * (point[1] - line.y1) - dy * (point[0] - line.x1)) / length);
}

/** Whether two segments are parallel within a tolerance in degrees. */
function isParallelWithin(first: Line, second: Line, degrees: number): boolean {
  const angle = directionAngle(first, second);
  return angle !== undefined && angle <= degrees;
}

/** Two lines are parallel this closely when drawn exactly or by a constraint. */
const PARALLEL_TOLERANCE_DEGREES = 0.1;

function lineAngle(entities: SketchEntity[], refs: SketchConstraintRef[]): number | undefined {
  const lines = refs
    .map((ref) => entities.find((entity) => entity.id === ref.entityId))
    .filter((entity): entity is Line => entity?.type === 'line')
    .slice(0, 2);
  if (lines.length !== 2) return undefined;
  return segmentAngle(lines[0]!, lines[1]!);
}

export function selectionRefs(
  selectionKeys: string[],
  entities: Map<string, SketchEntity>,
): SketchConstraintRef[] {
  const refs: SketchConstraintRef[] = [];
  for (const key of selectionKeys) {
    const [entityId, index] = key.split('#');
    if (!entityId) continue;
    const entity = entities.get(entityId);
    if (!entity) continue;
    if (index !== undefined) refs.push({ entityId, pointIndex: Number(index) });
    else if (entity.type === 'point') refs.push({ entityId, pointIndex: 0 });
    else refs.push({ entityId });
  }
  return refs;
}

/**
 * Whether the solver has a primitive for a tangent between the two entities.
 * Mirrors the combinations handled by the planegcs mapping.
 */
function canBeTangent(first: SketchEntity, second: SketchEntity): boolean {
  const round = (entity: SketchEntity) => entity.type === 'circle' || entity.type === 'arc';
  if (first.type === 'line') {
    return round(second) || second.type === 'ellipse';
  }
  if (first.type === 'ellipse') return second.type === 'line';
  if (round(first)) return round(second) || second.type === 'line';
  return false;
}

export function buildConstraintActions(
  feature: SketchFeature,
  selectionKeys: string[],
): ConstraintAction[] {
  const entities = sketchEntityIndex(feature.entities);
  const refs = selectionRefs(selectionKeys, entities);
  const pointRefs = refs.filter((ref) => ref.pointIndex !== undefined);
  const entityRefs = refs.filter((ref) => ref.pointIndex === undefined);
  const selectedEntities = entityRefs
    .map((ref) => entities.get(ref.entityId))
    .filter((entity): entity is SketchEntity => Boolean(entity));
  // The origin and the axes are a priori fixed, so they cannot be fixed or
  // measured like ordinary geometry, but they are valid constraint targets.
  const ownRefs = refs.filter((ref) => !isFundamentalEntityId(ref.entityId));
  // A group constraint applies to the whole selection, so it is offered only
  // when every selected reference fits the role it needs. A selection mixing
  // roles (say, two lines and a circle) hides the constraints that cannot
  // consume all of it.
  const everyEntity = entityRefs.length === refs.length && entityRefs.length > 0;
  const onlyPoints = pointRefs.length === refs.length && pointRefs.length >= 2;
  const onlyLines = everyEntity && selectedEntities.every((entity) => entity.type === 'line');
  const onlyCurves =
    everyEntity &&
    selectedEntities.every((entity) => entity.type === 'circle' || entity.type === 'arc');
  const onlyOwnLines = onlyLines && ownRefs.length === refs.length;
  const actions: ConstraintAction[] = [];
  const push = (type: ConstraintType, actionRefs: SketchConstraintRef[], value?: number) => {
    actions.push({ key: `${type}-${actions.length}`, type, refs: actionRefs, value });
  };

  if (ownRefs.length > 0) push('fix', refs);
  if (onlyPoints) {
    push('coincident', pointRefs);
    if (refs.length === 2) {
      const first = refPoint(pointRefs[0]!, entities);
      const second = refPoint(pointRefs[1]!, entities);
      const current = distanceBetween(pointRefs[0]!, pointRefs[1]!, entities);
      if (current !== undefined) push('distance', pointRefs, current);
      if (first && second) {
        push('horizontal-distance', pointRefs, Math.abs(second[0] - first[0]));
        push('vertical-distance', pointRefs, Math.abs(second[1] - first[1]));
      }
    }
    push('horizontal', pointRefs);
    push('vertical', pointRefs);
  }
  if (onlyOwnLines) {
    push('horizontal', entityRefs);
    push('vertical', entityRefs);
    if (refs.length === 1) {
      const line = selectedEntities[0] as Extract<SketchEntity, { type: 'line' }>;
      push('distance', entityRefs, Math.hypot(line.x2 - line.x1, line.y2 - line.y1));
    } else {
      push('equal', entityRefs);
    }
  }
  if (onlyLines && refs.length >= 2) {
    push('parallel', entityRefs);
    push('perpendicular', entityRefs);
    if (refs.length === 2) {
      const angle = lineAngle(selectedEntities, entityRefs);
      if (angle !== undefined) push('angle', entityRefs, Math.round(angle * 100) / 100);
      // The gap between two lines only has a meaning while they are parallel;
      // the dimension measures it from the start of the first line.
      const [first, second] = selectedEntities as [Line, Line];
      if (isParallelWithin(first, second, PARALLEL_TOLERANCE_DEGREES)) {
        const gap = pointToLineDistance(canonicalLine(first).start, second);
        if (gap !== undefined) push('distance', entityRefs, gap);
      }
    }
  }
  if (entityRefs.length === 1 && refs.length === 1) {
    const target = selectedEntities[0];
    if (target?.type === 'circle' || target?.type === 'arc') {
      push('radius', entityRefs, target.r);
      push('diameter', entityRefs, target.r * 2);
    }
  }
  if (onlyCurves && ownRefs.length === refs.length && refs.length >= 2) {
    push('equal', entityRefs);
    if (refs.length === 2) {
      // The nearest distance between the curves covers the outer gap, the
      // radial gap of concentric circles and the inner gap of nested ones;
      // intersecting curves measure zero.
      const gap = curveCurveGap(selectedEntities[0]!, selectedEntities[1]!);
      if (gap) push('distance', entityRefs, gap.distance);
    }
  }
  const tangentTarget = selectedEntities[0];
  if (
    everyEntity &&
    selectedEntities.length >= 2 &&
    tangentTarget !== undefined &&
    selectedEntities.slice(1).every((entity) => canBeTangent(tangentTarget, entity))
  ) {
    push('tangent', entityRefs);
  }
  if (pointRefs.length >= 1 && entityRefs.length === 1) {
    const target = selectedEntities[0];
    if (target?.type === 'line') push('point-on-line', refs);
    if (target?.type === 'circle' || target?.type === 'arc') push('point-on-circle', refs);
    if (target?.type === 'ellipse') push('point-on-ellipse', refs);
    if (target && pointRefs.length === 1) {
      const pointRef = pointRefs[0]!;
      const targetRef = entityRefs[0]!;
      const point = refPoint(pointRef, entities);
      const gap =
        target.type === 'line'
          ? point
            ? pointToLineDistance(point, target)
            : undefined
          : point
            ? pointCurveDistance(point, target)
            : undefined;
      if (gap !== undefined) push('distance', [pointRef, targetRef], gap);
      if (point && (target.type === 'line' || target.type === 'circle' || target.type === 'arc')) {
        const axes: Array<[ConstraintType, DistanceAxis]> = [
          ['horizontal-distance', 0],
          ['vertical-distance', 1],
        ];
        for (const [type, axis] of axes) {
          const crossing = axisCrossingOnCurve(target, point, axis);
          if (crossing) push(type, [pointRef, targetRef], axisDistance(point, crossing, axis));
        }
      }
    }
  }
  if (refs.length === 3 && entityRefs.length === 1 && pointRefs.length === 2) {
    if (selectedEntities[0]?.type === 'line') push('symmetric', refs);
  }
  if (refs.length === 3 && pointRefs.length === 3) push('symmetric', refs);
  // An action that would create only constraints the sketch already has is not
  // offered at all: a second equal or a second length is not a new relation. A
  // group action survives while at least one of its pairs is missing.
  const known = new Set(
    feature.constraints.map((constraint) => constraintKey(constraint, entities)),
  );
  return actions.filter((action) =>
    constraintsForAction(action, entities).some(
      (constraint) => !known.has(constraintKey(constraint, entities)),
    ),
  );
}

function chainPairs(
  refs: readonly SketchConstraintRef[],
): Array<[SketchConstraintRef, SketchConstraintRef]> {
  const first = refs[0];
  return first === undefined
    ? []
    : refs.slice(1).map((ref): [SketchConstraintRef, SketchConstraintRef] => [first, ref]);
}

/**
 * The side a distance is created on, captured before the solver runs. The
 * mapping turns it into a signed constraint so a rebuilt line cannot make the
 * point jump to the other side.
 */
function actionSide(
  type: ConstraintType,
  refs: readonly SketchConstraintRef[],
  entities: Map<string, SketchEntity>,
): number | undefined {
  if (type !== 'distance' && type !== 'horizontal-distance' && type !== 'vertical-distance') {
    return undefined;
  }
  const resolved = refs.map((ref) => ({ ref, entity: entities.get(ref.entityId) }));
  const pointEntry = resolved.find((entry) => isPointRef(entry.ref, entry.entity));
  const point = pointEntry ? refPointOf(pointEntry.ref, pointEntry.entity) : null;
  const lines = resolved.filter((entry) => isLineRef(entry.ref, entry.entity));
  const curves = resolved.filter((entry) => isCurveRef(entry.ref, entry.entity));

  if (!point) {
    if (type === 'distance' && lines.length === 2) {
      const first = lines[0]!.entity as Extract<SketchEntity, { type: 'line' }>;
      const second = lines[1]!.entity as Extract<SketchEntity, { type: 'line' }>;
      return lineSide(canonicalLine(first).start, second) || undefined;
    }
    return undefined;
  }

  if (type === 'distance') {
    if (lines.length === 1) {
      return (
        lineSide(point, lines[0]!.entity as Extract<SketchEntity, { type: 'line' }>) || undefined
      );
    }
    if (curves.length === 1) return curveSide(point, curves[0]!.entity!) || undefined;
    return undefined;
  }

  const axis: DistanceAxis = type === 'vertical-distance' ? 1 : 0;
  const target = lines[0]?.entity ?? curves[0]?.entity;
  if (!target) return undefined;
  const crossing = axisCrossingOnCurve(target, point, axis);
  return crossing ? axisSide(point, crossing, axis) || undefined : undefined;
}

/**
 * Expands a constraint action into the solver-level constraints. Group actions
 * tie the first selected element to every following one, because planegcs only
 * knows pairwise primitives and the first element is the reference for the
 * whole group.
 */
export function constraintsForAction(
  action: ConstraintAction,
  entities: Map<string, SketchEntity>,
): SketchConstraint[] {
  const build = (
    type: ConstraintType,
    refs: SketchConstraintRef[],
    value?: number,
  ): SketchConstraint => ({
    id: createId('con'),
    type,
    refs,
    value,
    side: actionSide(type, refs, entities),
  });

  if (action.type !== 'fix') {
    switch (action.type) {
      case 'coincident':
      case 'parallel':
      case 'perpendicular':
      case 'equal':
      case 'tangent':
        return chainPairs(action.refs).map(([first, next]) => build(action.type, [first, next]));
      case 'horizontal':
      case 'vertical':
        // A single line constraint per selected line; points are aligned to
        // the first one.
        return action.refs.every((ref) => ref.pointIndex === undefined)
          ? action.refs.map((ref) => build(action.type, [ref]))
          : chainPairs(action.refs).map(([first, next]) => build(action.type, [first, next]));
      case 'point-on-line':
      case 'point-on-circle':
      case 'point-on-ellipse': {
        const target = action.refs.find((ref) => ref.pointIndex === undefined);
        if (!target) return [];
        return action.refs
          .filter((ref) => ref !== target)
          .map((ref) => build(action.type, [ref, target]));
      }
      default:
        return [build(action.type, action.refs, action.value)];
    }
  }

  const constraints: SketchConstraint[] = [];
  for (const ref of action.refs) {
    if (isFundamentalEntityId(ref.entityId)) continue;
    const entity = entities.get(ref.entityId);
    if (!entity) continue;
    if (entity.type === 'circle') {
      if (ref.pointIndex === undefined || ref.pointIndex === 0) {
        constraints.push({
          id: createId('con'),
          type: 'fix',
          refs: [{ entityId: ref.entityId, pointIndex: 0 }],
          x: entity.cx,
          y: entity.cy,
        });
      }
      if (ref.pointIndex === undefined || ref.pointIndex === 1) {
        constraints.push({
          id: createId('con'),
          type: 'radius',
          refs: [{ entityId: ref.entityId }],
          value: entity.r,
        });
      }
      continue;
    }
    const points =
      ref.pointIndex !== undefined || entity.type === 'point'
        ? [{ pointIndex: ref.pointIndex ?? 0, point: refPoint(ref, entities) }]
        : entityControlPoints(entity).map((point, pointIndex) => ({ pointIndex, point }));
    for (const entry of points) {
      if (!entry.point) continue;
      constraints.push({
        id: createId('con'),
        type: 'fix',
        refs: [{ entityId: ref.entityId, pointIndex: entry.pointIndex }],
        x: entry.point[0],
        y: entry.point[1],
      });
    }
  }
  return constraints;
}

async function solveWithConstraints(
  feature: SketchFeature,
  constraints: SketchConstraint[],
): Promise<SketchFeature> {
  let result;
  try {
    result = await solveSketch(feature.entities, constraints, [], {
      diagnose: true,
      derived: [...projectionEntityIds(feature)],
    });
  } catch {
    throw new ConstraintSolveError('failed');
  }
  if (result.conflicting.length > 0) {
    throw new ConstraintSolveError('conflict');
  }
  useUiStore.getState().setSketchFrozen(result.frozenEntityIds);
  useUiStore
    .getState()
    .setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
  return { ...feature, constraints, entities: result.entities };
}

export interface ConstraintApplication {
  feature: SketchFeature;
  /** A newly created numeric constraint, opened for editing right away. */
  editConstraintId: string | null;
}

export function applyConstraintAction(
  feature: SketchFeature,
  action: ConstraintAction,
): Promise<ConstraintApplication> {
  const entities = sketchEntityIndex(feature.entities);
  const expanded = constraintsForAction(action, entities);
  if (expanded.length === 0) return Promise.reject(new ConstraintSolveError('failed'));
  const constraints = uniqueConstraints(expanded, feature.constraints, entities);
  if (constraints.length === 0) {
    // The sketch already says all of this; adding a second copy would only
    // over-constrain it.
    return Promise.resolve({ feature, editConstraintId: null });
  }
  const authored = [...feature.constraints, ...constraints];
  const editConstraintId =
    isNumericConstraintType(action.type) && constraints.length === 1 ? constraints[0]!.id : null;
  // The solver has no numbers to work with while a formula is broken. The new
  // constraint still belongs to the sketch, so it waits for the fix with the
  // rest of the authored constraints untouched.
  if (sketchHasFormulaError(feature.id)) {
    return Promise.resolve({
      feature: { ...feature, constraints: authored },
      editConstraintId,
    });
  }
  return solveWithConstraints(feature, [...constraintsForSolve(feature), ...constraints]).then(
    (next) => ({
      feature: { ...next, constraints: authored },
      editConstraintId,
    }),
  );
}

export async function diagnoseSketch(feature: SketchFeature): Promise<void> {
  if (sketchHasFormulaError(feature.id)) {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
    return;
  }
  if (feature.constraints.length === 0) {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
    return;
  }
  try {
    const result = await solveSketch(feature.entities, constraintsForSolve(feature), [], {
      diagnose: true,
      derived: [...projectionEntityIds(feature)],
    });
    useUiStore.getState().setSketchFrozen(result.frozenEntityIds);
    useUiStore
      .getState()
      .setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
  } catch {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
  }
}

export function removeSketchEntities(
  feature: SketchFeature,
  entityIds: Iterable<string>,
): SketchFeature {
  const removed = new Set([...entityIds].filter((id) => !isFundamentalEntityId(id)));
  return {
    ...feature,
    entities: feature.entities.filter((entity) => !removed.has(entity.id)),
    constraints: feature.constraints.filter(
      (constraint) => !constraint.refs.some((ref) => removed.has(ref.entityId)),
    ),
    references: (feature.references ?? []).filter((reference) => !removed.has(reference.entityId)),
    projections: (feature.projections ?? []).filter(
      (projection) => !removed.has(projection.entityId),
    ),
  };
}

const SATISFACTION_TOLERANCE = 1e-5;

function almostEqual(first: number, second: number): boolean {
  return (
    Math.abs(first - second) <=
    SATISFACTION_TOLERANCE * Math.max(1, Math.abs(first), Math.abs(second))
  );
}

function resolvedRefs(
  refs: readonly SketchConstraintRef[],
  entities: Map<string, SketchEntity>,
): Array<{ ref: SketchConstraintRef; entity: SketchEntity | undefined }> {
  return refs.map((ref) => ({ ref, entity: entities.get(ref.entityId) }));
}

function distanceMeasurement(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
): number | undefined {
  const refs = constraint.refs;
  if (refs.length === 1) {
    const line = entities.get(refs[0]!.entityId);
    return line?.type === 'line' ? Math.hypot(line.x2 - line.x1, line.y2 - line.y1) : undefined;
  }
  if (refs.length !== 2) return undefined;
  const resolved = resolvedRefs(refs, entities);
  const points = resolved
    .filter((entry) => isPointRef(entry.ref, entry.entity))
    .map((entry) => refPointOf(entry.ref, entry.entity))
    .filter((point): point is Point2 => point !== null);
  const lines = resolved.filter((entry) => isLineRef(entry.ref, entry.entity));
  const curves = resolved.filter((entry) => isCurveRef(entry.ref, entry.entity));
  if (points.length === 2) {
    return Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]);
  }
  if (points.length === 1 && lines.length === 1) {
    return pointToLineDistance(points[0]!, lines[0]!.entity as Line);
  }
  if (lines.length === 2) {
    const first = lines[0]!.entity as Line;
    return pointToLineDistance(canonicalLine(first).start, lines[1]!.entity as Line);
  }
  if (points.length === 1 && curves.length === 1) {
    return pointCurveDistance(points[0]!, curves[0]!.entity!);
  }
  if (curves.length === 2) {
    return curveCurveGap(curves[0]!.entity!, curves[1]!.entity!)?.distance;
  }
  return undefined;
}

function axisDistanceMeasurement(
  constraint: SketchConstraint,
  entities: Map<string, SketchEntity>,
  axis: DistanceAxis,
): number | undefined {
  if (constraint.refs.length !== 2) return undefined;
  const resolved = resolvedRefs(constraint.refs, entities);
  const points = resolved
    .filter((entry) => isPointRef(entry.ref, entry.entity))
    .map((entry) => refPointOf(entry.ref, entry.entity))
    .filter((point): point is Point2 => point !== null);
  if (points.length === 2) return axisDistance(points[0]!, points[1]!, axis);
  if (points.length !== 1) return undefined;
  const target =
    resolved.find((entry) => isLineRef(entry.ref, entry.entity))?.entity ??
    resolved.find((entry) => isCurveRef(entry.ref, entry.entity))?.entity;
  if (!target) return undefined;
  const crossing = axisCrossingOnCurve(target, points[0]!, axis);
  return crossing ? axisDistance(points[0]!, crossing, axis) : undefined;
}

/**
 * Whether the geometry already satisfies every numeric constraint. A sketch
 * solved for a literal keeps that solution when a formula resolves to the same
 * number, so an unnecessary solver pass cannot reject valid geometry.
 */
export function constraintsSatisfied(
  constraints: SketchConstraint[],
  entities: SketchEntity[],
): boolean {
  const map = sketchEntityIndex(entities);
  return constraints.every((constraint) => {
    if (typeof constraint.value !== 'number' || !Number.isFinite(constraint.value)) return true;
    switch (constraint.type) {
      case 'distance': {
        const measured = distanceMeasurement(constraint, map);
        return measured !== undefined && almostEqual(measured, constraint.value);
      }
      case 'horizontal-distance':
      case 'vertical-distance': {
        const measured = axisDistanceMeasurement(
          constraint,
          map,
          constraint.type === 'horizontal-distance' ? 0 : 1,
        );
        return measured !== undefined && almostEqual(measured, constraint.value);
      }
      case 'angle': {
        const lines = constraint.refs
          .map((ref) => map.get(ref.entityId))
          .filter((entity): entity is Line => entity?.type === 'line');
        if (lines.length !== 2) return false;
        const measured = segmentAngle(lines[0]!, lines[1]!);
        return measured !== undefined && almostEqual(measured, constraint.value);
      }
      case 'radius':
      case 'diameter': {
        const entity = map.get(constraint.refs[0]?.entityId ?? '');
        if (entity?.type !== 'circle' && entity?.type !== 'arc') return false;
        const measured = constraint.type === 'radius' ? entity.r : entity.r * 2;
        return almostEqual(measured, constraint.value);
      }
      default:
        return true;
    }
  });
}

export function applyConstraintValue(
  feature: SketchFeature,
  constraintId: string,
  value: ParamValue,
  /** Resolved constraints: a driven dimension reaches the solver as a number. */
  solved: SketchConstraint[] = constraintsForSolve(feature),
): Promise<SketchFeature> {
  const authored = feature.constraints.map((constraint) =>
    constraint.id === constraintId ? { ...constraint, value } : constraint,
  );
  if (sketchHasFormulaError(feature.id)) {
    return Promise.resolve({ ...feature, constraints: authored });
  }
  const forSolve = solved.map((constraint) =>
    constraint.id === constraintId ? { ...constraint, value } : constraint,
  );
  if (constraintsSatisfied(forSolve, feature.entities)) {
    return Promise.resolve({ ...feature, constraints: authored });
  }
  return solveWithConstraints(feature, forSolve).then((next) => ({
    ...next,
    constraints: authored,
  }));
}
