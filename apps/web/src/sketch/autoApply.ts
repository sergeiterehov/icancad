import type { SketchConstraint, SketchEntity } from '@icancad/model';
import { solveSketch } from './client';
import type { SketchSolveResult } from './protocol';

export interface AutoApplyInput {
  entities: SketchEntity[];
  /** The constraints the sketch already has, with formula values resolved. */
  constraints: SketchConstraint[];
  /** The constraints the step just produced; none of them is in `constraints` yet. */
  added: SketchConstraint[];
  derived?: readonly string[];
}

export interface AutoApplyResult {
  entities: SketchEntity[];
  /** The added constraints worth storing. */
  added: SketchConstraint[];
  /** Ids of existing automatic constraints that another one already implies. */
  removed: string[];
  conflicting: string[];
  frozenEntityIds: string[];
}

type Solve = (
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  pinned?: never[],
  options?: { diagnose?: boolean; derived?: readonly string[] },
) => Promise<SketchSolveResult>;

function isRedundantAuto(constraints: readonly SketchConstraint[], id: string): boolean {
  return constraints.some((constraint) => constraint.id === id && constraint.auto);
}

/**
 * Solves the sketch with the automatic constraints a step produced and drops
 * the ones the solver shows are already implied. Only automatic constraints are
 * candidates: an authored one stays even when it repeats something else.
 *
 * Constraints are removed one at a time and each removal is checked with a
 * fresh solve, so a pair that implies each other cannot lose both halves.
 */
export async function applyAutoConstraints(
  input: AutoApplyInput,
  solve: Solve = solveSketch,
): Promise<AutoApplyResult | null> {
  let constraints = [...input.constraints, ...input.added];
  const removed = new Set<string>();
  const result = await solve(input.entities, constraints, [], {
    diagnose: true,
    derived: input.derived,
  });
  if (result.conflicting.length > 0) return null;
  let entities = result.entities;

  for (const id of new Set(result.redundant)) {
    if (!isRedundantAuto(constraints, id)) continue;
    const next = constraints.filter((constraint) => constraint.id !== id);
    try {
      const check = await solve(entities, next, [], { derived: input.derived });
      if (check.conflicting.length > 0) continue;
      constraints = next;
      entities = check.entities;
      if (!input.added.some((constraint) => constraint.id === id)) removed.add(id);
    } catch {
      // The removal is not safe; keep the constraint.
    }
  }

  const kept = new Set(constraints.map((constraint) => constraint.id));
  return {
    entities,
    added: input.added.filter((constraint) => kept.has(constraint.id)),
    removed: [...removed],
    conflicting: result.conflicting,
    frozenEntityIds: result.frozenEntityIds,
  };
}
