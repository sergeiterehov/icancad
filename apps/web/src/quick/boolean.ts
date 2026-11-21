import { isFeatureInHistory, type Model } from '@icancad/model';
import type { BooleanInput, SelectionItem } from '../stores/documentStore';

/**
 * What a new boolean starts with: the first picked body opens the first list and
 * every later one joins the second list. Imported meshes are not B-reps and
 * cannot be combined.
 */
export function booleanInputFromSelection(
  model: Model,
  selection: readonly SelectionItem[],
): BooleanInput | undefined {
  const bodyIds = selection
    .filter((item) => item.kind === 'body')
    .map((item) => item.id)
    .filter((bodyId) => {
      const body = model.bodies.find((candidate) => candidate.id === bodyId);
      return Boolean(body && body.kind !== 'mesh' && isFeatureInHistory(model, body.createdBy));
    });
  const [first, ...rest] = bodyIds;
  return first ? { bodyIds: [first], toolIds: rest } : undefined;
}
