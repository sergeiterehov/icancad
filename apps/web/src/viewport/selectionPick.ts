import type { SelectionItem } from '../stores/documentStore';
import { bodyEdgeId, bodyFaceId, parseBodyEdgeId, parseBodyFaceId } from '../stores/selection';
import { isKeylessPointer } from './inputProfile';

/**
 * Whether an empty tap should drop the selection. A finger that has picked one
 * object clears it at once, but a set the user built tap by tap is easy to lose
 * by accident, so a set of two or more asks for a second tap in the same place.
 */
export function emptyTapClearsSelection(
  selection: readonly SelectionItem[],
  pointerType: string,
): boolean {
  return emptyTapClearsSelectionCount(selection.length, pointerType);
}

/** The same rule where the selection is counted rather than listed. */
export function emptyTapClearsSelectionCount(count: number, pointerType: string): boolean {
  return !isKeylessPointer(pointerType) || count <= 1;
}

/** What the pointer found in the viewport, richest detail first. */
export interface SelectionHit {
  /** A visible sketch line: selects the sketch object. */
  sketch?: { id: string };
  /** A curve of the sketch the user has already opened. */
  sketchEdge?: { sketchId: string; entityId: string };
  /** A region of the sketch the user has already opened. */
  sketchFace?: { sketchId: string; faceId: string };
  /** A solid body or an imported mesh under the cursor. */
  body?: {
    id: string;
    kind: 'solid' | 'mesh';
    /** Present when the body is already opened for detail picking. */
    faceId?: string;
    /** Present when the pointer landed on an edge of that body. */
    edgeId?: string;
  };
}

export interface SelectionResolution {
  item: SelectionItem;
  additive: boolean;
}

function bodyOfItem(item: SelectionItem): string | null {
  if (item.kind === 'body' || item.kind === 'mesh') return item.id;
  if (item.kind === 'body-face') return parseBodyFaceId(item.id)?.bodyId ?? null;
  if (item.kind === 'edge') return parseBodyEdgeId(item.id)?.bodyId ?? null;
  return null;
}

/** A face or an edge is selected: every body is open for detail picking. */
function detailsSelected(selection: readonly SelectionItem[]): boolean {
  return selection.some((item) => item.kind === 'body-face' || item.kind === 'edge');
}

/**
 * First click selects the object, the next click inside it selects a face or an
 * edge. Once a face or an edge is selected, the same click works on any body,
 * because the pointer highlights geometry there as well. The rule is derived
 * from the current selection, so there is no separate drill mode to enter or
 * leave.
 */
export function resolveSelectionHit(
  hit: SelectionHit | null,
  selection: readonly SelectionItem[],
  options: { additive?: boolean } = {},
): SelectionResolution | null {
  if (!hit) return null;
  const additive = Boolean(options.additive);

  if (hit.sketchEdge) {
    return {
      item: {
        kind: 'sketch-edge',
        id: `${hit.sketchEdge.sketchId}#${hit.sketchEdge.entityId}`,
      },
      additive,
    };
  }
  if (hit.sketchFace) {
    return {
      item: { kind: 'face', id: `${hit.sketchFace.sketchId}#${hit.sketchFace.faceId}` },
      additive,
    };
  }
  if (hit.sketch) return { item: { kind: 'sketch', id: hit.sketch.id }, additive };

  if (hit.body) {
    const { id, kind, faceId, edgeId } = hit.body;
    // A body is open when the selection holds it, and every body is open once a
    // face or an edge is selected: the pointer then shows geometry everywhere,
    // so a click has to take geometry everywhere too.
    const open = selection.some((item) => bodyOfItem(item) === id) || detailsSelected(selection);
    if (open && kind === 'solid') {
      if (edgeId) return { item: { kind: 'edge', id: bodyEdgeId(id, edgeId) }, additive };
      if (faceId) return { item: { kind: 'body-face', id: bodyFaceId(id, faceId) }, additive };
    }
    return { item: { kind: kind === 'mesh' ? 'mesh' : 'body', id }, additive };
  }

  return null;
}
