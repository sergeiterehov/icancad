import {
  createId,
  type ConstraintType,
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
import { projectionEntityIds } from './projection';

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
        const gap = pointToLineDistance([first.x1, first.y1], second);
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
    if (target?.type === 'line' && pointRefs.length === 1) {
      const point = refPoint(pointRefs[0]!, entities);
      const gap = point ? pointToLineDistance(point, target) : undefined;
      if (gap !== undefined) push('distance', [pointRefs[0]!, entityRefs[0]!], gap);
    }
  }
  if (refs.length === 3 && entityRefs.length === 1 && pointRefs.length === 2) {
    if (selectedEntities[0]?.type === 'line') push('symmetric', refs);
  }
  if (refs.length === 3 && pointRefs.length === 3) push('symmetric', refs);
  return actions;
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
  ): SketchConstraint => ({ id: createId('con'), type, refs, value });

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

export function applyConstraintAction(
  feature: SketchFeature,
  action: ConstraintAction,
): Promise<SketchFeature> {
  const entities = sketchEntityIndex(feature.entities);
  const constraints = constraintsForAction(action, entities);
  if (constraints.length === 0) return Promise.reject(new ConstraintSolveError('failed'));
  return solveWithConstraints(feature, [...feature.constraints, ...constraints]);
}

export async function diagnoseSketch(feature: SketchFeature): Promise<void> {
  if (feature.constraints.length === 0) {
    useUiStore.getState().setSketchFrozen([]);
    useUiStore.getState().setSketchProblems([]);
    return;
  }
  try {
    const result = await solveSketch(feature.entities, feature.constraints, [], {
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

export function applyConstraintValue(
  feature: SketchFeature,
  constraintId: string,
  value: number,
): Promise<SketchFeature> {
  return solveWithConstraints(
    feature,
    feature.constraints.map((constraint) =>
      constraint.id === constraintId ? { ...constraint, value } : constraint,
    ),
  );
}
