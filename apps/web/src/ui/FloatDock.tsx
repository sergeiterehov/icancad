import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';
import { isTouchPointer } from '../viewport/inputProfile';

/** How long a panel shows itself at start before it tucks away. */
export const STARTUP_TUCK_MS = 1000;

/**
 * A side panel that floats above the 3D view and slides out to an edge tab.
 *
 * A panel has two states. Its own is what the user left it in: opened on the
 * edge it lives behind or on its tab, and closed only by that tab, so nothing
 * under the hand can take it away. The other is the state its subject asks for:
 * while something on screen needs the panel — the inspector and the parameters
 * of the operation being edited — that state rules, and it starts unfolded. The
 * panel's own state is not touched meanwhile, so it is exactly as the user left
 * it once the subject is gone.
 *
 * The one planned move is at the very start: a panel is open so the workspace
 * shows what it has, and it tucks itself away a moment later on every device, so
 * the model keeps the screen. Anything the user does with the panel cancels
 * that, and afterwards nothing closes it but the tab.
 */
export function FloatDock({
  side,
  label,
  testId,
  pinned = null,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  testId?: string;
  /**
   * What on screen needs this panel, if anything. It unfolds the panel and rules
   * over its own state; a different subject unfolds it again.
   */
  pinned?: string | null;
  children: ReactNode;
}) {
  const open = useUiStore((state) => (side === 'left' ? state.leftDockOpen : state.rightDockOpen));
  const setOpen = useUiStore((state) =>
    side === 'left' ? state.setLeftDockOpen : state.setRightDockOpen,
  );
  // Set the moment the user works the panel, so the start-up tuck below leaves it
  // alone from then on.
  const touched = useRef(false);
  // The subject's own state, unfolded by default. It does not outlive the
  // subject: the next one arrives unfolded as well.
  const [subjectOpen, setSubjectOpen] = useState(true);
  useEffect(() => {
    if (pinned) setSubjectOpen(true);
  }, [pinned]);

  const held = pinned !== null;
  const shown = held ? subjectOpen : open;

  const show = useCallback(() => {
    touched.current = true;
    if (held) setSubjectOpen(true);
    else setOpen(true);
  }, [held, setOpen]);

  const toggle = useCallback(() => {
    touched.current = true;
    if (held) setSubjectOpen((current) => !current);
    else setOpen(!open);
  }, [held, open, setOpen]);

  // The panel shows itself at start and tucks away once, a moment later: an
  // open panel at launch is an invitation, not a state the user chose. A hand on
  // the panel cancels the timer, and the tab is the only thing that closes a
  // panel afterwards.
  //
  // The clock starts only after the open panel has been painted: on a slow
  // device the kernel and the shaders keep the main thread busy for seconds, and
  // a collapse set before the first frame of the panel would have nothing to
  // animate from — it would simply not be there.
  useEffect(() => {
    let timer: number | null = null;
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          timer = null;
          if (!touched.current) setOpen(false);
        }, STARTUP_TUCK_MS);
      });
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [setOpen]);

  return (
    <div className={`dock dock-${side}`} data-open={shown ? 'true' : 'false'}>
      <div
        className="dock-trigger"
        aria-hidden="true"
        onPointerEnter={(event) => {
          if (!isTouchPointer(event.pointerType)) show();
        }}
        onClick={show}
      />
      <aside
        className="dock-surface"
        aria-label={label}
        data-testid={testId}
        inert={!shown}
        onPointerEnter={(event) => {
          if (!isTouchPointer(event.pointerType)) show();
        }}
        onFocusCapture={show}
      >
        {children}
      </aside>
      <button
        type="button"
        className="dock-tab"
        aria-label={label}
        aria-expanded={shown}
        title={label}
        onClick={toggle}
      >
        {side === 'left' ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </div>
  );
}
