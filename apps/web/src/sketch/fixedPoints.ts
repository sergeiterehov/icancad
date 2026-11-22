import type { SketchFeature } from '@icancad/model';
import { entityControlPoints } from '@icancad/sketch';

/**
 * Points a fix constraint pins, as `entityId#index` keys.
 *
 * A fixed sketch point cannot be moved, so it is drawn like any other point
 * without a degree of freedom. Reading it straight from the constraints keeps
 * the colour on screen before the first solve, which the frozen-entity
 * diagnostics only report afterwards.
 */
export function fixedPointIds(feature: SketchFeature): string[] {
  const entities = new Map(feature.entities.map((entity) => [entity.id, entity]));
  const keys = new Set<string>();
  for (const constraint of feature.constraints) {
    if (constraint.type !== 'fix') continue;
    for (const ref of constraint.refs) {
      const entity = entities.get(ref.entityId);
      if (!entity) continue;
      if (ref.pointIndex !== undefined) {
        keys.add(`${entity.id}#${ref.pointIndex}`);
        continue;
      }
      entityControlPoints(entity).forEach((_, index) => {
        keys.add(`${entity.id}#${index}`);
      });
    }
  }
  return [...keys];
}
