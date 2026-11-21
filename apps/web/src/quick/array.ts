import { isFeatureInHistory, type Feature, type Model } from '@icancad/model';
import type { ArrayInput, SelectionItem } from '../stores/documentStore';

/**
 * Operations an array can repeat. Every operation that builds or changes a body
 * is one: the rebuild replays what it did, so only operations with no solid
 * result at all are left out. Where it sits in the history is the other half of
 * the rule — the array cannot depend on an operation it stands in front of.
 */
export function arraySourceOperation(feature: Feature): boolean {
  return (
    feature.type !== 'sketch' &&
    feature.type !== 'import-mesh' &&
    feature.type !== 'delete-body' &&
    // A transform is a pose, not material: repeating the difference between the
    // shapes before and after it would copy the body and the space it left.
    feature.type !== 'transform'
  );
}

/**
 * What the array starts with. A selection of bodies repeats those bodies; a
 * selection of operations repeats what they did. A mixed selection has no
 * single meaning, so the array starts empty and asks for its input.
 */
export function arrayInputFromSelection(
  model: Model,
  selection: readonly SelectionItem[],
): ArrayInput | null {
  const bodyIds = selection
    .filter((item) => item.kind === 'body')
    .map((item) => item.id)
    .filter((bodyId) => {
      const body = model.bodies.find((candidate) => candidate.id === bodyId);
      return Boolean(body && body.kind !== 'mesh' && isFeatureInHistory(model, body.createdBy));
    });
  const featureIds = selection
    .filter((item) => item.kind === 'feature')
    .map((item) => item.id)
    .filter((featureId) => {
      const feature = model.features.find((candidate) => candidate.id === featureId);
      return Boolean(
        feature && arraySourceOperation(feature) && isFeatureInHistory(model, featureId),
      );
    });
  if (bodyIds.length > 0 && featureIds.length === 0) return { bodyIds };
  if (featureIds.length > 0 && bodyIds.length === 0) return { featureIds };
  return null;
}
