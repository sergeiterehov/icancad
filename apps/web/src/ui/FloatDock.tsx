import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';
import { lastPointerType, primaryInputProfile } from '../viewport/inputProfile';
import { useContextMenuStore } from './ContextMenu';
import { closesOnLeave, dockHand, opensOnHover, showsTab, type DockHand } from './dockGesture';

/** How long a panel shows itself at start before it tucks away. */
export const STARTUP_TUCK_MS = 1000;

/**
 * A side panel that floats above the 3D view and slides out to an edge tab.
 *
 * The panel is worked in one of two ways, because the hands are two. A cursor
 * opens it by coming to its edge or its tongue and gives it back by leaving, so
 * an open panel carries no way out. A finger cannot hover and cannot leave, so
 * for it the tongue is the control: it opens the panel and it is the only thing
 * that closes it, which keeps a panel from vanishing under the hand that works
 * in it.
 *
 * A panel has two states besides that. Its own is what the user left it in. The
 * other is the state its subject asks for: while something on screen needs the
 * panel — the inspector and the parameters of the operation being edited — that
 * state rules, and it starts unfolded. The panel's own state is not touched
 * meanwhile, so it is exactly as the user left it once the subject is gone. A
 * subject also keeps the panel under a cursor, because a form is read, not
 * passed by.
 *
 * The one planned move is at the very start: a panel is open so the workspace
 * shows what it has, and it tucks itself away a moment later on every device, so
 * the model keeps the screen. A panel the user pinned is the exception: it is on
 * screen because of that wish, so it does not tuck away and keeps no tongue.
 */
export function FloatDock({
  side,
  label,
  testId,
  subject = null,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  testId?: string;
  /**
   * What on screen needs this panel, if anything. It unfolds the panel and rules
   * over its own state; a different subject unfolds it again.
   */
  subject?: string | null;
  children: ReactNode;
}) {
  const open = useUiStore((state) => (side === 'left' ? state.leftDockOpen : state.rightDockOpen));
  const setOpen = useUiStore((state) =>
    side === 'left' ? state.setLeftDockOpen : state.setRightDockOpen,
  );
  const setShown = useUiStore((state) =>
    side === 'left' ? state.setLeftDockShown : state.setRightDockShown,
  );
  // Panels the user has pinned stay on screen whatever the hand does.
  const pinnedPanels = useUiStore((state) => state.pinnedPanels);
  // Set the moment the user works the panel, so the start-up tuck below leaves it
  // alone from then on.
  const touched = useRef(false);
  // The subject's own state, unfolded by default. It does not outlive the
  // subject: the next one arrives unfolded as well.
  const [subjectOpen, setSubjectOpen] = useState(true);
  // What is working the panel right now. The platform's own pointer decides
  // before anything touches the dock, so a tablet never starts out believing it
  // has a mouse; from then on the last pointer over the dock says.
  const [hand, setHand] = useState<DockHand>(() =>
    primaryInputProfile() === 'touch' ? 'touch' : dockHand(lastPointerType()),
  );
  useEffect(() => {
    if (subject) setSubjectOpen(true);
  }, [subject]);

  const held = subject !== null;
  const shown = pinnedPanels || (held ? subjectOpen : open);
  // The rest of the layout follows what is on screen, not what the user asked
  // for: a panel unfolded by its subject takes the same room as one unfolded by
  // hand, and the bars and the cube keep clear of it either way.
  useEffect(() => {
    setShown(shown);
  }, [setShown, shown]);

  const show = useCallback(() => {
    touched.current = true;
    if (held) setSubjectOpen(true);
    else setOpen(true);
  }, [held, setOpen]);

  const hide = useCallback(() => {
    if (held) setSubjectOpen(false);
    else setOpen(false);
  }, [held, setOpen]);

  const toggle = useCallback(() => {
    touched.current = true;
    if (held) setSubjectOpen((current) => !current);
    else setOpen(!open);
  }, [held, open, setOpen]);

  // The panel shows itself at start and tucks away once, a moment later: an
  // open panel at launch is an invitation, not a state the user chose. A hand on
  // the panel cancels the timer, on every device.
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
          // A pinned panel is open by the user's wish, not as an invitation.
          if (!touched.current && !useUiStore.getState().pinnedPanels) setOpen(false);
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
    <div
      className={`dock dock-${side}`}
      data-open={shown ? 'true' : 'false'}
      data-tab={showsTab(hand, shown, pinnedPanels) ? 'true' : 'false'}
      // Enter and leave are read on the dock as a whole, so moving between the
      // edge, the tongue and the panel itself is not a departure.
      onPointerEnter={(event) => {
        const next = dockHand(event.pointerType);
        if (next !== hand) setHand(next);
        if (opensOnHover(next)) show();
      }}
      onPointerLeave={() => {
        // A menu opened from the panel is drawn over the scene, so it counts as
        // still being at the panel rather than having left it.
        if (closesOnLeave(hand, held, useContextMenuStore.getState().menu !== null, pinnedPanels)) {
          hide();
        }
      }}
    >
      <div className="dock-trigger" aria-hidden="true" onClick={show} />
      <aside
        className="dock-surface"
        aria-label={label}
        data-testid={testId}
        inert={!shown}
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
