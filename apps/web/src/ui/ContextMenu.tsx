import clsx from 'clsx';
import { Check, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { isTouchPointer } from '../viewport/inputProfile';
import { installLongPressMenu } from './longPress';
import { menuPosition, submenuPosition } from './menuPlacement';
import { Tooltip } from './Tooltip';

export type ContextMenuItem =
  | { id: string; separator: true }
  | { id: string; heading: string }
  | {
      id: string;
      separator?: false;
      heading?: undefined;
      label: string;
      icon?: ReactNode;
      hint?: ReactNode;
      /** Long description shown in a tooltip while the item is hovered. */
      tooltip?: string;
      /** Overrides the visible label for assistive technology. */
      ariaLabel?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** Keeps the menu open, so a checked item can be switched again at once. */
      keepOpen?: boolean;
      /** A trailing icon action on the row, such as deleting a list entry. */
      action?: { label: string; icon: ReactNode; onSelect: () => void };
      onSelect: () => void;
    }
  | {
      id: string;
      separator?: false;
      heading?: undefined;
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      /** Nested items, opened by hovering or clicking this one. */
      submenu: ContextMenuItem[];
    }
  | {
      id: string;
      separator?: false;
      heading?: undefined;
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      /** Palette opened from this item, as a grid of swatches. */
      palette: readonly string[];
      value?: string;
      onPick: (color: string) => void;
    };

interface OpenMenu {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Who opened the menu; only that owner may replace its items in place. */
  owner?: string;
}

interface ContextMenuState {
  menu: OpenMenu | null;
  /** Bumped when a new menu opens, not when its items are replaced. */
  menuKey: number;
  open: (x: number, y: number, items: ContextMenuItem[], owner?: string) => void;
  /** Replaces the items of the open menu, keeping its position and submenu. */
  updateItems: (items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  menu: null,
  menuKey: 0,
  open: (x, y, items, owner) =>
    set((state) => ({
      menu: { x, y, items, ...(owner ? { owner } : {}) },
      menuKey: state.menuKey + 1,
    })),
  updateItems: (items) => set((state) => (state.menu ? { menu: { ...state.menu, items } } : state)),
  close: () => set({ menu: null }),
}));

export function showContextMenu(
  event: { clientX: number; clientY: number; preventDefault: () => void },
  items: ContextMenuItem[],
): void {
  if (items.length === 0) return;
  event.preventDefault();
  useContextMenuStore.getState().open(event.clientX, event.clientY, items);
}

/**
 * Opens a menu owned by a trigger, or closes it when that same trigger is
 * pressed again. Without the owner a press on the trigger would first close the
 * menu as an outside click and then open it again, so it could never be hidden.
 */
export function toggleContextMenu(
  owner: string,
  x: number,
  y: number,
  items: ContextMenuItem[],
): void {
  const store = useContextMenuStore.getState();
  if (store.menu?.owner === owner) {
    store.close();
    return;
  }
  if (items.length === 0) return;
  store.open(x, y, items, owner);
}

type MenuActionItem = Extract<ContextMenuItem, { onSelect: () => void }>;

/** Time a submenu survives after the pointer leaves it, so it can be crossed. */
const SUBMENU_CLOSE_DELAY = 260;

/**
 * A nested menu. It opens beside its row and stays inside the window, turning to
 * the roomier side when the row has no room on its own. It is fixed rather than
 * absolute, so the menu it belongs to can scroll without clipping it, and it
 * follows its row when that menu scrolls.
 */
