import { afterEach, describe, expect, it } from 'vitest';
import { contextMenuAt, longPressBroken, LONG_PRESS_SLOP_PX } from '../src/ui/longPress';

describe('a resting finger', () => {
  it('stays resting while it does not travel', () => {
    expect(longPressBroken({ x: 100, y: 100 }, { clientX: 100, clientY: 100 })).toBe(false);
    expect(
      longPressBroken({ x: 100, y: 100 }, { clientX: 100 + LONG_PRESS_SLOP_PX, clientY: 100 }),
    ).toBe(false);
  });

  it('is no longer resting once it travelled', () => {
    expect(
      longPressBroken({ x: 100, y: 100 }, { clientX: 100, clientY: 100 + LONG_PRESS_SLOP_PX + 1 }),
    ).toBe(true);
    expect(longPressBroken({ x: 0, y: 0 }, { clientX: 60, clientY: 80 })).toBe(true);
  });
});

describe('the menu a resting finger asks for', () => {
  afterEach(() => {
    // Only the shape of the event matters here, so the test brings its own.
    delete (globalThis as { MouseEvent?: unknown }).MouseEvent;
  });

  it('is the event a right click sends, where the finger rests', () => {
    class StubMouseEvent extends Event {
      readonly button: number;
      readonly clientX: number;
      readonly clientY: number;
      constructor(type: string, init: MouseEventInit = {}) {
        super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
        this.button = init.button ?? 0;
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
      }
    }
    (globalThis as { MouseEvent?: unknown }).MouseEvent = StubMouseEvent;

    const event = contextMenuAt(42, 17);

    expect(event.type).toBe('contextmenu');
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
    expect(event.clientX).toBe(42);
    expect(event.clientY).toBe(17);
  });
});
