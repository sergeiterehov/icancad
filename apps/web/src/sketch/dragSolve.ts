import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import { solveSketch } from './client';
import type { SketchSolveResult, SolverPin } from './protocol';

export interface DragSolveOptions {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  pinSets: SketchConstraintRef[][];
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

/**
 * Drag solving degrades gracefully: a strong pin set (for example every control
 * point of a moved curve) can over-constrain a closed profile, so weaker pin
 * sets are attempted before giving up.
 */
export async function solveDrag({
  entities,
  constraints,
  pinSets,
}: DragSolveOptions): Promise<SketchSolveResult | null> {
  for (const pins of pinSets) {
    for (const attempt of pinAttempts(pins)) {
      try {
        const result = await solveSketch(entities, constraints, attempt);
        if (result.conflicting.length === 0) return result;
      } catch {
        // Try the next attempt.
      }
    }
  }
  return null;
}
