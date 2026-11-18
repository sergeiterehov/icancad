import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';
import { BAR_EDGE_INSET, SHORT_LAYOUT_HEIGHT } from './barLayout';

function pixels(style: CSSStyleDeclaration, name: string): number {
  return Number.parseFloat(style.getPropertyValue(name)) || 0;
}

function overlaps(left: number, right: number, bar: DOMRect): boolean {
  return bar.width > 0 && bar.right > left && bar.left < right;
}

/**
 * Keeps a side panel out of the floating bars above and below it.
 *
 * The bars share the screen with the panels, and on a wide screen they usually
 * miss each other horizontally. When a bar does cross a panel's column, the
 * panel gives way from that edge instead of being painted over: it starts below
 * the top bar, or stops above the operations strip, and scrolls inside.
 *
 * A short screen has no height to spare for that, so there the panels span the
 * full column and the bars move aside as they always did.
 */
export function useDockClearance(active: boolean): void {
  const leftDock = useUiStore((state) => state.leftDockShown);
  const rightDock = useUiStore((state) => state.rightDockShown);

  useEffect(() => {
    if (!active) return;
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (!workspace) return;
    let timer = 0;

    const clear = () => {
      workspace.style.removeProperty('--dock-left-top');
      workspace.style.removeProperty('--dock-left-bottom');
      workspace.style.removeProperty('--dock-right-top');
      workspace.style.removeProperty('--dock-right-bottom');
    };

    const apply = () => {
      if (window.innerHeight < SHORT_LAYOUT_HEIGHT) {
        clear();
        return;
      }
      const style = getComputedStyle(workspace);
      const gap = pixels(style, '--dock-gap');
      const baseTop = gap;
      const baseLeftTop = pixels(style, '--dock-top');
      const frameRect = workspace.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const leftWidth = Math.min(
        pixels(style, '--dock-left-width'),
        Math.max(0, width - 2 * gap),
      );
      const rightWidth = Math.min(
        pixels(style, '--dock-right-width'),
        Math.max(0, width - 2 * gap),
      );
      const leftFrom = gap;
      const leftTo = gap + leftWidth;
      const rightTo = width - gap;
      const rightFrom = rightTo - rightWidth;

      const topBar = workspace
        .querySelector<HTMLElement>('.tool-dock')
        ?.firstElementChild?.getBoundingClientRect();
      const bottomBar = workspace
        .querySelector<HTMLElement>('.operations-dock')
        ?.firstElementChild?.getBoundingClientRect();

      let leftTop = baseLeftTop;
      let rightTop = baseTop;
      if (topBar) {
        const below = topBar.bottom - frameRect.top + BAR_EDGE_INSET;
        if (overlaps(leftFrom, leftTo, topBar)) leftTop = Math.max(leftTop, below);
        if (overlaps(rightFrom, rightTo, topBar)) rightTop = Math.max(rightTop, below);
      }

      let leftBottom = gap;
      let rightBottom = gap;
      if (bottomBar) {
        const above = frameRect.bottom - bottomBar.top + BAR_EDGE_INSET;
        if (overlaps(leftFrom, leftTo, bottomBar)) leftBottom = Math.max(leftBottom, above);
        if (overlaps(rightFrom, rightTo, bottomBar)) rightBottom = Math.max(rightBottom, above);
      }

      workspace.style.setProperty('--dock-left-top', `${Math.round(leftTop)}px`);
      workspace.style.setProperty('--dock-left-bottom', `${Math.round(leftBottom)}px`);
      workspace.style.setProperty('--dock-right-top', `${Math.round(rightTop)}px`);
      workspace.style.setProperty('--dock-right-bottom', `${Math.round(rightBottom)}px`);
    };

    // A timeout, not an animation frame: the variables are read by layout, and a
    // background tab still has to lay itself out when it comes back.
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 0);
    };

    const resize = new ResizeObserver(schedule);
    const containers = [
      workspace,
      ...workspace.querySelectorAll<HTMLElement>('.tool-dock, .operations-dock'),
    ];
    for (const container of containers) {
      resize.observe(container);
      if (container.firstElementChild) resize.observe(container.firstElementChild);
    }
    // The bars are shifted by their own hook through an inline style; that move
    // changes which panel columns they cross.
    const attributes = new MutationObserver(schedule);
    for (const container of containers.slice(1)) {
      attributes.observe(container, { attributes: true, attributeFilter: ['style'] });
    }
    const children = new MutationObserver(schedule);
    for (const container of containers.slice(1)) {
      children.observe(container, { childList: true });
    }
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      window.clearTimeout(timer);
      resize.disconnect();
      attributes.disconnect();
      children.disconnect();
      window.removeEventListener('resize', schedule);
      clear();
    };
  }, [active, leftDock, rightDock]);
}
