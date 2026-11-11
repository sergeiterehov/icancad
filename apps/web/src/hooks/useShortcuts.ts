import { useEffect } from 'react';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from '../ui/ContextMenu';

/** Modifier shown in tooltips: ⌘ on Apple platforms, Ctrl everywhere else. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Document-wide shortcuts: undo, redo and Escape. The sketch editor, the context
 * menu and the delete dialog own Escape while they are open, and text fields
 * keep the browser's own editing history.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (event.key === 'Escape') {
        const ui = useUiStore.getState();
        if (ui.activeSketchId || useContextMenuStore.getState().menu) return;
        if (ui.deleteRequest) {
          ui.cancelDelete();
          return;
        }
        const store = useDocumentStore.getState();
        if (store.selection.length === 0 && store.editingFeatureId === null) return;
        event.preventDefault();
        store.select(null);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useDocumentStore.getState().undo();
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        useDocumentStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
