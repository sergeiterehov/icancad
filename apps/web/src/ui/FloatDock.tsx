import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from './ContextMenu';

/** How long the pointer has to stay away before a panel slides off screen. */
const HIDE_DELAY = 1000;

// Automated UI tests move the pointer between panels, so auto-hide would take
// the target away between clicks.
function autoHideEnabled(): boolean {
  return typeof navigator === 'undefined' || !navigator.webdriver;
}

/**
 * A side panel that floats above the 3D view and slides out to an edge tab. The
 * panel comes back on hovering any part of the screen edge, on the tab itself or
 * on click; `pinned` keeps it open while its subject is selected.
 */
export function FloatDock({
  side,
  label,
  testId,
  pinned = false,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  testId?: string;
  pinned?: boolean;
  children: ReactNode;
}) {
  const open = useUiStore((state) => (side === 'left' ? state.leftDockOpen : state.rightDockOpen));
  const setOpen = useUiStore((state) =>
    side === 'left' ? state.setLeftDockOpen : state.setRightDockOpen,
  );
  const menuOpen = useContextMenuStore((state) => state.menu !== null);
  const timer = useRef<number | null>(null);
  const hovered = useRef(false);
  const wasPinned = useRef(pinned);
  // A context menu of the panel is drawn outside it, so the pointer leaves; the
  // panel has to wait for the menu instead of closing under it.
  const menuInside = useRef(false);
  const menuHolds = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel, setOpen]);

  const scheduleHide = useCallback(() => {
    cancel();
    if (pinned || menuHolds.current || !autoHideEnabled()) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, HIDE_DELAY);
  }, [cancel, pinned, setOpen]);

  const enter = useCallback(() => {
    hovered.current = true;
    show();
  }, [show]);

  const leave = useCallback(() => {
    hovered.current = false;
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => cancel, [cancel]);

  // A panel starts open, but it is only shown until the pointer is missed: left
  // alone, it slides away after the usual delay like any other panel.
  useEffect(() => {
    if (!hovered.current) scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (menuOpen) {
      if (!menuInside.current) return;
      menuInside.current = false;
      menuHolds.current = true;
      show();
      return;
    }
    if (!menuHolds.current) return;
    menuHolds.current = false;
    if (!hovered.current) scheduleHide();
  }, [menuOpen, show, scheduleHide]);

  // A pinned panel opens at once and stays open; once the selection goes away it
  // falls back to the usual auto-hide unless the pointer is still on it.
  useEffect(() => {
    const previous = wasPinned.current;
    wasPinned.current = pinned;
    if (pinned) {
      cancel();
      setOpen(true);
      return;
    }
    if (previous && !hovered.current) scheduleHide();
  }, [pinned, cancel, setOpen, scheduleHide]);

  return (
    <div className={`dock dock-${side}`} data-open={open ? 'true' : 'false'}>
      <div
        className="dock-trigger"
        aria-hidden="true"
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={() => setOpen(true)}
      />
      <aside
        className="dock-surface"
        aria-label={label}
        data-testid={testId}
        inert={!open}
        onContextMenuCapture={() => {
          menuInside.current = true;
        }}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocusCapture={show}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          scheduleHide();
        }}
      >
        {children}
      </aside>
      <button
        type="button"
        className="dock-tab"
        aria-label={label}
        aria-expanded={open}
        tabIndex={open ? -1 : 0}
        title={label}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={() => setOpen(!open)}
      >
        {side === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </div>
  );
}
