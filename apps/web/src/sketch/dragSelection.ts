import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import {
  entityControlPointRefs,
  entityControlPoints,
  moveEntityControlPoint,
  translateEntity,
  type Point2,
} from '@icancad/sketch';

export interface DragGrab {
  id: string;
  /** A point handle is moved alone; a curve moves with its whole selection. */
  mode: 'point' | 'entity';
  pointIndex: number | null;
  original: SketchEntity;
}

export interface DragMove {
  entities: readonly SketchEntity[];
  grabbed: DragGrab;
  /** Every entity that travels with the pointer. */
  movedIds: readonly string[];
  target: Point2;
  /** The point the current preview was built for. */
  reference: Point2;
}

/** The sketch with every dragged entity moved to where the pointer asks. */
export function moveDraggedEntities({
  entities,
  grabbed,
  movedIds,
  target,
  reference,
}: DragMove): SketchEntity[] {
  const delta: Point2 = [target[0] - reference[0], target[1] - reference[1]];
  // A point handle is a grab of that point alone: the rest of the sketch,
  // including other selected curves, stays where it is.
  const moved = new Set(grabbed.mode === 'point' ? [grabbed.id] : movedIds);
  return entities.map((entity) => {
    if (entity.id === grabbed.id) {
      return grabbed.mode === 'point'
        ? moveEntityControlPoint(entity, grabbed.pointIndex ?? 0, target)
        : translateEntity(entity, delta[0], delta[1]);
    }
    if (!moved.has(entity.id)) return entity;
    return translateEntity(entity, delta[0], delta[1]);
  });
}

/**
 * The entity ids of a selection that can actually travel with the pointer.
 * Geometry without a degree of freedom is left out: it has nowhere to go, and
 * moving it would only last until the next solve, which reads as a jump.
 */
export function movableEntities(
  selectionKeys: readonly string[],
  frozenEntityIds: readonly string[],
): string[] {
  const frozen = new Set(frozenEntityIds);
  const ids = selectionKeys.map((key) => key.split('#')[0] ?? '').filter((id) => id.length > 0);
  return [...new Set(ids.filter((id) => !frozen.has(id)))];
}

/** Whether any constraint can move this entity, and with it, the rest. */
export function isSelectionConstrained(
  constraints: readonly SketchConstraint[],
  entityIds: readonly string[],
): boolean {
  const ids = new Set(entityIds);
  return constraints.some((constraint) => constraint.refs.some((ref) => ids.has(ref.entityId)));
}

/**
 * Pin sets for a drag, strongest first. A group first pins every control point
 * of every member, so the shapes the user drew travel rigidly instead of being
 * re-solved into something the constraints allow. One control point per entity
 * follows, which keeps a group whose members are tied to fixed geometry
 * together; the single-entity ladder follows, so a group that cannot move as a
 * whole still moves the grabbed curve the way it always has.
 */
export function dragPinSets({
  grabbed,
  movedIds,
  startPoint,
  entities = [],
}: {
  grabbed: DragGrab;
  movedIds: readonly string[];
  startPoint: Point2;
  entities?: readonly SketchEntity[];
}): SketchConstraintRef[][] {
  if (grabbed.mode === 'point') {
    return [[{ entityId: grabbed.id, pointIndex: grabbed.pointIndex ?? 0 }]];
  }
  const known = new Map(entities.map((entity) => [entity.id, entity]));
  const rigid = movedIds.flatMap((entityId) => {
    const entity = entityId === grabbed.id ? grabbed.original : known.get(entityId);
    return entity ? entityControlPointRefs(entity) : [];
  });
  const group =
    movedIds.length > 1 ? [movedIds.map((entityId) => ({ entityId, pointIndex: 0 }))] : [];
  const rigidGroup = movedIds.length > 1 ? [rigid] : [];
  const refs = entityControlPointRefs(grabbed.original);
  if (refs.length <= 1) return [...rigidGroup, ...group, refs];
  let nearest = refs[0]!;
  let best = Number.POSITIVE_INFINITY;
  for (const ref of refs) {
    const point = entityControlPoints(grabbed.original)[ref.pointIndex ?? 0];
    if (!point) continue;
    const distanceToGrab = Math.hypot(point[0] - startPoint[0], point[1] - startPoint[1]);
    if (distanceToGrab < best) {
      best = distanceToGrab;
      nearest = ref;
    }
  }
  return [...rigidGroup, ...group, refs, [nearest], []];
}
