import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import { entityControlPoints, moveEntityControlPoint, type Point2 } from '@icancad/sketch';
import { solveSketch } from './client';
import type { SketchSolveResult, SolverPin } from './protocol';

export interface DragSolveOptions {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  pinSets: SketchConstraintRef[][];
  /** Derived entities, which stay fixed while everything else moves. */
  derived?: readonly string[];
  /** Attempt that solved the previous frame, tried first. */
  prefer?: string | null;
  /** Geometry before this frame's target, used to reject branch jumps. */
  previous?: SketchEntity[];
  /** Entity the pointer moves directly; its own movement is expected. */
  movedEntityId?: string;
  /** Largest movement the rest of the sketch may make in one frame. */
  maxMove?: number;
  /** Whether the drag may still change which coordinate it pins. */
  allowAxisSwitch?: boolean;
  /** Coordinate aligned with the pointer movement, tried first. */
  axisHint?: 'x' | 'y';
}

export interface DragSolveOutcome {
  result: SketchSolveResult;
  /** Key of the attempt that produced the result, for the next frame. */
  attempt: string;
}

const AXIS_LABEL: Record<'x' | 'y', string> = { x: 'x', y: 'y' };

/** Stable name of an attempt, so a drag can start from the one that worked. */
function attemptKey(pins: SketchConstraintRef[], attempt: SolverPin[]): string {
  if (attempt.length === 0) return 'free';
  const size = pins.length > 1 ? 'all' : 'one';
  const axis = attempt.find((pin) => pin.axis)?.axis;
  return `${size}:${axis ? AXIS_LABEL[axis] : 'pin'}`;
}

/**
 * The raw pointer position is almost never exactly on the manifold of the
 * constraints (a point that may only slide along an axis is dragged a fraction
 * of a millimetre off it all the time). Pinning both coordinates then conflicts
 * and the solver falls back to undoing the drag, so the point is also tried
 * held on one coordinate only and left free to slide on the other.
 */
function pinAttempts(
  pins: SketchConstraintRef[],
  prefer?: string | null,
  allowAxisSwitch = true,
  axisHint: 'x' | 'y' = 'x',
): SolverPin[][] {
  const single = pins.length === 1 ? pins[0] : undefined;
  if (!single || single.pointIndex === undefined) return [pins];
  // Alternating between the x and y pins flips the sketch between two solutions
  // and reads as shaking. A drag may change the pinned axis once, at a
  // singularity, and then stays on the new axis.
  const axes: Array<'x' | 'y'> =
    prefer === 'one:y'
      ? ['y', 'x']
      : prefer === 'one:x'
        ? ['x', 'y']
        : axisHint === 'y'
          ? ['y', 'x']
          : ['x', 'y'];
  const allowed = allowAxisSwitch ? axes : [axes[0]!];
  // The exact pin was already rejected by the previous frame; retrying it every
  // frame only doubles the solver work for a pointer that is off the curve.
  const withFull = !prefer || prefer === 'one:pin';
  return [...(withFull ? [pins] : []), ...allowed.map((axis) => [{ ...single, axis }])];
}

const POSITION_TOLERANCE = 1e-4;

function maxMovement(
  first: SketchEntity[],
  second: SketchEntity[],
  ignoreEntityId: string | undefined,
): number {
  let max = 0;
  for (const entity of first) {
    if (entity.id === ignoreEntityId) continue;
    const other = second.find((candidate) => candidate.id === entity.id);
    if (!other) return Number.POSITIVE_INFINITY;
    const before = entityControlPoints(entity);
    const after = entityControlPoints(other);
    if (before.length !== after.length) return Number.POSITIVE_INFINITY;
    for (let index = 0; index < before.length; index += 1) {
      max = Math.max(
        max,
        Math.hypot(before[index]![0] - after[index]![0], before[index]![1] - after[index]![1]),
      );
    }
    if ((entity.type === 'circle' || entity.type === 'arc') && 'r' in other) {
      max = Math.max(max, Math.abs(entity.r - other.r));
    }
  }
  return max;
}

