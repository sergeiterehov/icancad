import { useRef } from 'react';
import {
  listClickMode,
  nextListSelection,
  type ClickModifiers,
  type FingerSelection,
  type ListClickMode,
} from './listSelection';

export interface ListSelectionInfo {
  /** The row that was clicked. */
  id: string;
  mode: ListClickMode;
}

/**
 * Applies the shared list rules to one list and remembers where its range
 * starts. The anchor lives with the list, so a click somewhere else starts a
 * new range instead of stretching the previous one across two surfaces.
 */
export function useListSelection({
  ids,
  selected,
  repeatClears,
  finger,
  onSelect,
}: {
  /** Rows in the order the list shows them. */
  ids: readonly string[];
  /** Rows selected now. */
  selected: readonly string[];
  repeatClears?: boolean;
  /** How a finger reads the list; most lists let it add to the selection. */
  finger?: FingerSelection;
  onSelect: (ids: string[], info: ListSelectionInfo) => void;
}): (event: ClickModifiers, id: string) => void {
  const anchor = useRef<string | null>(null);
  return (event, id) => {
    const mode = listClickMode(event, finger);
    const result = nextListSelection({
      ids,
      selected,
      anchor: anchor.current,
      id,
      mode,
      repeatClears,
    });
    anchor.current = result.anchor;
    onSelect(result.selected, { id, mode });
  };
}
