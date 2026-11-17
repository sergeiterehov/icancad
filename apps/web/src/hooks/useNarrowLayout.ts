import { useEffect, useState } from 'react';

/**
 * Width below which the two floating docks would cover each other if both were
 * open. The layout keeps that as a breakpoint of its own: a narrow screen shows
 * the model first and hands the panels over on request.
 */
export const NARROW_LAYOUT_QUERY = '(max-width: 700px)';

export function matchesNarrowLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

/** Tracks the narrow breakpoint, including a rotation or a window resize. */
export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(matchesNarrowLayout);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(NARROW_LAYOUT_QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return narrow;
}
