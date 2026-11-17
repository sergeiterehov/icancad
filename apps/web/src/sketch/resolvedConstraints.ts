import type { SketchConstraint, SketchFeature } from '@icancad/model';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';

/** A sketch with a broken formula has no numbers to solve with. */
export function sketchHasFormulaError(featureId: string): boolean {
  const errors = useFormulaStore.getState().resolution?.errors?.[featureId];
  return errors !== undefined && Object.keys(errors).length > 0;
}

/**
 * The current sketch constraints with formula values replaced by the numbers
 * the engine computed. The authored constraints are kept, so a constraint the
 * user just added or removed is not lost to an older resolution snapshot.
 */
export function constraintsForSolve(feature: SketchFeature): SketchConstraint[] {
  const resolved = resolvedFeatureFor(feature);
  if (resolved?.type !== 'sketch') return feature.constraints;
  const values = new Map(
    resolved.constraints.map((constraint) => [constraint.id, constraint.value]),
  );
  return feature.constraints.map((constraint) => {
    const value = values.get(constraint.id);
    return typeof value === 'number' ? { ...constraint, value } : constraint;
  });
}
