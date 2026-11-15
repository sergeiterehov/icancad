import { isTouchPointer } from '../viewport/inputProfile';

/**
 * What a dock is dealing with: a cursor that can hover over it, or a finger.
 *
 * A finger cannot hover, so the panel behind it is worked by its tongue; a
 * cursor works the panel by being over it. The two behaviours cannot be mixed —
 * a panel that closes when a finger lifts is unusable, and a panel that stays
 * open when a mouse wanders off covers half the model.
 */
export type DockHand = 'hover' | 'touch';

/** The hand a pointer brings to a dock. A pen hovers, so it counts as a cursor. */
export function dockHand(pointerType: string): DockHand {
  return isTouchPointer(pointerType) ? 'touch' : 'hover';
}

/** A dock unfolds by itself only under a cursor. */
export function opensOnHover(hand: DockHand): boolean {
  return hand === 'hover';
}

/**
 * The tongue is a control for a finger and only a handle for a cursor: a mouse
 * opens the panel by coming to it and gives it back by leaving, so an open panel
 * needs no way out drawn on it. A finger has no such way back, so its tongue
 * stays on screen whenever the panel does.
 */
export function showsTab(hand: DockHand, open: boolean): boolean {
  return hand === 'touch' || !open;
}

/**
 * A cursor that leaves the dock gives the panel back, unless a subject holds it
 * open: the inspector of a selected operation is a form the user reads, not a
 * panel that disappears because the mouse crossed the scene. A menu opened
 * inside the panel holds it too — the menu is drawn over the scene, so reading
 * it would otherwise take away the row it belongs to.
 */
export function closesOnLeave(hand: DockHand, held: boolean, menuOpen = false): boolean {
  return hand === 'hover' && !held && !menuOpen;
}
