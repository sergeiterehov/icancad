import type { SelectionItem } from '../stores/documentStore';
import {
  bodyEdgeId,
  bodyFaceId,
  parseBodyEdgeId,
  parseBodyFaceId,
} from '../stores/selection';

/** What the pointer found in the viewport, richest detail first. */
export interface SelectionHit {
  /** A visible sketch line: selects the sketch object. */
  sketch?: { id: string };
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

/**
 * First click selects the object, the next click inside it selects a face or an
 * edge. The rule is derived from the current selection, so there is no separate
 * drill mode to enter or leave.
 */
export function resolveSelectionHit(
  hit: SelectionHit | null,
  selection: readonly SelectionItem[],
  options: { additive?: boolean } = {},
): SelectionResolution | null {
  if (!hit) return null;
  const additive = Boolean(options.additive);

  if (hit.sketchFace) {
    return {
      item: { kind: 'face', id: `${hit.sketchFace.sketchId}#${hit.sketchFace.faceId}` },
      additive,
    };
  }
  if (hit.sketch) return { item: { kind: 'sketch', id: hit.sketch.id }, additive };

  if (hit.body) {
    const { id, kind, faceId, edgeId } = hit.body;
    const open = selection.some((item) => bodyOfItem(item) === id);
    if (open && kind === 'solid') {
      if (edgeId) return { item: { kind: 'edge', id: bodyEdgeId(id, edgeId) }, additive };
      if (faceId) return { item: { kind: 'body-face', id: bodyFaceId(id, faceId) }, additive };
    }
    return { item: { kind: kind === 'mesh' ? 'mesh' : 'body', id }, additive };
  }

  return null;
}
