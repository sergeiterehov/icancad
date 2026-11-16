/**
 * What the 3D view draws besides the model.
 *
 * These are the user's own view settings, not part of the document: a project
 * opened on another machine arrives with the model, not with the way this one
 * chooses to look at it.
 *
 * The world grid and the world axes are a working aid of the 3D view, so they
 * say nothing about the sketch editor, which draws the grid of the plane being
 * drawn on and the axes that go with it.
 */
export type ViewElement = 'axes' | 'grid' | 'hatching';

export interface ViewElementOption {
  id: ViewElement;
  /** Translation key of the name in the nav cube menu. */
  label: string;
  /** Translation key of the line that explains what the element is. */
  hint: string;
  /** What a fresh install shows. */
  byDefault: boolean;
}

export const VIEW_ELEMENTS: readonly ViewElementOption[] = [
  { id: 'axes', label: 'elements.axes', hint: 'elements.axesHint', byDefault: false },
  { id: 'grid', label: 'elements.grid', hint: 'elements.gridHint', byDefault: true },
  { id: 'hatching', label: 'elements.hatching', hint: 'elements.hatchingHint', byDefault: true },
];

export type ViewElements = Record<ViewElement, boolean>;

export const DEFAULT_VIEW_ELEMENTS: ViewElements = {
  axes: false,
  grid: true,
  hatching: true,
};

export function isViewElement(value: unknown): value is ViewElement {
  return VIEW_ELEMENTS.some((option) => option.id === value);
}

/**
 * The settings as stored, with a missing or broken entry falling back to what it
 * is by default: a half-written preference file must not hide the grid.
 */
export function viewElementsFrom(stored: unknown): ViewElements {
  const result: ViewElements = { ...DEFAULT_VIEW_ELEMENTS };
  if (typeof stored !== 'object' || stored === null) return result;
  for (const option of VIEW_ELEMENTS) {
    const value = (stored as Record<string, unknown>)[option.id];
    if (typeof value === 'boolean') result[option.id] = value;
  }
  return result;
}
