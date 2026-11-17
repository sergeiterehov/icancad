import type { SketchFeature } from '@icancad/model';

/**
 * Geometry touched by a conflicting or redundant constraint. It is drawn in
 * the warning colour so the reason a sketch cannot be solved is visible on the
 * sketch itself, not only in the constraint list.
 */
export function problemGeometryIds(
  feature: SketchFeature,
  problemConstraintIds: readonly string[],
): string[] {
  if (problemConstraintIds.length === 0) return [];
  const problems = new Set(problemConstraintIds);
  const ids = new Set<string>();
  for (const constraint of feature.constraints) {
    if (!problems.has(constraint.id)) continue;
    for (const ref of constraint.refs) ids.add(ref.entityId);
  }
  return [...ids];
}
