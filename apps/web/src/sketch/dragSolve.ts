import type { SketchConstraint, SketchConstraintRef, SketchEntity } from '@icancad/model';
import { solveSketch } from './client';
import type { SketchSolveResult } from './protocol';

export interface DragSolveOptions {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  pinSets: SketchConstraintRef[][];
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
    try {
      const result = await solveSketch(entities, constraints, pins);
      if (result.conflicting.length === 0) return result;
    } catch {
      // Try the next pin set.
    }
  }
  return null;
}
