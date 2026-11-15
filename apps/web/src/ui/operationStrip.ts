import type { Feature } from '@icancad/model';

/**
 * Whether a press on an operation chip takes that operation.
 *
 * The sketch editor owns the workspace: while it is open the strip still shows
 * the whole build order, but a chip is not a way to select something else — the
 * panel, the tree and the view all belong to the sketch being edited, and a
 * selection of another operation underneath them would contradict the mode.
 */
export function chipSelects(activeSketchId: string | null): boolean {
  return activeSketchId === null;
}

/**
 * Whether a second press on a chip opens that sketch.
 *
 * That is the one move the strip keeps in the sketch editor: a double press
 * hands the editor over to another sketch, so the user can pass from one sketch
 * to the next without leaving the mode in between.
 */
export function chipOpensSketch(
  feature: Feature,
  activeSketchId: string | null,
  editable: boolean,
): boolean {
  return feature.type === 'sketch' && editable && feature.id !== activeSketchId;
}
