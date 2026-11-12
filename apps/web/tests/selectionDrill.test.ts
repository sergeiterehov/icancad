import { describe, expect, it } from 'vitest';
import type { SelectionItem } from '../src/stores/documentStore';
import { resolveSelectionHit } from '../src/viewport/selectionPick';

const item = (kind: SelectionItem['kind'], id: string): SelectionItem => ({ kind, id });

describe('drill-down selection', () => {
  it('selects the object on the first click', () => {
    expect(resolveSelectionHit({ body: { id: 'b', kind: 'solid' } }, [])).toEqual({
      item: item('body', 'b'),
      additive: false,
    });
  });

  it('selects the face when the body is already open', () => {
    expect(
      resolveSelectionHit(
        { body: { id: 'b', kind: 'solid', faceId: '3' } },
        [item('body', 'b')],
      ),
    ).toEqual({ item: item('body-face', 'b#3'), additive: false });
  });

  it('keeps the body open after a face is selected', () => {
    expect(
      resolveSelectionHit(
        { body: { id: 'b', kind: 'solid', faceId: '4' } },
        [item('body-face', 'b#3')],
      ),
    ).toEqual({ item: item('body-face', 'b#4'), additive: false });
  });

  it('prefers an edge over a face', () => {
    expect(
      resolveSelectionHit(
        { body: { id: 'b', kind: 'solid', faceId: '3', edgeId: '2' } },
        [item('body', 'b')],
      ),
    ).toEqual({ item: item('edge', 'b#2'), additive: false });
  });

  it('opens another body at object level', () => {
    expect(
      resolveSelectionHit(
        { body: { id: 'other', kind: 'solid', faceId: '1' } },
        [item('body-face', 'b#3')],
      ),
    ).toEqual({ item: item('body', 'other'), additive: false });
  });

  it('keeps an imported mesh at object level', () => {
    expect(
      resolveSelectionHit(
        { body: { id: 'mesh-1', kind: 'mesh', faceId: '0' } },
        [item('mesh', 'mesh-1')],
      ),
    ).toEqual({ item: item('mesh', 'mesh-1'), additive: false });
  });

  it('selects a sketch face inside the open sketch', () => {
    expect(
      resolveSelectionHit(
        { sketchFace: { sketchId: 's', faceId: 'f1' } },
        [item('sketch', 's')],
      ),
    ).toEqual({ item: item('face', 's#f1'), additive: false });
  });

  it('selects a sketch from one of its lines', () => {
    expect(resolveSelectionHit({ sketch: { id: 's' } }, [])).toEqual({
      item: item('sketch', 's'),
      additive: false,
    });
  });

  it('passes the additive modifier through at the same level', () => {
    expect(
      resolveSelectionHit({ body: { id: 'b', kind: 'solid', faceId: '1' } }, [], {
        additive: true,
      }),
    ).toEqual({ item: item('body', 'b'), additive: true });
    expect(
      resolveSelectionHit(
        { body: { id: 'b', kind: 'solid', faceId: '1' } },
        [item('body', 'b')],
        { additive: true },
      ),
    ).toEqual({ item: item('body-face', 'b#1'), additive: true });
  });

  it('clears the selection on empty space', () => {
    expect(resolveSelectionHit(null, [item('body', 'b')])).toBeNull();
  });
});
