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
 * otherwise be covered; only when no room is left does the bar start to shrink
 * (its width limit lives in CSS). The offset lands in `--bar-shift`, which the
 * bar applies as a relative offset: a transform would capture the fixed
 * tooltips opened inside it.
 */
export function useFloatingBarShift(container: RefObject<HTMLDivElement | null>): void {
  const leftDock = useUiStore((state) => state.leftDockOpen);
  const rightDock = useUiStore((state) => state.rightDockOpen);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const update = () => {
      const bar = element.firstElementChild;
      const workspace = element.closest('.workspace');
      if (!(bar instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return;
      // `--dock-left` and `--dock-right` are calc() expressions, which do not
      // parse as numbers; they mirror the width and gap read here.
      const style = getComputedStyle(workspace);
      const gap = pixels(style, '--dock-gap');
      const dockLeft = leftDock ? pixels(style, '--dock-left-width') + gap + INSET : 0;
      const dockRight = rightDock ? pixels(style, '--dock-right-width') + gap + INSET : 0;
      const width = window.innerWidth;
      const barWidth = bar.offsetWidth;
      const centred = (width - barWidth) / 2;
      const freeLeft = INSET + dockLeft;
      const freeRight = width - INSET - dockRight;
      // Push the bar off the dock first; it is the width limit in CSS that
      // starts shrinking it once the free space is gone.
      const left = Math.max(Math.min(centred, freeRight - barWidth), freeLeft);
      element.style.setProperty('--bar-shift', `${Math.round(left - centred)}px`);
    };

    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      if (element.firstElementChild) resize.observe(element.firstElementChild);
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
  }, [container, leftDock, rightDock]);
}
