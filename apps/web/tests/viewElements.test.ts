import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_ELEMENTS,
  isViewElement,
  VIEW_ELEMENTS,
  viewElementsFrom,
} from '../src/viewport/viewElements';

describe('the elements of the view', () => {
  it('starts with the grid and the hatching, and without the axes', () => {
    expect(DEFAULT_VIEW_ELEMENTS).toEqual({ axes: false, grid: true, hatching: true });
    expect(VIEW_ELEMENTS.map((option) => [option.id, option.byDefault])).toEqual([
      ['axes', false],
      ['grid', true],
      ['hatching', true],
    ]);
  });

  it('reads what was stored', () => {
    expect(viewElementsFrom({ axes: true, grid: false, hatching: false })).toEqual({
      axes: true,
      grid: false,
      hatching: false,
    });
  });

  it('falls back to a default per entry, not for the whole file', () => {
    // A preference file written by an older build still tells the truth about
    // the entries it has.
    expect(viewElementsFrom({ grid: false })).toEqual({ axes: false, grid: false, hatching: true });
    expect(viewElementsFrom({ axes: 'yes', hatching: 0 })).toEqual(DEFAULT_VIEW_ELEMENTS);
    expect(viewElementsFrom(null)).toEqual(DEFAULT_VIEW_ELEMENTS);
    expect(viewElementsFrom('nonsense')).toEqual(DEFAULT_VIEW_ELEMENTS);
  });

  it('ignores names it does not know', () => {
    expect(viewElementsFrom({ axes: true, planes: true })).toEqual({
      axes: true,
      grid: true,
      hatching: true,
    });
  });

  it('knows its own names', () => {
    expect(isViewElement('axes')).toBe(true);
    expect(isViewElement('grid')).toBe(true);
    expect(isViewElement('hatching')).toBe(true);
    expect(isViewElement('planes')).toBe(false);
    expect(isViewElement(null)).toBe(false);
  });
});
