import type { SelectionItem } from '../stores/documentStore';

/**
 * The rules of one timeline level (ADR 0032): which items a menu acts on, what
 * a click groups, and where the caret is when the cursor is not on this level.
 * Levels are lists of operations and folders, addressed by id in build order.
 */
export interface LevelNode {
  id: string;
  kind: 'feature' | 'group';
  /** First operation of the node in the flat list. */
  start: number;
  /** Last operation of the node in the flat list. */
  end: number;
}

export function isTimelineItem(item: SelectionItem): boolean {
  return item.kind === 'feature' || item.kind === 'group';
}

/**
 * Items a menu acts on: everything selected on this level when the clicked item
 * belongs to that selection, otherwise just the clicked item.
 */
export function menuEntryTargets(
  nodes: readonly LevelNode[],
  selection: readonly SelectionItem[],
  clickedId: string,
): string[] {
  const atLevel = new Set(nodes.map((node) => node.id));
  const selected = selection
    .filter(isTimelineItem)
    .map((item) => item.id)
    .filter((id) => atLevel.has(id));
  return selected.includes(clickedId) && selected.length > 1 ? selected : [clickedId];
}

/**
 * The run a "Group" command would wrap: the whole selection on this level when
 * it is one uninterrupted stretch that includes the clicked item. A selection
 * with gaps is not a folder, so the command is not offered.
 */
export function groupableRun(
  nodes: readonly LevelNode[],
  selection: readonly SelectionItem[],
  clickedId: string,
): string[] | null {
  const atLevel = new Set(nodes.map((node) => node.id));
  const selected = new Set(
    selection
      .filter(isTimelineItem)
      .map((item) => item.id)
      .filter((id) => atLevel.has(id)),
  );
  if (!selected.has(clickedId)) return null;
  const indexes = nodes
    .map((node, index) => (selected.has(node.id) ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length < 2) return null;
  const first = indexes[0] ?? 0;
  const last = indexes[indexes.length - 1] ?? 0;
  if (last - first + 1 !== indexes.length) return null;
  return nodes.slice(first, last + 1).map((node) => node.id);
}

/**
 * Flat caret position a level shows for the cursor. A cursor outside the level
 * sits at its edge: after the last operation of a folder it is simply at the
 * end, before the first one it is at the start. Positions stay flat, because a
 * folder between two operations covers more than one of them and a level index
 * would stop lining up with the list.
 */
export function levelCaretPosition(position: number, levelStart: number, levelEnd: number): number {
  return Math.min(Math.max(position, levelStart), levelEnd);
}

/**
 * Folder of this level that hides the cursor. The cursor is strictly inside a
 * folder when it follows one of its operations but not the last one; at the end
 * the caret after the folder is the one that is drawn.
 */
export function holdingGroup(nodes: readonly LevelNode[], position: number): LevelNode | null {
  return (
    nodes.find((node) => node.kind === 'group' && node.start < position && position <= node.end) ??
    null
  );
}
