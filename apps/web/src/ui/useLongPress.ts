import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { isKeylessPointer } from '../viewport/inputProfile';

/** How long a finger has to rest on a control before its second action runs. */
export const LONG_PRESS_MS = 450;

/** Movement that turns a resting finger into a drag and cancels the press. */
const LONG_PRESS_SLOP_PX = 8;

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  /**
   * Whether the click that follows belongs to a long press. A control that has
   * both a tap action and a held one asks this first and drops the tap.
   */
  consumed: () => boolean;
}

/**
 * A second action on a finger's press. Split tool buttons start their base tool
 * on a tap and open the list beside them on a hold, so a tablet reaches the
 * variants without hunting for an 11 px chevron. Only a pointer without a
 * keyboard does this: a mouse has the chevron and holding its button means
 * nothing else.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      fired.current = false;
      if (event.button !== 0 || !isKeylessPointer(event.pointerType)) return;
      clear();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clear, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) {
        clear();
      }
    },
    [clear],
  );

  const consumed = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    consumed,
  };
}
