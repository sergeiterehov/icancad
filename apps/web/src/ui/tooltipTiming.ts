/** How long reading one tooltip skips the wait for the next one. */
export const WARM_MS = 1600;
/** Delay used while the reader is moving between tooltips. */
export const WARM_DELAY = 80;

/**
 * The moment the warm window ends after the pointer leaves a control. Only a
 * window that is still running is extended: leaving a control must not revive
 * warmth that has already passed, or moving the pointer across the app would
 * keep every tooltip on the fast path for the whole session.
 */
export function rearmWarm(windowEnd: number, now: number): number {
  return now < windowEnd ? now + WARM_MS : windowEnd;
}

/** How long to wait before a hovered tooltip opens. */
export function tooltipDelay(delay: number, windowEnd: number, now: number): number {
  return now < windowEnd ? WARM_DELAY : delay;
}
