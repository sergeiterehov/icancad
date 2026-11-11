import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

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
      /** Overrides the visible label for assistive technology. */
      ariaLabel?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    };

interface OpenMenu {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuState {
  menu: OpenMenu | null;
  open: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
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

export function ContextMenuHost() {
  const menu = useContextMenuStore((state) => state.menu);
  const close = useContextMenuStore((state) => state.close);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

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
      {menu.items.map((item) =>
        'separator' in item && item.separator ? (
          <div key={item.id} className="context-menu-separator" />
        ) : 'heading' in item ? (
          <div key={item.id} className="context-menu-heading">
            {item.heading}
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            className={clsx('context-menu-item', item.danger && 'danger')}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            {item.checked !== undefined ? (
              <span className="context-menu-icon">{item.checked ? <Check size={14} /> : null}</span>
            ) : (
              item.icon && <span className="context-menu-icon">{item.icon}</span>
            )}
            <span className="context-menu-label">{item.label}</span>
            {item.hint && <span className="context-menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
