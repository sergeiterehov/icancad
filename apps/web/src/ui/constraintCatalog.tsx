import type { ConstraintType } from '@icancad/model';
import {
  Angle,
  Diameter,
  Equal,
  GitCommitVertical,
  Link,
  MarginHorizontal,
  MoveDiagonal,
  MoveHorizontal,
  MoveRight,
  MoveUp,
  MoveVertical,
  Pin,
  Radius,
  Tangent,
  TriangleRight,
  TrianglesCenterlineDashedVertical,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ConstraintAction } from '../sketch/constraintModel';
import { shortcutLetter } from '../sketch/tool';

export interface ConstraintInfo {
  icon: ComponentType<{ size?: number }>;
  /** Key of the constraint name. */
  labelKey: string;
  /** Key of the tooltip that explains how the constraint behaves. */
  descriptionKey: string;
  /**
   * Letter applied together with Shift. Constraints that can never apply to the
   * same selection share a letter; the selection picks the one that fits.
   */
  shortcut: string;
}

/**
 * The single directory of the sketch constraints: the icon, the name and the
 * description shown in the UI, and the Shift shortcut that applies the
 * constraint to the current selection.
 */
export const CONSTRAINT_CATALOG: Record<ConstraintType, ConstraintInfo> = {
  fix: {
    icon: Pin,
    labelKey: 'constraint.fix',
    descriptionKey: 'constraint.description.fix',
    shortcut: 'F',
  },
  coincident: {
    icon: Link,
    labelKey: 'constraint.coincident',
    descriptionKey: 'constraint.description.coincident',
    shortcut: 'C',
  },
  horizontal: {
    icon: MoveUp,
    labelKey: 'constraint.horizontal',
    descriptionKey: 'constraint.description.horizontal',
    shortcut: 'H',
  },
  vertical: {
    icon: MoveRight,
    labelKey: 'constraint.vertical',
    descriptionKey: 'constraint.description.vertical',
    shortcut: 'V',
  },
  parallel: {
    icon: MarginHorizontal,
    labelKey: 'constraint.parallel',
    descriptionKey: 'constraint.description.parallel',
    shortcut: 'P',
  },
  perpendicular: {
    icon: TriangleRight,
    labelKey: 'constraint.perpendicular',
    descriptionKey: 'constraint.description.perpendicular',
    shortcut: 'N',
  },
  tangent: {
    icon: Tangent,
    labelKey: 'constraint.tangent',
    descriptionKey: 'constraint.description.tangent',
    shortcut: 'T',
  },
  equal: {
    icon: Equal,
    labelKey: 'constraint.equal',
    descriptionKey: 'constraint.description.equal',
    shortcut: 'E',
  },
  distance: {
    icon: MoveDiagonal,
    labelKey: 'constraint.distance',
    descriptionKey: 'constraint.description.distance',
    shortcut: 'D',
  },
  'horizontal-distance': {
    icon: MoveHorizontal,
    labelKey: 'constraint.horizontalDistance',
    descriptionKey: 'constraint.description.horizontalDistance',
    shortcut: 'X',
  },
  'vertical-distance': {
    icon: MoveVertical,
    labelKey: 'constraint.verticalDistance',
    descriptionKey: 'constraint.description.verticalDistance',
    shortcut: 'Y',
  },
  angle: {
    icon: Angle,
    labelKey: 'constraint.angle',
    descriptionKey: 'constraint.description.angle',
    shortcut: 'A',
  },
  radius: {
    icon: Radius,
    labelKey: 'constraint.radius',
    descriptionKey: 'constraint.description.radius',
    shortcut: 'R',
  },
  diameter: {
    icon: Diameter,
    labelKey: 'constraint.diameter',
    descriptionKey: 'constraint.description.diameter',
    shortcut: 'D',
  },
  symmetric: {
    icon: TrianglesCenterlineDashedVertical,
    labelKey: 'constraint.symmetric',
    descriptionKey: 'constraint.description.symmetric',
    shortcut: 'S',
  },
  'point-on-line': {
    icon: GitCommitVertical,
    labelKey: 'constraint.pointOnLine',
    descriptionKey: 'constraint.description.pointOnLine',
    shortcut: 'C',
  },
  'point-on-circle': {
    icon: GitCommitVertical,
    labelKey: 'constraint.pointOnCircle',
    descriptionKey: 'constraint.description.pointOnCircle',
    shortcut: 'C',
  },
  'point-on-ellipse': {
    icon: GitCommitVertical,
    labelKey: 'constraint.pointOnEllipse',
    descriptionKey: 'constraint.description.pointOnEllipse',
    shortcut: 'C',
  },
};

const SHORTCUTS = new Map<string, ConstraintType[]>();
for (const [type, info] of Object.entries(CONSTRAINT_CATALOG) as [
  ConstraintType,
  ConstraintInfo,
][]) {
  const types = SHORTCUTS.get(info.shortcut) ?? [];
  types.push(type);
  SHORTCUTS.set(info.shortcut, types);
}

export function constraintLabel(t: (key: string) => string, type: ConstraintType): string {
  return t(CONSTRAINT_CATALOG[type]?.labelKey ?? type);
}

export function constraintDescription(t: (key: string) => string, type: ConstraintType): string {
  return t(CONSTRAINT_CATALOG[type]?.descriptionKey ?? type);
}

/** Shortcut shown in the UI: every constraint is applied with Shift. */
export function constraintShortcutLabel(type: ConstraintType): string {
  return `⇧${CONSTRAINT_CATALOG[type]?.shortcut ?? ''}`;
}

/** Constraints a keyboard event can apply, in catalog order. */
export function constraintsFromShortcut(event: KeyboardEvent): ConstraintType[] {
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return [];
  const letter = shortcutLetter(event);
  return letter ? (SHORTCUTS.get(letter) ?? []) : [];
}

/**
 * The action a Shift shortcut applies to the current selection, or null when no
 * constraint of that family fits what is selected.
 */
export function resolveConstraintShortcut(
  actions: readonly ConstraintAction[],
  event: KeyboardEvent,
): ConstraintAction | null {
  for (const type of constraintsFromShortcut(event)) {
    const action = actions.find((candidate) => candidate.type === type);
    if (action) return action;
  }
  return null;
}
