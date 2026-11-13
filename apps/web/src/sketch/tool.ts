export type SketchTool =
  | 'select'
  | 'point'
  | 'line'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'bezier'
  | 'project';

/** Single-key shortcuts of the drawing tools, shown in the tool rail tooltips. */
export const SKETCH_TOOL_SHORTCUTS: Partial<Record<SketchTool, string>> = {
  point: 'P',
  line: 'L',
  circle: 'C',
  arc: 'A',
  ellipse: 'E',
  bezier: 'B',
};

/**
 * The letter a keyboard event stands for. The physical key is used first so the
 * shortcuts keep working on a non-Latin layout, where `event.key` is Cyrillic.
 */
export function shortcutLetter(event: KeyboardEvent): string | null {
  const physical = /^Key([A-Z])$/.exec(event.code);
  if (physical) return physical[1] ?? null;
  return /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : null;
}

/** The drawing tool a keyboard event selects, or null for other keys. */
export function sketchToolFromShortcut(event: KeyboardEvent): SketchTool | null {
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
  const letter = shortcutLetter(event);
  if (!letter) return null;
  const entry = Object.entries(SKETCH_TOOL_SHORTCUTS).find(([, shortcut]) => shortcut === letter);
  return (entry?.[0] as SketchTool | undefined) ?? null;
}