function SubmenuPanel({
  label,
  row,
  children,
}: {
  label: string;
  row: HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const panel = ref.current;
    if (!panel || !row) return;
    const box = row.getBoundingClientRect();
    const next = submenuPosition(
      { left: box.left, right: box.right, top: box.top },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlacement((current) =>
      current && current.left === next.left && current.top === next.top ? current : next,
    );
  }, [row]);

  // Measured before the first paint, so the menu never shows on the wrong side.
  useLayoutEffect(place);

  // The menu this row belongs to can scroll, and then the row moves away.
  useEffect(() => {
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [place]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="context-menu context-submenu"
      style={placement ?? { left: -9999, top: -9999 }}
    >
      {children}
    </div>
  );
}

function MenuButton({ item, onSelect }: { item: MenuActionItem; onSelect: () => void }) {
  const close = useContextMenuStore((state) => state.close);
  // A checked row without an icon keeps the check in the icon column; a row
  // with an icon keeps it and shows the check on the trailing side.
  const checkInIcon = item.checked !== undefined && !item.icon;
  const button = (
    <button
      type="button"
      role="menuitem"
      aria-label={item.ariaLabel}
      disabled={item.disabled}
      className={clsx('context-menu-item', item.danger && 'danger')}
      onClick={() => {
        // A checked item is switched over and over, so its menu stays open.
        if (!item.keepOpen) close();
        onSelect();
      }}
    >
      {checkInIcon ? (
        <span className="context-menu-icon">{item.checked ? <Check size={14} /> : null}</span>
      ) : (
        item.icon && <span className="context-menu-icon">{item.icon}</span>
      )}
      <span className="context-menu-label">{item.label}</span>
      {item.hint && <span className="context-menu-hint">{item.hint}</span>}
      {!checkInIcon && item.checked && (
        <span className="context-menu-hint">
          <Check size={13} />
        </span>
      )}
    </button>
  );
  const entry = item.tooltip ? (
    <Tooltip content={item.tooltip} delay={600} className="context-menu-tip">
      {button}
    </Tooltip>
  ) : (
    button
  );
  if (!item.action) return entry;
  const action = item.action;
  return (
    <div className="context-menu-entry">
      {entry}
      <Tooltip content={action.label}>
        <button
          type="button"
          aria-label={action.label}
          className="context-menu-action"
          onClick={(event) => {
            event.stopPropagation();
            close();
            action.onSelect();
          }}
        >
          {action.icon}
        </button>
      </Tooltip>
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useContextMenuStore((state) => state.menu);
  const menuKey = useContextMenuStore((state) => state.menuKey);
  const close = useContextMenuStore((state) => state.close);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // The row a nested menu hangs from; a nested menu is fixed, so it cannot read
  // its own parent from the DOM the way an absolute one could.
  const submenuRow = useRef<HTMLElement | null>(null);
  const submenuTimer = useRef<number | null>(null);

  const cancelSubmenuClose = useCallback(() => {
    if (submenuTimer.current === null) return;
    window.clearTimeout(submenuTimer.current);
    submenuTimer.current = null;
  }, []);

  const openSub = useCallback(
    (id: string, row: HTMLElement | null) => {
      cancelSubmenuClose();
      if (row) submenuRow.current = row;
      setOpenSubmenu(id);
    },
    [cancelSubmenuClose],
  );

  // A finger cannot hover: it opens the submenu with the tap, and the click that
  // follows must not read an already open menu and close it again.
  const hoverOpensSub = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string) => {
      if (isTouchPointer(event.pointerType)) return;
      openSub(id, event.currentTarget);
    },
    [openSub],
  );

  useEffect(() => cancelSubmenuClose, [cancelSubmenuClose]);

  // The pointer leaves a submenu every time it crosses to the next one, so a
  // submenu goes away on its own instead of staying behind.
  const scheduleSubmenuClose = useCallback(() => {
    cancelSubmenuClose();
    submenuTimer.current = window.setTimeout(() => {
      submenuTimer.current = null;
      setOpenSubmenu(null);
    }, SUBMENU_CLOSE_DELAY);
  }, [cancelSubmenuClose]);

  const hoverLeavesRow = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (isTouchPointer(event.pointerType)) return;
      scheduleSubmenuClose();
    },
    [scheduleSubmenuClose],
  );

  // The host that draws a menu also makes a resting finger ask for one: the
  // gesture lives with the menus, so no control can forget to support it.
  useEffect(() => installLongPressMenu(), []);

  useEffect(() => {
    cancelSubmenuClose();
    setOpenSubmenu(null);
  }, [menuKey, cancelSubmenuClose]);

  const place = useCallback(() => {
    if (!menu) {
      setPosition(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(
      menuPosition(
        { left: menu.x, top: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [menu]);

  // Measured before the first paint, and again when the window turns or the
  // on-screen keyboard appears: a menu that fits before must fit after.
  useLayoutEffect(place, [place]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      // A nested menu is a menu too, wherever it is drawn: a press inside one
      // must not take the whole thing away before its row is pressed.
      const target = event.target as Element | null;
      if (target?.closest?.('[role="menu"]')) return;
      // The trigger that owns this menu toggles it itself: closing here first
      // would make a second press hide and show it again in one gesture.
      const trigger = target?.closest?.('[data-menu-trigger]');
      if (trigger && trigger.getAttribute('data-menu-trigger') === menu.owner) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + delta + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const handleDismiss = () => close();

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleDismiss);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('resize', place);
    };
  }, [menu, close, place]);

  useEffect(() => {
    if (menu) ref.current?.querySelector('button')?.focus();
  }, [menu]);

  if (!menu) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="context-menu"
      style={position ?? { left: -9999, top: -9999 }}
    >
      {menu.items.map((item) => {
        if ('separator' in item && item.separator) {
          return <div key={item.id} className="context-menu-separator" />;
        }
        if ('heading' in item) {
          return (
            <div key={item.id} className="context-menu-heading">
              {item.heading}
            </div>
          );
        }
        if ('palette' in item) {
          const palette = item.palette;
          return (
            <div
              key={item.id}
              className="context-menu-sub"
              onPointerEnter={(event) => hoverOpensSub(event, item.id)}
              onPointerLeave={hoverLeavesRow}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.id}
                disabled={item.disabled}
                className="context-menu-item"
                onClick={(event) => {
                  submenuRow.current = event.currentTarget.parentElement;
                  setOpenSubmenu(openSubmenu === item.id ? null : item.id);
                }}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                <span className="context-menu-label">{item.label}</span>
                <span className="context-menu-hint">
                  <ChevronRight size={13} />
                </span>
              </button>
              {openSubmenu === item.id && (
                <SubmenuPanel label={item.label} row={submenuRow.current}>
                  <div className="context-palette">
                    {palette.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="menuitemradio"
                        aria-checked={color === item.value}
                        aria-label={color}
                        className="context-palette-swatch"
                        data-active={color === item.value ? 'true' : undefined}
                        style={{ background: color }}
                        onClick={() => {
                          close();
                          item.onPick(color);
                        }}
                      />
                    ))}
                  </div>
                </SubmenuPanel>
              )}
            </div>
          );
        }
        if ('submenu' in item) {
          return (
            <div
              key={item.id}
              className="context-menu-sub"
              onPointerEnter={(event) => hoverOpensSub(event, item.id)}
              onPointerLeave={hoverLeavesRow}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.id}
                disabled={item.disabled}
                className="context-menu-item"
                onClick={(event) => {
                  submenuRow.current = event.currentTarget.parentElement;
                  setOpenSubmenu(openSubmenu === item.id ? null : item.id);
                }}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                <span className="context-menu-label">{item.label}</span>
                <span className="context-menu-hint">
                  <ChevronRight size={13} />
                </span>
              </button>
              {openSubmenu === item.id && (
                <SubmenuPanel label={item.label} row={submenuRow.current}>
                  {item.submenu.map((child) =>
                    'separator' in child && child.separator ? (
                      <div key={child.id} className="context-menu-separator" />
                    ) : 'heading' in child ? (
                      <div key={child.id} className="context-menu-heading">
                        {child.heading}
                      </div>
                    ) : 'onSelect' in child ? (
                      <MenuButton key={child.id} item={child} onSelect={child.onSelect} />
                    ) : null,
                  )}
                </SubmenuPanel>
              )}
            </div>
          );
        }
        return <MenuButton key={item.id} item={item} onSelect={item.onSelect} />;
      })}
    </div>,
    document.body,
  );
}
