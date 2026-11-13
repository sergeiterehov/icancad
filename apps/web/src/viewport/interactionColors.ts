import type { Theme } from '../stores/themeStore';

/**
 * Interaction colours shared by the sketch editor and the 3D view. Selection is
 * purple everywhere; the element under the pointer is a contrasting blue that
 * is a step brighter than the sketch's own blue. Both views use this palette so
 * the same accent always means the same thing.
 */
export function selectionColor(theme: Theme): number {
  return theme === 'dark' ? 0xbb86fc : 0x7c3aed;
}

export function hoverColor(theme: Theme): number {
  return theme === 'dark' ? 0x62b0ff : 0x0a66ff;
}
