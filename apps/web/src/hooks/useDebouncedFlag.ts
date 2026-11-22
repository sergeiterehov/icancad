import { useEffect, useState } from 'react';

export interface DebouncedFlagState {
  visible: boolean;
  /** When the flag started being true, or null when it is off or already shown. */
  since: number | null;
}

const HIDDEN: DebouncedFlagState = { visible: false, since: null };

/**
 * Whether an indicator for a state should be shown at `now`. A flag has to stay
 * true for the whole delay, so an operation that finishes first never flashes
 * the indicator; turning false hides it at once.
 */
export function debouncedFlag(
  state: DebouncedFlagState,
  value: boolean,
  now: number,
  delay: number,
): DebouncedFlagState {
  if (!value) return state === HIDDEN ? state : HIDDEN;
  if (state.visible) return state;
  if (state.since === null) {
    return delay <= 0 ? { visible: true, since: null } : { visible: false, since: now };
  }
  return now - state.since >= delay ? { visible: true, since: null } : state;
}

/**
 * A busy flag for an indicator: it appears only after the work has lasted long
 * enough to be worth showing and disappears immediately when the work is over.
 */
export function useDebouncedFlag(value: boolean, delay: number): boolean {
  const [state, setState] = useState<DebouncedFlagState>(HIDDEN);
  useEffect(() => {
    const now = performance.now();
    const next = debouncedFlag(state, value, now, delay);
    if (next !== state) setState(next);
    if (!value || next.visible || next.since === null) return undefined;
    const remaining = Math.max(0, delay - (now - next.since));
    const timer = window.setTimeout(() => {
      setState((current) => debouncedFlag(current, true, performance.now(), delay));
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [value, delay, state]);
  return state.visible;
}
