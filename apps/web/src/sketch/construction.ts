import type { SketchEntity, SketchFeature } from '@icancad/model';
import { isFundamentalEntityId } from '@icancad/sketch';

/** The selected entities construction can be toggled on. */
export function constructionSelection(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): SketchEntity[] {
  const ids = new Set(
    selectionKeys
      .filter((key) => !key.includes('#'))
      .filter((id) => id.length > 0 && !isFundamentalEntityId(id)),
  );
  return feature.entities.filter((entity) => ids.has(entity.id));
}

/**
 * Flips construction on every selected entity. The whole selection takes the
 * state of its first entity, so toggling a mixed group turns all of it on or
 * all of it off instead of flipping each member apart.
 */
export function toggleConstruction(
  feature: SketchFeature,
  selectionKeys: readonly string[],
): SketchFeature | null {
  const targets = constructionSelection(feature, selectionKeys);
  if (targets.length === 0) return null;
  const ids = new Set(targets.map((entity) => entity.id));
  const construction = !targets.every((entity) => entity.construction);
  return {
    ...feature,
    entities: feature.entities.map((entity) =>
      ids.has(entity.id) ? { ...entity, construction } : entity,
    ),
  };
}
