import {
  createId,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@icancad/model';
import {
  entityControlPoints,
  filletShape,
  findFilletCorners,
  isFundamentalEntityId,
  radiusAtPointer,
  sketchEntityIndex,
  type FilletSelection,
  type Point2,
} from '@icancad/sketch';
import { solveSketch } from './client';
import { uniqueConstraints } from './constraintModel';
import { projectionEntityIds } from './projection';
import { constraintsForSolve } from './resolvedConstraints';

/**
 * Скругление углов: what it reads from the selection, what it previews while the
 * pointer sets the radius, and the feature it commits.
 *
 * The geometry comes from `@icancad/sketch`; this module owns the sketch-level
 * decisions — which corners the selection names, which constraints are added,
 * and how the result joins the document in one undoable step.
 */

export type FilletFailure = 'selection' | 'not-connected' | 'collinear' | 'radius' | 'too-large';

/** One end of a line, and where the arc meets it. */
export interface FilletJoin {
  id: string;
  /** 0 for the start of the line, 1 for its end. */
  end: 0 | 1;
  point: Point2;
}

export interface FilletCornerPlan {
  /** The arc that replaces this corner. */
  arc: SketchEntity;
  first: FilletJoin;
  second: FilletJoin;
  /** The corner's own angle, kept as a relation of the two lines. */
  angle: { magnitude: number; side: 1 | -1 } | null;
}

export interface FilletPlan {
  /** The radius the pointer describes: one for every corner of the selection. */
  radius: number;
  /** The source lines, shortened to every corner at once. */
  lines: SketchEntity[];
  corners: FilletCornerPlan[];
}

export type FilletPlanResult =
  | { ok: true; plan: FilletPlan }
  | { ok: false; error: FilletFailure };

/**
 * The corners a selection names. A selected line brings both of its ends, a
 * selected end or point is a corner, and each one is rounded with whatever line
 * meets it there — the far line does not have to be selected, so a whole chain
 * is rounded by selecting its segments.
 */
export function filletCorners(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): FilletSelection[] {
  const byId = sketchEntityIndex(feature.entities);
  const lineIds: string[] = [];
  const points: Point2[] = [];
  for (const key of selectionKeys) {
    const [id = '', index] = key.split('#');
    const entity = byId.get(id);
    if (!entity || isFundamentalEntityId(id)) continue;
    if (index !== undefined) {
      const control = entityControlPoints(entity)[Number(index)];
      if (control) points.push(control);
      continue;
    }
    if (entity.type === 'line') lineIds.push(entity.id);
    else if (entity.type === 'point') points.push([entity.x, entity.y]);
  }
  return findFilletCorners({
    lines: feature.entities.filter((entity) => entity.type === 'line'),
    lineIds,
    points,
  });
}

const spread = (from: Point2, to: Point2) => Math.hypot(from[0] - to[0], from[1] - to[1]);

/**
 * What the pointer asks for: one radius, and the arcs and trimmed lines that
 * carry every corner of the selection. The pointer rides the arc of the corner
 * it stands nearest to, so the radius it sets is the one the eye follows. A
 * radius that does not fit one of the corners is reported while the pointer
 * moves, so the tool never shows a corner it cannot cut.
 */
export function planFillet(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
): FilletPlanResult {
  const selections = filletCorners(feature, selectionKeys);
  if (selections.length === 0) return { ok: false, error: 'selection' };
  const at: Point2 = [pointer[0], pointer[1]];
  const nearest = selections.reduce((best, corner) =>
    spread(corner.corner, at) < spread(best.corner, at) ? corner : best,
  );
  const radius = radiusAtPointer(nearest, at);

  const lines = new Map<string, SketchEntity>();
  for (const entity of feature.entities) {
    if (entity.type === 'line') lines.set(entity.id, entity);
  }
  const corners: FilletCornerPlan[] = [];
  for (const [index, selection] of selections.entries()) {
    const shape = filletShape(selection, radius);
    if ('error' in shape) return { ok: false, error: shape.error };
    // A line between two rounded corners is shortened at both of its ends, so
    // the trims are laid over one another instead of over the source.
    setEnd(lines, shape.first, shape.firstEnd, shape.firstJoint);
    setEnd(lines, shape.second, shape.secondEnd, shape.secondJoint);
    corners.push({
      arc: { ...shape.arc, id: `filletArc${index}` } as SketchEntity,
      first: { id: shape.first.id, end: shape.firstEnd, point: shape.firstJoint },
      second: { id: shape.second.id, end: shape.secondEnd, point: shape.secondJoint },
      angle: lineAngle(selection.first, selection.second),
    });
  }
  return { ok: true, plan: { radius, lines: [...lines.values()], corners } };
}

/** The preview: the shortened lines and every arc, as they will be. */
export function filletPreviewEntities(plan: FilletPlan): SketchEntity[] {
  return [...plan.lines, ...plan.corners.map((corner) => corner.arc)];
}

/** Moves one end of a source line to a tangent point. */
function setEnd(
  lines: Map<string, SketchEntity>,
  entity: SketchEntity,
  end: 0 | 1,
  point: Point2,
) {
  const current = lines.get(entity.id);
  if (!current || current.type !== 'line') return;
  lines.set(
    entity.id,
    end === 0
      ? { ...current, x1: point[0], y1: point[1] }
      : { ...current, x2: point[0], y2: point[1] },
  );
}

export interface FilletCommit {
  feature: SketchFeature;
  /** The source lines keep their ids: the trim is the same geometry, shortened. */
  trimmedIds: string[];
  /** The arcs that took the corners over. */
  arcIds: string[];
  addedConstraintIds: string[];
  /** Relations the fillet consumed with the corner, mostly the joint itself. */
  removedConstraintIds: string[];
}

export type FilletCommitResult =
  | { ok: true; commit: FilletCommit }
  | { ok: false; error: FilletFailure };

/**
 * The coincidence that made the corner a corner. The fillet takes the joint
 * apart: the two lines no longer meet, and leaving the relation behind tells the
 * solver that the two tangent points are one point, which it can only answer by
 * collapsing the arc and dragging the rest of the sketch with it.
 */
function cornerJoints(
  feature: SketchFeature,
  corners: readonly FilletCornerPlan[],
): string[] {
  const consumed = new Set<string>();
  for (const constraint of feature.constraints) {
    if (constraint.type !== 'coincident' || constraint.refs.length !== 2) continue;
    const [a, b] = constraint.refs as [SketchConstraint['refs'][0], SketchConstraint['refs'][0]];
    const joins = (from: FilletJoin, to: FilletJoin) =>
      a.entityId === from.id &&
      a.pointIndex === from.end &&
      b.entityId === to.id &&
      b.pointIndex === to.end;
    for (const corner of corners) {
      if (joins(corner.first, corner.second) || joins(corner.second, corner.first)) {
        consumed.add(constraint.id);
      }
    }
  }
  // Only a relation that ties the two ends the fillet took apart is dropped: a
  // dimension that merely touches one of them still says something true.
  return [...consumed];
}

/**
 * The feature after the operation: the lines shortened, an arc between each pair
 * of them, and the relations that hold every fillet — a coincidence at each
 * joint, the radius, and the corner's own angle. The whole thing is one edit.
 */
export async function commitFillet(
  feature: SketchFeature,
  selectionKeys: readonly string[],
  pointer: readonly [number, number],
): Promise<FilletCommitResult> {
  const planned = planFillet(feature, selectionKeys, pointer);
  if (!planned.ok) return planned;
  const { plan } = planned;
  const trimmed = new Map(plan.lines.map((line) => [line.id, line]));
  const arcs = plan.corners.map((corner) => ({
    ...corner.arc,
    id: createId('entity'),
  }));

  const entities: SketchEntity[] = [...feature.entities];
  for (const [id, line] of trimmed) {
    const index = entities.findIndex((entity) => entity.id === id);
    if (index >= 0) entities[index] = line;
  }
  entities.push(...(arcs as SketchEntity[]));

  const generated: SketchConstraint[] = [];
  const add = (
    type: SketchConstraint['type'],
    refs: SketchConstraint['refs'],
    extra: Record<string, unknown> = {},
  ) => {
    generated.push({ id: createId('con'), type, refs, auto: true, ...extra } as SketchConstraint);
  };
  for (const [index, corner] of plan.corners.entries()) {
    const arc = arcs[index]!;
    add('coincident', [
      { entityId: corner.first.id, pointIndex: corner.first.end },
      { entityId: arc.id, pointIndex: 1 },
    ]);
    add('coincident', [
      { entityId: corner.second.id, pointIndex: corner.second.end },
      { entityId: arc.id, pointIndex: 2 },
    ]);
    add('radius', [{ entityId: arc.id }], { value: plan.radius });
    // The corner itself: an angle between the lines keeps what the fillet was
    // cut from, and the tangency follows from it — the arc of that radius
    // between those two points of lines meeting at that angle can only be
    // tangent. Two tangencies here would say the same thing twice and make the
    // set rank-deficient, which is what leaves a sketch unsolvable after a drag.
    if (corner.angle) {
      add('angle', [{ entityId: corner.first.id }, { entityId: corner.second.id }], {
        value: corner.angle.magnitude,
        side: corner.angle.side,
      });
    }
  }

  const removed = cornerJoints(feature, plan.corners);
  const kept = feature.constraints.filter((constraint) => !removed.includes(constraint.id));
  const added = uniqueConstraints(generated, kept, sketchEntityIndex(entities));
  const next: SketchFeature = { ...feature, entities, constraints: [...kept, ...added] };

  // One solve of the generated set, the same way the offset commits: the fillet
  // has to hold when the sketch is dragged, and a set that cannot be solved must
  // not land in the document.
  const solved = await solveSketch(
    next.entities,
    constraintsForSolve(next),
    [],
    { derived: [...projectionEntityIds(feature)] },
  ).catch(() => null);

  return {
    ok: true,
    commit: {
      feature: solved ? { ...next, entities: solved.entities } : next,
      trimmedIds: [...trimmed.keys()],
      arcIds: arcs.map((arc) => arc.id),
      addedConstraintIds: added.map((constraint) => constraint.id),
      removedConstraintIds: removed,
    },
  };
}

/** The angle two lines make, in the convention the solver reads an angle in. */
function lineAngle(
  first: SketchEntity,
  second: SketchEntity,
): { magnitude: number; side: 1 | -1 } | null {
  if (first.type !== 'line' || second.type !== 'line') return null;
  const ax = first.x2 - first.x1;
  const ay = first.y2 - first.y1;
  const bx = second.x2 - second.x1;
  const by = second.y2 - second.y1;
  if (Math.hypot(ax, ay) < 1e-12 || Math.hypot(bx, by) < 1e-12) return null;
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  const degrees = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
  if (!Number.isFinite(degrees) || degrees < 1e-6 || degrees > 180 - 1e-6) return null;
  return { magnitude: degrees, side: cross >= 0 ? 1 : -1 };
}
