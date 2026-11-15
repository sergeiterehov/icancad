import { describe, expect, it } from 'vitest';
import { MENU_EDGE_MARGIN, menuPosition, submenuPosition } from '../src/ui/menuPlacement';

const viewport = { width: 1000, height: 700 };

describe('a menu at the pointer', () => {
  it('opens where it was asked to', () => {
    expect(menuPosition({ left: 300, top: 200 }, { width: 200, height: 150 }, viewport)).toEqual({
      left: 300,
      top: 200,
    });
  });

  it('stays inside the right and bottom edges', () => {
    const at = menuPosition({ left: 980, top: 690 }, { width: 200, height: 150 }, viewport);
    expect(at.left).toBe(viewport.width - MENU_EDGE_MARGIN - 200);
    expect(at.top).toBe(viewport.height - MENU_EDGE_MARGIN - 150);
  });

  it('never leaves the left or top edge, however short the window is', () => {
    const tall = menuPosition({ left: 2, top: 2 }, { width: 200, height: 900 }, viewport);
    expect(tall.left).toBe(MENU_EDGE_MARGIN);
    expect(tall.top).toBe(MENU_EDGE_MARGIN);
  });
});

describe('a menu nested in a row', () => {
  const size = { width: 220, height: 300 };

  it('opens beside the row when there is room', () => {
    const at = submenuPosition({ left: 100, right: 360, top: 200 }, size, viewport);
    expect(at.left).toBe(364);
    expect(at.top).toBe(195);
  });

  it('turns to the left of the row when the right edge is close', () => {
    const at = submenuPosition({ left: 800, right: 990, top: 200 }, size, viewport);
    expect(at.left).toBe(800 - 4 - size.width);
  });

  it('stays inside the window when neither side has room', () => {
    const tiny = { width: 300, height: 200 };
    const at = submenuPosition({ left: 40, right: 120, top: 100 }, tiny, viewport);
    expect(at.left).toBeGreaterThanOrEqual(MENU_EDGE_MARGIN);
    expect(at.left + tiny.width).toBeLessThanOrEqual(viewport.width - MENU_EDGE_MARGIN);
  });

  it('steps up when the list would reach below the window', () => {
    const at = submenuPosition({ left: 100, right: 300, top: 650 }, size, viewport);
    expect(at.top).toBe(viewport.height - MENU_EDGE_MARGIN - size.height);
    expect(at.top + size.height).toBeLessThanOrEqual(viewport.height);
  });
});
