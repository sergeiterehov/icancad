import { describe, expect, it } from 'vitest';
import { geometryHoverEnabled, hoverTargetOf } from '../src/viewport/hoverMode';

const opened = new Set(['body-1']);
const state = { geometryMode: false, openedBodyIds: opened };

describe('hoverTargetOf', () => {
  it('shows the geometry of the object the selection opened', () => {
    expect(hoverTargetOf(state, 'body-1')).toBe('geometry');
  });

  it('keeps another object whole while only an object is selected', () => {
    expect(hoverTargetOf(state, 'body-2')).toBe('object');
  });

  it('keeps an object whole when the selection opened nothing', () => {
    expect(hoverTargetOf({ geometryMode: false, openedBodyIds: new Set() }, 'body-2')).toBe(
      'object',
    );
  });

  it('shows the geometry of every object once a face or edge is selected', () => {
    expect(hoverTargetOf({ geometryMode: true, openedBodyIds: opened }, 'body-2')).toBe('geometry');
  });

  it('shows the geometry of every object while a tool or an operation picks them', () => {
    expect(hoverTargetOf({ geometryMode: true, openedBodyIds: new Set() }, 'body-2')).toBe(
      'geometry',
    );
  });

  it('shows nothing over empty space', () => {
    expect(hoverTargetOf(state, null)).toBe('none');
    expect(hoverTargetOf({ geometryMode: true, openedBodyIds: opened }, null)).toBe('none');
  });
});

describe('geometryHoverEnabled', () => {
  it('previews geometry outside a sketch', () => {
    expect(geometryHoverEnabled(false, false)).toBe(true);
  });

  it('lets an open sketch own the pointer', () => {
    expect(geometryHoverEnabled(true, false)).toBe(false);
  });

  it('previews the body geometry a projection click would take', () => {
    expect(geometryHoverEnabled(true, true)).toBe(true);
  });
});
