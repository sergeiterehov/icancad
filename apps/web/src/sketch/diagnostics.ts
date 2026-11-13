import { Algorithm, type GcsWrapper } from '@salusoft89/planegcs';
import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { entityControlPoints, moveEntityControlPoint, type Point2 } from '@icancad/sketch';
import { applySolverSolution, buildSolverPrimitives } from './mapping';
import type { SolverPin } from './protocol';

const DELTA = 0.25;

function nearlyEqual(first: number, second: number, tolerance = 1e-4): boolean {
  return Math.abs(first - second) <= tolerance * Math.max(1, Math.abs(first), Math.abs(second));
}

function angleEqual(first: number, second: number): boolean {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second))) <= 1e-4;
}

function sameEntity(first: SketchEntity, second: SketchEntity): boolean {
  if (first.type !== second.type) return false;
  switch (first.type) {
    case 'point':
      return (
        second.type === 'point' && nearlyEqual(first.x, second.x) && nearlyEqual(first.y, second.y)
      );
    case 'line':
      return (
        second.type === 'line' &&
        nearlyEqual(first.x1, second.x1) &&
        nearlyEqual(first.y1, second.y1) &&
        nearlyEqual(first.x2, second.x2) &&
        nearlyEqual(first.y2, second.y2)
      );
    case 'circle':
      return (
        second.type === 'circle' &&
        nearlyEqual(first.cx, second.cx) &&
        nearlyEqual(first.cy, second.cy) &&
        nearlyEqual(first.r, second.r)
      );
    case 'arc':
      return (
        second.type === 'arc' &&
        nearlyEqual(first.cx, second.cx) &&
        nearlyEqual(first.cy, second.cy) &&
        nearlyEqual(first.r, second.r) &&
        angleEqual(first.startAngle, second.startAngle) &&
        angleEqual(first.endAngle, second.endAngle)
      );
    case 'ellipse':
      return (
        second.type === 'ellipse' &&
        nearlyEqual(first.cx, second.cx) &&
        nearlyEqual(first.cy, second.cy) &&
        nearlyEqual(first.rx, second.rx) &&
        nearlyEqual(first.ry, second.ry) &&
        angleEqual((first.rotation * Math.PI) / 180, (second.rotation * Math.PI) / 180)
      );
    case 'bezier':
      return (
        second.type === 'bezier' &&
        first.points.length === second.points.length &&
        first.points.every(
          (point, index) =>
            nearlyEqual(point[0], second.points[index]![0]) &&
            nearlyEqual(point[1], second.points[index]![1]),
        )
      );
  }
}

function solveEntities(
  gcs: GcsWrapper,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned: SolverPin[],
): SketchEntity[] | null {
  try {
    gcs.clear_data();
    gcs.push_primitives_and_params(buildSolverPrimitives(entities, constraints, pinned).primitives);
    const status = gcs.solve(Algorithm.DogLeg);
    if (status === 2 || status === 3) return null;
    if (gcs.get_gcs_conflicting_constraints().length > 0) return null;
    gcs.apply_solution();
    return applySolverSolution(entities, gcs.sketch_index.get_primitives());
  } catch {
    return null;
  }
}

function candidateHasMotion(
  gcs: GcsWrapper,
  baseline: SketchEntity[],
  constraints: SketchConstraint[],
  target: SketchEntity,
  moved: SketchEntity,
  pointIndex: number,
  axis?: 'x' | 'y',
): boolean {
  const entities = baseline.map((entity) => (entity.id === target.id ? moved : entity));

  const direct = solveEntities(gcs, entities, constraints, []);
  const directTarget = direct?.find((entity) => entity.id === target.id);
  if (directTarget && !sameEntity(directTarget, target)) return true;

  const first = solveEntities(gcs, entities, constraints, [
    { entityId: target.id, pointIndex, axis },
  ]);
  if (!first) return false;
  const firstTarget = first.find((entity) => entity.id === target.id);
  if (!firstTarget || sameEntity(firstTarget, target)) return false;

  // The first solve can leave a pinned point at an infeasible position if the
  // solver ignores a conflicting constraint. Re-solve with the point free to
  // verify that the moved state is actually part of the solution manifold.
  const second = solveEntities(gcs, first, constraints, []);
  const secondTarget = second?.find((entity) => entity.id === target.id);
  return Boolean(secondTarget && !sameEntity(secondTarget, target));
}

/**
 * A control point can only be moved along the constraints that hold it, so the
 * probe is repeated for each coordinate separately: a point constrained to an
 * axis or to a line keeps the other coordinate free, and a point on a circle
 * slides when only one coordinate is held. Holding both coordinates, as a
 * mouse drag does, would report coupled geometry as frozen.
 */
function entityHasMotion(
  gcs: GcsWrapper,
  baseline: SketchEntity[],
  constraints: SketchConstraint[],
  target: SketchEntity,
): boolean {
  const points = entityControlPoints(target);
  // A circle exposes its radius as a second control point, but the solver has
  // no point there: only the free projection can show that it moves.
  const solverPoints = target.type === 'circle' ? 1 : points.length;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (index < solverPoints) {
      for (const axis of ['x', 'y'] as const) {
        for (const sign of [1, -1]) {
          const moved = moveEntityControlPoint(target, index, [
            point[0] + (axis === 'x' ? sign * DELTA : 0),
            point[1] + (axis === 'y' ? sign * DELTA : 0),
          ] as Point2);
          if (candidateHasMotion(gcs, baseline, constraints, target, moved, index, axis)) {
            return true;
          }
        }
      }
    }
    const free = moveEntityControlPoint(target, index, [
      point[0] + DELTA,
      point[1] + DELTA,
    ] as Point2);
    if (candidateHasMotion(gcs, baseline, constraints, target, free, index)) return true;
  }
  return false;
}

export function diagnoseFrozenEntities(
  gcs: GcsWrapper,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  globalDof: number,
): string[] {
  if (globalDof === 0) return entities.map((entity) => entity.id);
  return entities
    .filter((entity) => !entityHasMotion(gcs, entities, constraints, entity))
    .map((entity) => entity.id);
}
