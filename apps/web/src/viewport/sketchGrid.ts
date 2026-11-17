/** Preferred distance between minor grid lines, in screen pixels. */
export const SKETCH_GRID_TARGET_PX = 28;

/**
 * Picks a grid step from the 1-2-5 series. The chosen step is between the raw
 * target and roughly twice it, so the screen spacing stays in a readable band
 * instead of turning into a solid fill at some zoom levels.
 */
export function niceGridStep(raw: number): number {
  const exponent = Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const base = 10 ** exponent;
  const fraction = raw / base;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * base;
}

/** Indices of the grid lines that cover `center ± extent` on one axis. */
export function gridLineRange(
  center: number,
  extent: number,
  step: number,
): { start: number; end: number } {
  return {
    start: Math.floor((center - extent) / step),
    end: Math.ceil((center + extent) / step),
  };
}
