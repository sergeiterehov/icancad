import clsx from 'clsx';
import { Check, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
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

type MenuActionItem = Extract<ContextMenuItem, { onSelect: () => void }>;

/** Time a submenu survives after the pointer leaves it, so it can be crossed. */
const SUBMENU_CLOSE_DELAY = 260;

/** Room a menu keeps between itself and the edge of the window. */
const EDGE_MARGIN = 8;

/**
 * A nested menu. It opens beside its row, and turns to the other side of the row
 * when the window has no room there: the row can sit anywhere, including the
 * right edge, where the nav cube opens its menu. It also steps up when its list
 * would reach below the window.
 */
function SubmenuPanel({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  // Measured before the first paint, so the menu never shows on the wrong side.
  useLayoutEffect(() => {
    const panel = ref.current;
    const row = panel?.parentElement;
    if (!panel || !row) return;
    const rowBox = row.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // Beside the row while there is room, on the roomier side when there is not,
    // and inside the window either way: the row can sit anywhere.
    const roomRight = window.innerWidth - rowBox.right - EDGE_MARGIN;
    const roomLeft = rowBox.left - EDGE_MARGIN;
    const beside =
      width > roomRight && roomLeft > roomRight ? rowBox.left - 4 - width : rowBox.right + 4;
    const left = Math.max(
      EDGE_MARGIN,
      Math.min(beside, window.innerWidth - EDGE_MARGIN - width),
    );
    const top = Math.max(
      EDGE_MARGIN,
      Math.min(rowBox.top - 5, window.innerHeight - EDGE_MARGIN - height),
    );
    const next = {
      left: Math.round(left - rowBox.left),
      top: Math.round(top - rowBox.top),
    };
    setPlacement((current) =>
      current && current.left === next.left && current.top === next.top ? current : next,
    );
  });

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="context-menu context-submenu"
      style={placement ?? undefined}
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
  const submenuTimer = useRef<number | null>(null);

  const cancelSubmenuClose = useCallback(() => {
    if (submenuTimer.current === null) return;
    window.clearTimeout(submenuTimer.current);
    submenuTimer.current = null;
  }, []);

  const openSub = useCallback(
    (id: string) => {
      cancelSubmenuClose();
      setOpenSubmenu(id);
    },
    [cancelSubmenuClose],
  );

  // The pointer leaves a submenu every time it crosses to the next one, so a
  // submenu goes away on its own instead of staying behind.
  const scheduleSubmenuClose = useCallback(() => {
    cancelSubmenuClose();
    submenuTimer.current = window.setTimeout(() => {
      submenuTimer.current = null;
      setOpenSubmenu(null);
    }, SUBMENU_CLOSE_DELAY);
  }, [cancelSubmenuClose]);

  useEffect(() => cancelSubmenuClose, [cancelSubmenuClose]);

  useEffect(() => {
    cancelSubmenuClose();
    setOpenSubmenu(null);
  }, [menuKey, cancelSubmenuClose]);

  useLayoutEffect(() => {
    if (!menu) {
      setPosition(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const left = Math.max(margin, Math.min(menu.x, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(menu.y, window.innerHeight - rect.height - margin));
    setPosition({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
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
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [menu, close]);

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
              onPointerEnter={() => openSub(item.id)}
              onPointerLeave={scheduleSubmenuClose}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.id}
                disabled={item.disabled}
                className="context-menu-item"
                onClick={() => setOpenSubmenu(openSubmenu === item.id ? null : item.id)}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                <span className="context-menu-label">{item.label}</span>
                <span className="context-menu-hint">
                  <ChevronRight size={13} />
                </span>
              </button>
              {openSubmenu === item.id && (
                <SubmenuPanel label={item.label}>
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
              onPointerEnter={() => openSub(item.id)}
              onPointerLeave={scheduleSubmenuClose}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.id}
                disabled={item.disabled}
                className="context-menu-item"
                onClick={() => setOpenSubmenu(openSubmenu === item.id ? null : item.id)}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                <span className="context-menu-label">{item.label}</span>
                <span className="context-menu-hint">
                  <ChevronRight size={13} />
                </span>
              </button>
              {openSubmenu === item.id && (
                <SubmenuPanel label={item.label}>
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
