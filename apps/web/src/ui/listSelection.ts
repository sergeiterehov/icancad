/**
 * The selection rules every list in the app shares.
 *
 * A plain click selects the row under the pointer, Cmd on macOS or Ctrl on
 * Windows toggles one row in or out of the selection, and Shift takes
 * everything from the anchor to the clicked row. Shift wins over Cmd and Ctrl,
 * so a range never depends on which key the user happened to press first.
 *
 * The rules are a pure function of the rows the list shows, the rows selected
 * right now and the anchor the list remembers, so the object tree, the timeline,
 * the operation panels and the sketch panels all behave the same way.
 */

/** How a click combines with what is already selected. */
export type ListClickMode = 'replace' | 'toggle' | 'range';

/** The part of a pointer event the rules read. */
export interface ClickModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** The mode a click asks for, from the modifiers it carries. */
export function listClickMode(event: ClickModifiers): ListClickMode {
  if (event.shiftKey) return 'range';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'replace';
}

/**
 * Additive pick in the 3D view or the sketch canvas. These surfaces have no
 * order to take a range from, so every modifier adds the one element picked.
 */
export function isAdditiveClick(event: ClickModifiers): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

export interface ListClick {
  /** Rows in the order the list shows them. */
  ids: readonly string[];
  /** Rows selected now, in the order they were selected. */
  selected: readonly string[];
  /** Row the previous click left behind; null while the list has none. */
  anchor: string | null;
  /** Row that was clicked. */
  id: string;
  mode: ListClickMode;
  /**
   * A plain click on the only selected row clears the selection. The constraint
   * list asks for it, because there the selection opens a value editor.
   */
  repeatClears?: boolean;
}

export interface ListClickResult {
  selected: string[];
  /** Row the next Shift click extends from. */
  anchor: string;
}

/** The selection a click produces, and the anchor it leaves behind. */
export function nextListSelection({
  ids,
  selected,
  anchor,
  id,
  mode,
  repeatClears = false,
}: ListClick): ListClickResult {
  const index = ids.indexOf(id);
  if (mode === 'replace') {
    if (repeatClears && selected.length === 1 && selected[0] === id) {
      return { selected: [], anchor: id };
    }
    return { selected: [id], anchor: id };
  }
  if (mode === 'toggle') {
    return {
      selected: selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : [...selected, id],
      anchor: id,
    };
  }
  // A range starts where the last click in this list landed. That row is the
  // anchor even after a Cmd or Ctrl click took it out of the selection, so
  // Shift still stretches across it. The anchor survives the range itself, so
  // Shift clicks keep dragging the same end instead of starting anew.
  const start = rangeStart(ids, selected, anchor);
  if (start === null || index < 0) return { selected: [id], anchor: id };
  return {
    selected: ids.slice(Math.min(start, index), Math.max(start, index) + 1),
    anchor: ids[start] ?? id,
  };
}

function rangeStart(
  ids: readonly string[],
  selected: readonly string[],
  anchor: string | null,
): number | null {
  // The anchor stands while the list still shows it. A filter can hide it, and
  // then the last selected row is the best place left to range from.
  if (anchor !== null) {
    const index = ids.indexOf(anchor);
    if (index >= 0) return index;
  }
  for (let position = selected.length - 1; position >= 0; position -= 1) {
    const index = ids.indexOf(selected[position]!);
    if (index >= 0) return index;
  }
  return null;
}
