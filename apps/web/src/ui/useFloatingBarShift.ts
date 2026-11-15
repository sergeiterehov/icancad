import { useEffect, type RefObject } from 'react';
import { useUiStore } from '../stores/uiStore';

/** Breathing room the layout keeps between a dock and the bars. */
const INSET = 8;

function pixels(style: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(style.getPropertyValue(name)) || 0;
}

/**
 * A floating bar stays centred in the window. A side dock that reaches it
 * pushes it just as far as it has to, so the bars only move when they would
 * otherwise be covered; only when no room is left does the bar start to shrink,
 * and the width it may take lands in `--bar-max`. The offset lands in
 * `--bar-shift`, which the bar applies as a relative offset: a transform would
 * capture the fixed tooltips opened inside it.
 *
 * Panels are as tall as their content, so a dock only stands in a bar's way
 * when the two also meet vertically: a short model panel leaves the operations
 * strip alone even though the strip crosses its column. Both the panels and the
 * bar are watched, because the content changes while the app runs.
 */
export function useFloatingBarShift(
  container: RefObject<HTMLDivElement | null>,
  /** The shell is up: before that the bars and the docks are not in the DOM. */
  active: boolean,
): void {
  const leftDock = useUiStore((state) => state.leftDockOpen);
  const rightDock = useUiStore((state) => state.rightDockOpen);

  useEffect(() => {
    const element = container.current;
    if (!active || !element) return;
    const workspace = element.closest('.workspace');
    if (!(workspace instanceof HTMLElement)) return;
    const surfaces = {
      left: workspace.querySelector('.dock-left .dock-surface'),
      right: workspace.querySelector('.dock-right .dock-surface'),
    };

    const update = () => {
      const bar = element.firstElementChild;
      if (!(bar instanceof HTMLElement)) return;
      // `--dock-left` and `--dock-right` are calc() expressions, which do not
      // parse as numbers; they mirror the width and gap read here.
      const style = getComputedStyle(workspace);
      const gap = pixels(style, '--dock-gap');
      const width = window.innerWidth;
      // The row is read from the container, which does not move with the shift.
      const row = element.getBoundingClientRect();

      const reach = (side: 'left' | 'right', open: boolean) => {
        if (!open) return 0;
        const surface = surfaces[side];
        if (!(surface instanceof HTMLElement)) return 0;
        // Panels animate sideways but never vertically, so a panel that misses
        // the row leaves the bar where it is.
        const panel = surface.getBoundingClientRect();
        if (row.top >= panel.bottom || row.bottom <= panel.top) return 0;
        const widthName = side === 'left' ? '--dock-left-width' : '--dock-right-width';
        return pixels(style, widthName) + gap + INSET;
      };

      const freeLeft = INSET + reach('left', leftDock);
      const freeRight = width - INSET - reach('right', rightDock);
      const barWidth = bar.offsetWidth;
      const centred = (width - barWidth) / 2;
      // Push the bar off the dock first; the width limit starts shrinking it
      // only once the free space is gone.
      const left = Math.max(Math.min(centred, freeRight - barWidth), freeLeft);
      element.style.setProperty('--bar-shift', `${Math.round(left - centred)}px`);
      element.style.setProperty('--bar-max', `${Math.max(0, freeRight - freeLeft)}px`);
    };

    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      if (element.firstElementChild) resize.observe(element.firstElementChild);
      for (const surface of Object.values(surfaces)) {
        if (surface) resize.observe(surface);
      }
      update();
    };
    const children = new MutationObserver(observe);
    children.observe(element, { childList: true });
    observe();
    window.addEventListener('resize', update);
    return () => {
      resize.disconnect();
      children.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [container, active, leftDock, rightDock]);
}
