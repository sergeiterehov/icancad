import { useEffect } from 'react';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from '../ui/ContextMenu';

/** Apple keyboards name their modifiers differently; hints follow the keyboard. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Modifier shown in tooltips: ⌘ on Apple platforms, Ctrl everywhere else. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl+';

/** The key next to the space bar: ⌥ on an Apple keyboard, Alt everywhere else. */
export const ALT_KEY = IS_MAC ? '⌥' : 'Alt';

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
        // One picker serves every operation, so Escape leaves it wherever it
        // was opened from.
        if (
          ui.pickingExtrude ||
          ui.pickingExtrudeBodies ||
          ui.pickingEdges ||
          ui.pickingShellBodies ||
          ui.pickingShellFaces ||
          ui.pickingBooleanBodies ||
          ui.pickingBooleanTools ||
          ui.pickingSketchPlane ||
          ui.pickingSectionFace ||
          ui.pickingExtrudeToBody
        ) {
          event.preventDefault();
          ui.endPicking();
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
