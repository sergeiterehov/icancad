export interface HandleDragInput {
  /** Signed value when the pointer went down. */
  startValue: number;
  deltaX: number;
  deltaY: number;
  /** Unit direction of the handle axis in screen space. */
  axisX: number;
  axisY: number;
  /** Screen pixels per millimetre along the axis. */
  pixelsPerMm: number;
}

/**
 * Signed distance along a handle axis. The camera is orthographic, so a screen
 * displacement maps linearly onto the projected axis; the projection is what
 * makes a handle that points at the camera less sensitive rather than infinite.
 */
export function handleDragValue(input: HandleDragInput): number {
  const along = input.deltaX * input.axisX + input.deltaY * input.axisY;
  return input.startValue + along / Math.max(input.pixelsPerMm, 0.2);
}

/** Every handle snaps to a tenth of a millimetre. */
export const HANDLE_LENGTH_STEP = 0.1;
/** Angle handles snap to a whole degree. */
export const HANDLE_ANGLE_STEP = 1;

/** A length a handle can actually mean, without a long float tail. */
export function snapLength(value: number): number {
  return Math.round(value * 10) / 10;
}

export function snapAngle(value: number): number {
  return Math.round(value);
}
