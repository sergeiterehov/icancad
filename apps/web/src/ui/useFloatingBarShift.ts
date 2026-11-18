import { useEffect, useRef, type RefObject } from 'react';
import { useUiStore } from '../stores/uiStore';
import { BAR_EDGE_INSET, SHORT_LAYOUT_HEIGHT } from './barLayout';

function pixels(style: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(style.getPropertyValue(name)) || 0;
}

/** The corner gives way in two steps before the bar loses any room. */
export type MarkSqueeze = 0 | 1 | 2;

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
 *
 * `wantedLeft` is where the bar would start if the corner were not there, so a
 * bar pushed left by a dock squeezes the corner just as a wide bar does.
 */
export function markSqueeze(
  wantedLeft: number,
  mark: WholeMark,
  inset = BAR_EDGE_INSET,
): MarkSqueeze {
  // The deepest step first: a bar that needs more than the name is also
  // pressed against the mark, and asking the near question first would answer
  // for the whole.
  if (wantedLeft < mark.right - mark.name + inset) return 2;
  if (wantedLeft < mark.right + inset) return 1;
  return 0;
}

/** Where the bar may start once the corner is squeezed that far. */
export function markEdge(squeeze: MarkSqueeze, mark: WholeMark, inset = BAR_EDGE_INSET): number {
  if (squeeze < 2) return 0;
  return mark.right - mark.name - mark.brand + inset;
}

/**
 * A floating bar stays centred in the window. The corner of the top row gives
 * way before the bar does: the project name and its rule go, then the product
 * name, and the mark stays. Only with the mark alone beside it does the bar
 * start to shrink, which is what keeps the sketch tools reachable on a small
 * tablet.
 *
 * On a tall screen the side docks keep clear of the bars vertically (see
 * {@link useDockClearance}), so the bars ignore them. A short screen has no
 * room for that: there the bar moves sideways off a dock, as before.
 *
 * The offset lands in `--bar-shift`, which the bar applies as a relative
 * offset: a transform would capture the fixed tooltips opened inside it.
 */
export function useFloatingBarShift(
  container: RefObject<HTMLDivElement | null>,
  /** The shell is up: before that the bars and the docks are not in the DOM. */
  active: boolean,
): void {
  const leftDock = useUiStore((state) => state.leftDockShown);
  const rightDock = useUiStore((state) => state.rightDockShown);
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
      const width = document.documentElement.clientWidth || window.innerWidth;
      // A tall screen keeps the docks below the bars instead (useDockClearance);
      // only a short one still needs the bars to move sideways.
      const short = window.innerHeight < SHORT_LAYOUT_HEIGHT;
      // The row is read from the container, which does not move with the shift.
      const row = element.getBoundingClientRect();

      const reach = (side: 'left' | 'right', open: boolean) => {
        if (!short || !open) return 0;
        // A panel is asked for now rather than remembered: it exists only while
        // it is open, and this runs before it has been put on the page.
        const surface = workspace.querySelector(`.dock-${side} .dock-surface`);
        if (!(surface instanceof HTMLElement)) return 0;
        // Panels animate sideways but never vertically, so a panel that misses
        // the row leaves the bar where it is.
        const panel = surface.getBoundingClientRect();
        if (row.top >= panel.bottom || row.bottom <= panel.top) return 0;
        const widthName = side === 'left' ? '--dock-left-width' : '--dock-right-width';
        return pixels(style, widthName) + gap + BAR_EDGE_INSET;
      };

      const freeRight = width - BAR_EDGE_INSET - reach('right', rightDock);
      const dockLeft = BAR_EDGE_INSET + reach('left', leftDock);
      // The whole strip of tools, before any limit is put on it.
      const natural = Math.max(bar.scrollWidth, bar.offsetWidth);
      const centred = (width - natural) / 2;
      // Where the bar would start if neither the corner nor a width limit moved
      // it. This is what decides how much of the corner has to go, so a bar
      // pushed left by a dock squeezes the logo instead of running under it.
      const wanted = Math.min(centred, freeRight - natural);

      // The corner only matters to the bar that shares its row: the strip on the
      // top edge. The operations bar is at the bottom, so it says nothing about
      // the corner at all, or it would undo what the strip decides.
      const meetsMark = anchor ? row.top < anchor.getBoundingClientRect().bottom : false;
      let markLeft = 0;
      if (anchor && meetsMark) {
        if (!wholeMark.current && !anchor.dataset.squeeze) {
          wholeMark.current = measureMark(anchor);
        }
        const squeeze: MarkSqueeze = wholeMark.current ? markSqueeze(wanted, wholeMark.current) : 0;
        if ((anchor.dataset.squeeze ?? '') !== (squeeze ? String(squeeze) : '')) {
          if (squeeze) anchor.dataset.squeeze = String(squeeze);
          else delete anchor.dataset.squeeze;
        }
        if (wholeMark.current) markLeft = markEdge(squeeze, wholeMark.current);
      }

      const freeLeft = Math.max(dockLeft, markLeft);
      // The bar is laid out inside `--bar-max`, so the edge it aims for has to
      // be measured with the width that limit leaves, not the natural one.
      const shown = Math.min(natural, Math.max(0, freeRight - freeLeft));
      const left = Math.max(Math.min(wanted, freeRight - shown), freeLeft);
      // `left` is a relative offset from where centring puts the limited bar;
      // deriving it from the natural width would count the limit twice.
      const flexLeft = (width - shown) / 2;
      element.style.setProperty('--bar-shift', `${Math.round(left - flexLeft)}px`);
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
