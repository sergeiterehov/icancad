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
 * The orientation cube rests in the bottom-right corner. Two things can reach
 * it: the operations panel, which grows towards it as operations are added, and
 * the inspector, which owns that corner. Both only move the cube where they
 * would actually cover it — a compact inspector that ends above the cube leaves
 * it at the screen edge, and a panel that misses the cube's row changes nothing.
 */
export function useNavCubeLift(nav: RefObject<HTMLDivElement | null>): void {
  // The inspector is on screen, which includes the moment it unfolds for the
  // operation the user selected: the cube has to give way then as well.
  const rightDock = useUiStore((state) => state.rightDockShown);

  useEffect(() => {
    const element = nav.current;
    const workspace = element?.closest('.workspace');
    const dock = workspace?.querySelector('.operations-dock');
    const panel = dock?.querySelector('.timeline-panel');
    const inspector = workspace?.querySelector('.dock-right .dock-surface');
    if (!element || !(workspace instanceof HTMLElement)) return;
    if (!(dock instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;

    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Everything is read from layout, never from a rect: the cube and the panel
      // both animate, and a half-way measurement would stick.
      const style = getComputedStyle(workspace);
      const gap = pixels(style, '--dock-gap');
      const inspectorWidth = pixels(style, '--dock-right-width') + gap + INSET;
      const size = element.offsetWidth;
      const cubeTop = height - BOTTOM - element.offsetHeight;

      // The inspector takes the corner only where it is: a panel that stops above
      // the cube leaves it in place.
      const sidebar =
        inspector instanceof HTMLElement ? inspector.getBoundingClientRect().bottom : 0;
      const dockReaches = rightDock && sidebar + GAP > cubeTop;
      const inset = dockReaches ? inspectorWidth : 0;
      workspace.style.setProperty('--nav-right', `${Math.round(inset)}px`);

      const navRight = width - inset - RIGHT;
      const navLeft = navRight - size;

      const shift = Number.parseFloat(dock.style.getPropertyValue('--bar-shift')) || 0;
      const panelWidth = panel.offsetWidth;
      const panelLeft = width / 2 + shift - panelWidth / 2;
      const panelRight = panelLeft + panelWidth;
      const panelTop = height - gap - panel.offsetHeight;

      const overlaps = navLeft < panelRight + GAP && navRight > panelLeft - GAP;
      const lift = overlaps ? Math.max(0, height - BOTTOM - (panelTop - GAP)) : 0;
      // On the workspace: the cube inherits it, and so does the dock edge that
      // has to stay clear of the cube.
      workspace.style.setProperty('--nav-lift', `${Math.round(lift)}px`);
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
    // A compact inspector changes height with its content, and that decides
    // whether it stands in the cube's way.
    if (inspector) resize.observe(inspector);
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
