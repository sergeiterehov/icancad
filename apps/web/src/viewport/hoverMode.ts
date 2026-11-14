/** What the pointer highlights on the object under it. */
export type HoverTarget = 'geometry' | 'object' | 'none';

/**
 * A selected face or edge, a tool that picks faces or an operation with handles
 * puts the pointer in geometry picking: every object offers its own face or
 * edge. Otherwise the object the selection has opened offers its geometry, which
 * is what the next click drills into, and every other object stays whole,
 * because a click on it selects the object.
 */
export function hoverTargetOf(
  state: { geometryMode: boolean; openedBodyIds: ReadonlySet<string> },
  bodyId: string | null,
): HoverTarget {
  if (bodyId === null) return 'none';
  if (state.geometryMode || state.openedBodyIds.has(bodyId)) return 'geometry';
  return 'object';
}
