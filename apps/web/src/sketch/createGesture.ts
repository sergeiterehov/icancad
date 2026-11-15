/**
 * How a sketch tool reads a finger.
 *
 * On a canvas a finger can do one of two things: it can come down and go again
 * in the same place, or it can travel. The app already had the first one, as a
 * click: the tool takes a point, and the next point makes the segment, the
 * circle or the next vertex. A tablet has no patience for that — the gesture
 * that carries the intent is the stretch between the two ends.
 *
 * So a travel is a second way to say the same thing: the point where the finger
 * came down is the point where a click would have been, and the point where it
 * lifts is the point the next click would have given. Nothing about the tools
 * changes; only the number of gestures it takes to give them the same points.
 *
 * A mouse keeps the click flow: it is precise enough to place two points, and a
 * drag with it means something else wherever a selection box or a view swing is
 * possible.
 */

/** Shortest travel, in pixels, that reads as a drag instead of a tap. */
export const TAP_SLOP_PX = 8;

/** Tools that a drag finishes, because the gesture names both of its ends. */
const DRAG_FINISHES = ['line', 'bezier'];

/** True when a press and release in nearly the same spot is a tap. */
export function isTap(movedX: number, movedY: number): boolean {
  return Math.hypot(movedX, movedY) <= TAP_SLOP_PX;
}

/**
 * True when a press that travels should stretch the primitive. Only a finger or
 * a pen does this: a mouse still places its points one click at a time.
 */
export function dragCreates(pointerType: string, movedX: number, movedY: number): boolean {
  if (pointerType === 'mouse') return false;
  return !isTap(movedX, movedY);
}

/**
 * True when the press point becomes the first point of the primitive. A point
 * tool takes no anchor: the point it makes is the one under the finger when it
 * lifts, so the point follows the finger instead of leaving a copy behind.
 */
export function dragAnchors(tool: string, draftLength: number): boolean {
  return tool !== 'point' && draftLength === 0;
}

/**
 * True when the drag finishes the tool instead of leaving it waiting for another
 * click: a stretched line and a stretched curve name both ends, so the next one
 * starts from scratch.
 */
export function dragEndsChain(tool: string): boolean {
  return DRAG_FINISHES.includes(tool);
}
