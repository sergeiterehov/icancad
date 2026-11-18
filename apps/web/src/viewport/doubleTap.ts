/** How close two taps have to be, and how quick, to read as one double tap. */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_SLOP_PX = 6;

export interface TapMark {
  time: number;
  x: number;
  y: number;
}

/** Whether the tap continues the pair the previous one opened. */
export function isDoubleTap(previous: TapMark | null, next: TapMark): boolean {
  return (
    previous !== null &&
    next.time - previous.time < DOUBLE_TAP_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX
  );
}
