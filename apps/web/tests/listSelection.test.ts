import { describe, expect, it } from 'vitest';
import {
  isAdditiveClick,
  isFingerClick,
  listClickMode,
  nextListSelection,
  type ClickModifiers,
} from '../src/ui/listSelection';
import { lastPointerType, notePointerType } from '../src/viewport/inputProfile';

const plain: ClickModifiers = { shiftKey: false, metaKey: false, ctrlKey: false };
const cmd: ClickModifiers = { shiftKey: false, metaKey: true, ctrlKey: false };
const ctrl: ClickModifiers = { shiftKey: false, metaKey: false, ctrlKey: true };
const shift: ClickModifiers = { shiftKey: true, metaKey: false, ctrlKey: false };

const rows = ['a', 'b', 'c', 'd', 'e'];

describe('list click rules', () => {
  it('reads the mode from the modifiers', () => {
    expect(listClickMode(plain)).toBe('replace');
    expect(listClickMode(cmd)).toBe('toggle');
    expect(listClickMode(ctrl)).toBe('toggle');
    expect(listClickMode(shift)).toBe('range');
    // Shift wins, so a range never depends on which key the user pressed first.
    expect(listClickMode({ shiftKey: true, metaKey: true, ctrlKey: true })).toBe('range');
  });

  it('treats every modifier as additive where there is no order to range over', () => {
    expect(isAdditiveClick(plain)).toBe(false);
    expect(isAdditiveClick(cmd)).toBe(true);
    expect(isAdditiveClick(ctrl)).toBe(true);
    expect(isAdditiveClick(shift)).toBe(true);
  });

  it('makes a pen or a finger additive, because neither has a key to hold', () => {
    expect(listClickMode({ ...plain, pointerType: 'touch' })).toBe('toggle');
    expect(isAdditiveClick({ ...plain, pointerType: 'touch' })).toBe(true);
    expect(isFingerClick({ ...plain, pointerType: 'touch' })).toBe(true);
    expect(isFingerClick({ ...plain, pointerType: 'pen' })).toBe(true);
    expect(listClickMode({ ...plain, pointerType: 'pen' })).toBe('toggle');
    expect(listClickMode({ ...plain, pointerType: 'mouse' })).toBe('replace');
  });

  it('follows the press when the click itself does not say what made it', () => {
    expect(lastPointerType()).toBe('mouse');
    notePointerType('touch');
    try {
      expect(isFingerClick(plain)).toBe(true);
      expect(listClickMode(plain)).toBe('toggle');
      // A handed type still wins over the remembered one.
      expect(listClickMode({ ...plain, pointerType: 'mouse' })).toBe('replace');
    } finally {
      notePointerType('mouse');
    }
  });

  it('keeps a finger range from a key it does not have', () => {
    // Shift is unreachable with a finger, so a range needs the keyboard; the tap
    // toggles instead of replacing.
    expect(
      nextListSelection({
        ids: rows,
        selected: ['a'],
        anchor: 'a',
        id: 'c',
        mode: listClickMode({ ...plain, pointerType: 'touch' }),
      }).selected,
    ).toEqual(['a', 'c']);
  });

  it('lets a list take a finger as a plain click instead', () => {
    // The strip of operations holds the one thing being edited, so a tap there
    // takes the operation on its own.
    expect(listClickMode({ ...plain, pointerType: 'touch' }, 'replace')).toBe('replace');
    expect(listClickMode({ ...plain, pointerType: 'mouse' }, 'replace')).toBe('replace');
    // The keys keep working where there is a keyboard.
    expect(listClickMode(shift, 'replace')).toBe('range');
    expect(listClickMode(cmd, 'replace')).toBe('toggle');
  });

  it('replaces the selection with the clicked row', () => {
    expect(
      nextListSelection({
        ids: rows,
        selected: ['a', 'b'],
        anchor: 'a',
        id: 'd',
        mode: 'replace',
      }),
    ).toEqual({ selected: ['d'], anchor: 'd' });
  });

  it('toggles one row in and out', () => {
    const added = nextListSelection({
      ids: rows,
      selected: ['a'],
      anchor: 'a',
      id: 'c',
      mode: 'toggle',
    });
    expect(added).toEqual({ selected: ['a', 'c'], anchor: 'c' });
    expect(
      nextListSelection({
        ids: rows,
        selected: added.selected,
        anchor: added.anchor,
        id: 'a',
        mode: 'toggle',
      }),
    ).toEqual({ selected: ['c'], anchor: 'a' });
  });

  it('takes the range from the anchor in both directions', () => {
    expect(
      nextListSelection({ ids: rows, selected: ['b'], anchor: 'b', id: 'd', mode: 'range' }),
    ).toEqual({ selected: ['b', 'c', 'd'], anchor: 'b' });
    expect(
      nextListSelection({ ids: rows, selected: ['d'], anchor: 'd', id: 'b', mode: 'range' }),
    ).toEqual({ selected: ['b', 'c', 'd'], anchor: 'd' });
  });

  it('keeps stretching the same range while Shift stays down', () => {
    const first = nextListSelection({
      ids: rows,
      selected: ['b'],
      anchor: 'b',
      id: 'c',
      mode: 'range',
    });
    const second = nextListSelection({
      ids: rows,
      selected: first.selected,
      anchor: first.anchor,
      id: 'e',
      mode: 'range',
    });
    expect(second).toEqual({ selected: ['b', 'c', 'd', 'e'], anchor: 'b' });
  });

  it('starts the range from the last selected row when the list has no anchor', () => {
    expect(
      nextListSelection({ ids: rows, selected: ['c'], anchor: null, id: 'e', mode: 'range' }),
    ).toEqual({ selected: ['c', 'd', 'e'], anchor: 'c' });
  });

  it('keeps ranging from a row that a toggle took out of the selection', () => {
    // The anchor is where the click landed, not what is selected: deselecting a
    // row with Cmd or Ctrl still leaves Shift something to stretch from.
    const off = nextListSelection({
      ids: rows,
      selected: ['a', 'c', 'e'],
      anchor: 'c',
      id: 'c',
      mode: 'toggle',
    });
    expect(off).toEqual({ selected: ['a', 'e'], anchor: 'c' });
    expect(
      nextListSelection({
        ids: rows,
        selected: off.selected,
        anchor: off.anchor,
        id: 'e',
        mode: 'range',
      }),
    ).toEqual({ selected: ['c', 'd', 'e'], anchor: 'c' });
  });

  it('falls back to a selected row when the anchor is not on screen', () => {
    const filtered = ['a', 'd', 'e'];
    expect(
      nextListSelection({ ids: filtered, selected: ['a'], anchor: 'b', id: 'e', mode: 'range' }),
    ).toEqual({ selected: ['a', 'd', 'e'], anchor: 'a' });
  });

  it('selects one row when there is nothing to range from', () => {
    expect(
      nextListSelection({ ids: rows, selected: [], anchor: null, id: 'c', mode: 'range' }),
    ).toEqual({ selected: ['c'], anchor: 'c' });
  });

  it('only ranges over the rows the list shows', () => {
    const filtered = ['a', 'd', 'e'];
    expect(
      nextListSelection({ ids: filtered, selected: ['a'], anchor: 'a', id: 'e', mode: 'range' }),
    ).toEqual({ selected: ['a', 'd', 'e'], anchor: 'a' });
  });

  it('clears the only selected row when the list asks for it', () => {
    expect(
      nextListSelection({
        ids: rows,
        selected: ['c'],
        anchor: 'c',
        id: 'c',
        mode: 'replace',
        repeatClears: true,
      }),
    ).toEqual({ selected: [], anchor: 'c' });
    // A plain click on any other row still selects it.
    expect(
      nextListSelection({
        ids: rows,
        selected: ['c'],
        anchor: 'c',
        id: 'd',
        mode: 'replace',
        repeatClears: true,
      }),
    ).toEqual({ selected: ['d'], anchor: 'd' });
  });
});
