import { useEffect, useRef, type RefObject } from 'react';
import { useUiStore } from '../stores/uiStore';

/** Breathing room the layout keeps between a dock and the bars. */
const INSET = 8;

/** The corner gives way in two steps before the bar loses any room. */
export type MarkSqueeze = 0 | 1 | 2;

function pixels(style: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(style.getPropertyValue(name)) || 0;
}

/** The corner block, as it stands while nothing of it is hidden. */
interface WholeMark {
  /** Where the block ends, and where the bar may start after it. */
  right: number;
  /** Room the project name and the rule before it take. */
  name: number;
  /** Room the product name takes. */
  brand: number;
}

/** What the whole corner takes, measured before any of it is given up. */
function measureMark(mark: HTMLElement): WholeMark {
  const gap = pixels(getComputedStyle(mark), 'gap');
  const separator = mark.querySelector<HTMLElement>('.project-separator');
  const name = mark.querySelector<HTMLElement>('.project-name');
  const button = mark.querySelector<HTMLElement>('.project-button');
  const brand = mark.querySelector<HTMLElement>('.brand-name');
  const brandGap = button ? pixels(getComputedStyle(button), 'gap') : 0;
  return {
    right: mark.getBoundingClientRect().right,
    // Hiding two children of a flex row also takes the two gaps around them.
    name: (separator?.offsetWidth ?? 0) + (name?.offsetWidth ?? 0) + 2 * gap,
    brand: brand ? brand.offsetWidth + brandGap : 0,
  };
}

/**
 * How much of the corner the bar needs. The bar keeps the work row and the
 * corner gives way, in order: the project name and the rule before it, then the
 * product name, and only then does the bar start to shrink against the mark,
 * which cannot give way at all — the mark is the app.
 */
export function markSqueeze(centred: number, mark: WholeMark, inset = INSET): MarkSqueeze {
  // The deepest step first: a bar that needs more than the name is also
  // pressed against the mark, and asking the near question first would answer
  // for the whole.
  if (centred < mark.right - mark.name + inset) return 2;
  if (centred < mark.right + inset) return 1;
  return 0;
}

/** Where the bar may start once the corner is squeezed that far. */
export function markEdge(squeeze: MarkSqueeze, mark: WholeMark, inset = INSET): number {
  if (squeeze < 2) return 0;
  return mark.right - mark.name - mark.brand + inset;
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
 *
 * The corner of the row holds the project mark, and it gives way before the bar
 * does: the project name and its rule go, then the product name, and the mark
 * stays. Only with the mark alone beside it does the bar start to shrink, which
 * is what keeps the sketch tools reachable on a small tablet.
 */
export function useFloatingBarShift(
  container: RefObject<HTMLDivElement | null>,
  /** The shell is up: before that the bars and the docks are not in the DOM. */
  active: boolean,
): void {
  const leftDock = useUiStore((state) => state.leftDockOpen);
  const rightDock = useUiStore((state) => state.rightDockOpen);
  // The corner is measured while it is whole, and the numbers outlive the
  // effects that come and go with the panels: once part of it is hidden, it can
  // no longer say how wide it was.
  const wholeMark = useRef<WholeMark | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!active || !element) return;
    const workspace = element.closest('.workspace');
    if (!(workspace instanceof HTMLElement)) return;
    const anchor = workspace.querySelector<HTMLElement>('.project-anchor');

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
        // A panel is asked for now rather than remembered: it exists only while
        // it is open, and this runs before it has been put on the page.
        const surface = workspace.querySelector(`.dock-${side} .dock-surface`);
        if (!(surface instanceof HTMLElement)) return 0;
        // Panels animate sideways but never vertically, so a panel that misses
        // the row leaves the bar where it is.
        const panel = surface.getBoundingClientRect();
        if (row.top >= panel.bottom || row.bottom <= panel.top) return 0;
        const widthName = side === 'left' ? '--dock-left-width' : '--dock-right-width';
        return pixels(style, widthName) + gap + INSET;
      };

      const freeRight = width - INSET - reach('right', rightDock);
      const dockLeft = INSET + reach('left', leftDock);
      const barWidth = bar.offsetWidth;
      // The whole strip of tools, before any limit is put on it.
      const natural = bar.scrollWidth || barWidth;
      const centred = (width - natural) / 2;

      // The corner only matters to the bar that shares its row: the strip on the
      // top edge. The operations bar is at the bottom, so it says nothing about
      // the corner at all, or it would undo what the strip decides.
      const meetsMark = anchor ? row.top < anchor.getBoundingClientRect().bottom : false;
      let markLeft = 0;
      if (anchor && meetsMark) {
        if (!wholeMark.current && !anchor.dataset.squeeze) {
          wholeMark.current = measureMark(anchor);
        }
        const squeeze: MarkSqueeze = wholeMark.current
          ? markSqueeze(centred, wholeMark.current)
          : 0;
        if ((anchor.dataset.squeeze ?? '') !== (squeeze ? String(squeeze) : '')) {
          if (squeeze) anchor.dataset.squeeze = String(squeeze);
          else delete anchor.dataset.squeeze;
        }
        if (wholeMark.current) markLeft = markEdge(squeeze, wholeMark.current);
      }

      const freeLeft = Math.max(dockLeft, markLeft);
      // Push the bar off the docks and off the mark first; the width limit
      // starts shrinking it only once the free space is gone.
      const left = Math.max(Math.min(centred, freeRight - barWidth), freeLeft);
      element.style.setProperty('--bar-shift', `${Math.round(left - centred)}px`);
      element.style.setProperty('--bar-max', `${Math.max(0, freeRight - freeLeft)}px`);
    };

    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      if (element.firstElementChild) resize.observe(element.firstElementChild);
      // The docks are watched whole, because the panels inside them come and go.
      for (const dock of workspace.querySelectorAll('.dock')) {
        resize.observe(dock);
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
