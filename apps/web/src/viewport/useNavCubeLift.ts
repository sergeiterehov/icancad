import { useEffect, type RefObject } from 'react';
import { useUiStore } from '../stores/uiStore';

/** Space kept between the operations panel and the cube above it. */
const GAP = 12;
/** Resting distance from the bottom of the window. */
const BOTTOM = 24;
/** Distance from the inspector, mirrored from `.viewport-nav` in the stylesheet. */
const RIGHT = 14;
const INSET = 8;

function pixels(style: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(style.getPropertyValue(name)) || 0;
}

/**
 * The orientation cube rests in the bottom-right corner. The operations panel
 * grows towards it as operations are added, so a cube the panel would cover
 * steps above the panel instead of disappearing under it.
 */
export function useNavCubeLift(nav: RefObject<HTMLDivElement | null>): void {
  // Opening the inspector moves the cube left, which changes what it meets.
  const rightDock = useUiStore((state) => state.rightDockOpen);

  useEffect(() => {
    const element = nav.current;
    const workspace = element?.closest('.workspace');
    const dock = workspace?.querySelector('.operations-dock');
    const panel = dock?.querySelector('.timeline-panel');
    if (!element || !workspace || !(dock instanceof HTMLElement) || !(panel instanceof HTMLElement))
      return;

    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Everything is read from layout, never from a rect: the cube and the panel
      // both animate, and a half-way measurement would stick.
      const style = getComputedStyle(workspace);
      const gap = pixels(style, '--dock-gap');
      const inspector = rightDock ? pixels(style, '--dock-right-width') + gap + INSET : 0;
      const navRight = width - inspector - RIGHT;
      const navLeft = navRight - element.offsetWidth;

      const shift = Number.parseFloat(dock.style.getPropertyValue('--bar-shift')) || 0;
      const panelWidth = panel.offsetWidth;
      const panelLeft = width / 2 + shift - panelWidth / 2;
      const panelRight = panelLeft + panelWidth;
      const panelTop = height - gap - panel.offsetHeight;

      const overlaps = navLeft < panelRight + GAP && navRight > panelLeft - GAP;
      const lift = overlaps ? Math.max(0, height - BOTTOM - (panelTop - GAP)) : 0;
      element.style.setProperty('--nav-lift', `${Math.round(lift)}px`);
    };

    // Observers report before the next layout in some browsers, so the measure
    // waits for the style and the panel width to settle.
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 0);
    };

    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    resize.observe(panel);
    const style = new MutationObserver(schedule);
    style.observe(dock, { attributes: true, attributeFilter: ['style'] });
    update();
    window.addEventListener('resize', schedule);
    return () => {
      window.clearTimeout(timer);
      resize.disconnect();
      style.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [nav, rightDock]);
}
