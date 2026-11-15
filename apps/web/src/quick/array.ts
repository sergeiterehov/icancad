import type { Model } from '@icancad/model';
import type { ArrayInput, SelectionItem } from '../stores/documentStore';

/**
 * What the array starts with. A selection of bodies repeats those bodies; a
 * selection of operations repeats the bodies they made. A mixed selection has
 * no single meaning, so the array starts empty and asks for its input.
 */
export function arrayInputFromSelection(
  model: Model,
  selection: readonly SelectionItem[],
): ArrayInput | null {
  const bodyIds = selection
    .filter((item) => item.kind === 'body')
    .map((item) => item.id)
    .filter((bodyId) => model.bodies.some((body) => body.id === bodyId && body.kind !== 'mesh'));
  const featureIds = selection
    .filter((item) => item.kind === 'feature')
    .map((item) => item.id)
    .filter((featureId) => model.bodies.some((body) => body.createdBy === featureId));
  if (bodyIds.length > 0 && featureIds.length === 0) return { bodyIds };
  if (featureIds.length > 0 && bodyIds.length === 0) return { featureIds };
  return null;
}
