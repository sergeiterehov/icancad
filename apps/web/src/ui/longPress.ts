import { isTouchPointer } from '../viewport/inputProfile';

/**
 * A resting finger asks for what a right click asks for.
 *
 * A finger has no second button and no way to say "here, not there". Every
 * context menu in the app is already opened by a `contextmenu` event, so the
 * finger gesture does not add a second way to build menus: it rests, and the
 * press is turned into the event every menu already listens for. Menus keep one
 * definition, and a touch screen reaches all of them.
 */

/** How long a finger rests on a control before it asks for its menu. */
export const LONG_PRESS_MS = 520;

/** How far a resting finger may wander, in pixels, and still be resting. */
export const LONG_PRESS_SLOP_PX = 12;

/** Where a resting finger started. */
export interface LongPressStart {
  pointerId: number;
  x: number;
  y: number;
  target: EventTarget | null;
}

/** True once a resting finger has wandered too far to still count as resting. */
export function longPressBroken(
  start: { x: number; y: number },
  at: { clientX: number; clientY: number },
): boolean {
  return Math.hypot(at.clientX - start.x, at.clientY - start.y) > LONG_PRESS_SLOP_PX;
}

/** What the browser sends for a right click, built by hand for a finger. */
export function contextMenuAt(x: number, y: number): MouseEvent {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
}

/** Controls that keep the long press of the browser, such as text selection. */
const NATIVE_LONG_PRESS = 'input, textarea, select, [contenteditable]';

/**
 * Turns a resting finger anywhere in the document into a `contextmenu` event.
 * Returns the function that takes the listener away again.
 */
export function installLongPressMenu(target: Document = document): () => void {
  const view = target.defaultView ?? window;
  let start: LongPressStart | null = null;
  let timer: number | null = null;
  let swallowClick = false;

  const clear = () => {
    if (timer !== null) {
      view.clearTimeout(timer);
      timer = null;
    }
    start = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    clear();
    swallowClick = false;
    if (!isTouchPointer(event.pointerType) || !event.isPrimary) return;
    const element = event.target as Element | null;
    if (element?.closest?.(NATIVE_LONG_PRESS)) return;
    start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.target,
    };
    timer = view.setTimeout(() => {
      timer = null;
      const press = start;
      start = null;
      if (!press) return;
      swallowClick = true;
      // The menu belongs to what is under the finger now, so a highlight that
      // appeared during the press cannot take it away.
      const under = target.elementFromPoint(press.x, press.y) ?? (press.target as Element | null);
      under?.dispatchEvent(contextMenuAt(press.x, press.y));
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.pointerId) return;
    if (longPressBroken(start, event)) clear();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (start && event.pointerId === start.pointerId) clear();
  };

  // The finger leaves the screen after its menu opened, and the tap that follows
  // must not press the control the menu was opened for.
  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('pointermove', onPointerMove, true);
  target.addEventListener('pointerup', onPointerUp, true);
  target.addEventListener('pointercancel', onPointerUp, true);
  target.addEventListener('click', onClick, true);
  return () => {
    clear();
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('pointermove', onPointerMove, true);
    target.removeEventListener('pointerup', onPointerUp, true);
    target.removeEventListener('pointercancel', onPointerUp, true);
    target.removeEventListener('click', onClick, true);
  };
}