/** Whether two solutions of the same sketch put the geometry in the same place. */
function sameGeometry(first: SketchEntity[], second: SketchEntity[]): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    const a = entityControlPoints(first[index]!);
    const b = entityControlPoints(second[index]!);
    if (a.length !== b.length) return false;
    for (let point = 0; point < a.length; point += 1) {
      if (
        Math.abs(a[point]![0] - b[point]![0]) > POSITION_TOLERANCE ||
        Math.abs(a[point]![1] - b[point]![1]) > POSITION_TOLERANCE
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A pin the constraints cannot honour is not reported as a conflict when the
 * pinned points are solved as fixed parameters: the solver keeps the dragged
 * geometry where the pointer put it and quietly drops the constraints that
 * reference it. Solving again without pins tells whether the pinned result is a
 * configuration the constraints allow.
 */
async function honoursConstraints(
  result: SketchSolveResult,
  constraints: SketchConstraint[],
  derived: readonly string[] | undefined,
): Promise<boolean> {
  // A redundant constraint makes the free solve under-determined, so it can
  // legitimately settle on another branch and no longer serves as a reference
  // for the pinned result. The solver already reported no conflict above.
  if (result.redundant.length > 0) return true;
  const free = await solveSketch(result.entities, constraints, [], { derived });
  return free.conflicting.length === 0 && sameGeometry(result.entities, free.entities);
}

/**
 * Drag solving degrades gracefully: a strong pin set (for example every control
 * point of a moved curve) can over-constrain a closed profile, so weaker pin
 * sets are attempted before giving up.
 */
export async function solveDrag({
  entities,
  constraints,
  pinSets,
  derived,
  prefer,
  previous,
  movedEntityId,
  maxMove,
  allowAxisSwitch = true,
  axisHint = 'x',
}: DragSolveOptions): Promise<DragSolveOutcome | null> {
  const pointDrag =
    pinSets.length === 1 && pinSets[0]?.length === 1 && pinSets[0][0]?.pointIndex !== undefined;
  const attempts = pinSets.flatMap((pins) =>
    pinAttempts(pins, prefer, allowAxisSwitch, axisHint).map((attempt) => ({
      attempt,
      key: attemptKey(pins, attempt),
    })),
  );
  // A drag holds the same kind of attempt from frame to frame, so starting with
  // the one that worked keeps a moving pointer down to one or two solves.
  if (prefer) {
    const preferred = attempts.findIndex((candidate) => candidate.key === prefer);
    if (preferred > 0) attempts.unshift(...attempts.splice(preferred, 1));
  }
  for (const { attempt, key } of attempts) {
    try {
      const result = await solveSketch(entities, constraints, attempt, { derived });
      if (result.conflicting.length > 0) continue;
      if (
        previous &&
        maxMove !== undefined &&
        maxMovement(previous, result.entities, movedEntityId) > maxMove
      ) {
        continue;
      }
      if (pointDrag && attempt[0]?.axis) {
        const pin = pinSets[0]![0]!;
        const target = pointOf(entities, pin);
        const currentDistance = target ? pointDistance(result.entities, pin, target) : Infinity;
        if (target) {
          const projected = await projectNearest(
            previous,
            result,
            pin,
            target,
            entities,
            constraints,
            derived,
            previous,
            movedEntityId,
            maxMove,
          );
          if (projected && projected.distance < currentDistance) {
            return { result: projected.result, attempt: 'nearest' };
          }
        }
        if (await honoursConstraints(result, constraints, derived)) {
          return { result, attempt: key };
        }
        continue;
      }
      if (attempt.length === 0 || (await honoursConstraints(result, constraints, derived))) {
        return { result, attempt: key };
      }
    } catch {
      // Try the next attempt.
    }
  }
  // A point held by constraints may simply be fixed: dragging it is impossible,
  // not conflicting. The geometry the user already had is a valid answer, so the
  // drag becomes a no-op instead of a solver error.
  if (pointDrag && previous) {
    return {
      result: {
        entities: previous,
        status: 'success',
        conflicting: [],
        redundant: [],
        dof: 0,
        frozenEntityIds: [],
      },
      attempt: 'fixed',
    };
  }
  return null;
}

/**
 * The previous solved point and the axis-pinned point are two nearby points on
 * the constraint curve; their chord approximates the local tangent. Pinning the
 * target projected onto that chord lands near the perpendicular foot, which is
 * the point that actually minimizes the distance to the pointer. On a line this
 * is exact; on a curve the pin is rejected when the chord has left the curve,
 * and the axis result is used instead.
 */
async function projectNearest(
  previous: SketchEntity[] | undefined,
  axisResult: SketchSolveResult,
  pin: SketchConstraintRef,
  target: Point2,
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  derived: readonly string[] | undefined,
  continuity: SketchEntity[] | undefined,
  movedEntityId: string | undefined,
  maxMove: number | undefined,
): Promise<{ result: SketchSolveResult; distance: number } | null> {
  const first = previous ? pointOf(previous, pin) : null;
  const second = pointOf(axisResult.entities, pin);
  if (!first || !second) return null;
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-8) return null;
  const t = ((target[0] - first[0]) * dx + (target[1] - first[1]) * dy) / lengthSquared;
  const projected: Point2 = [first[0] + t * dx, first[1] + t * dy];
  const entity = entities.find((candidate) => candidate.id === pin.entityId);
  if (!entity) return null;
  const moved = moveEntityControlPoint(entity, pin.pointIndex ?? 0, projected);
  const input = entities.map((candidate) => (candidate.id === pin.entityId ? moved : candidate));
  try {
    const result = await solveSketch(input, constraints, [pin], { derived });
    if (result.conflicting.length > 0) return null;
    if (
      continuity &&
      maxMove !== undefined &&
      maxMovement(continuity, result.entities, movedEntityId) > maxMove
    ) {
      return null;
    }
    if (!(await honoursConstraints(result, constraints, derived))) return null;
    return { result, distance: pointDistance(result.entities, pin, target) };
  } catch {
    return null;
  }
}

function pointOf(entities: SketchEntity[], pin: SketchConstraintRef): Point2 | null {
  const entity = entities.find((candidate) => candidate.id === pin.entityId);
  return entity ? (entityControlPoints(entity)[pin.pointIndex ?? 0] ?? null) : null;
}

function pointDistance(entities: SketchEntity[], pin: SketchConstraintRef, target: Point2): number {
  const point = pointOf(entities, pin);
  return point ? Math.hypot(point[0] - target[0], point[1] - target[1]) : Infinity;
}
