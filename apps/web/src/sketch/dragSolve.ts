import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import { entityControlPoints } from '@icancad/sketch';
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
}

export interface DragSolveOutcome {
  result: SketchSolveResult;
  /** Key of the attempt that produced the result, for the next frame. */
  attempt: string;
}

const AXIS_LABEL: Record<'x' | 'y', string> = { x: 'x', y: 'y' };

/** Stable name of an attempt, so a drag can start from the one that worked. */
function attemptKey(pins: SketchConstraintRef[], attempt: SolverPin[]): string {
  const size = pins.length === 0 ? 'free' : pins.length > 1 ? 'all' : 'one';
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
function pinAttempts(pins: SketchConstraintRef[]): SolverPin[][] {
  const single = pins.length === 1 ? pins[0] : undefined;
  if (!single || single.pointIndex === undefined) return [pins];
  return [pins, [{ ...single, axis: 'x' }], [{ ...single, axis: 'y' }]];
}

const POSITION_TOLERANCE = 1e-4;

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
}: DragSolveOptions): Promise<DragSolveOutcome | null> {
  const attempts = pinSets.flatMap((pins) =>
    pinAttempts(pins).map((attempt) => ({ attempt, key: attemptKey(pins, attempt) })),
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
      if (attempt.length === 0 || (await honoursConstraints(result, constraints, derived))) {
        return { result, attempt: key };
      }
    } catch {
      // Try the next attempt.
    }
  }
  return null;
}
