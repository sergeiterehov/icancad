import {
  BODY_COLORS,
  objectColor,
  objectVisible,
  resolveBody,
  SKETCH_COLOR,
  sketchObjectId,
  type Project,
} from '@icancad/model';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { SelectionItem } from '../stores/documentStore';
import { useDocumentStore } from '../stores/documentStore';
import type { ContextMenuItem } from './ContextMenu';

/** An object the context menu can act on, taken from the current selection. */
export interface MenuTarget {
  kind: 'body' | 'mesh' | 'sketch';
  /** Body id or sketch feature id. */
  id: string;
  /** Key of the object metadata: a body id or `sketch:<feature>`. */
  objectId: string;
  name: string;
  color: string;
  visible: boolean;
}

/**
 * Objects of a selection, in selection order. Faces and operations are not
 * objects of the tree, so they are skipped.
 */
export function objectTargets(
  project: Project,
  selection: readonly SelectionItem[],
): MenuTarget[] {
  const targets: MenuTarget[] = [];
  for (const item of selection) {
    if (item.kind === 'body' || item.kind === 'mesh') {
      const ref = project.bodies.find((body) => body.id === item.id);
      if (!ref) continue;
      const body = resolveBody(project, ref);
      targets.push({
        kind: body.kind === 'mesh' ? 'mesh' : 'body',
        id: body.id,
        objectId: body.id,
        name: body.name,
        color: body.color,
        visible: body.visible,
      });
      continue;
    }
    if (item.kind !== 'sketch') continue;
    const feature = project.features.find(
      (candidate) => candidate.id === item.id && candidate.type === 'sketch',
    );
    if (!feature) continue;
    const objectId = sketchObjectId(feature.id);
    targets.push({
      kind: 'sketch',
      id: feature.id,
      objectId,
      name: feature.name,
      color: objectColor(project, objectId, SKETCH_COLOR),
      visible: objectVisible(project, objectId),
    });
  }
  return targets;
}

/** Colour of every target, chosen from the shared palette. */
export function colorMenuItem(targets: MenuTarget[], label: string): ContextMenuItem | null {
  const first = targets[0];
  if (!first) return null;
  return {
    id: 'color',
    label,
    icon: <span className="context-menu-swatch" style={{ background: first.color }} />,
    palette: BODY_COLORS,
    value: first.color,
    onPick: (color: string) =>
      useDocumentStore
        .getState()
        .setObjectColors(targets.map((target) => ({ objectId: target.objectId, color }))),
  };
}

/** Hide or show every target, depending on whether they are all visible. */
export function visibilityMenuItem(
  targets: MenuTarget[],
  labels: { hide: string; show: string },
): ContextMenuItem | null {
  if (targets.length === 0) return null;
  const allVisible = targets.every((target) => target.visible);
  return {
    id: 'visibility',
    label: allVisible ? labels.hide : labels.show,
    icon: allVisible ? <EyeOff size={14} /> : <Eye size={14} />,
    onSelect: () =>
      useDocumentStore
        .getState()
        .setObjectsVisible(
          targets.map((target) => ({ objectId: target.objectId, visible: !allVisible })),
        ),
  };
}

/** Delete every target: bodies as delete operations, sketches with dependents. */
export function deleteMenuItem(targets: MenuTarget[], label: string): ContextMenuItem | null {
  if (targets.length === 0) return null;
  return {
    id: 'delete',
    label,
    icon: <Trash2 size={14} />,
    danger: true,
    onSelect: () =>
      useDocumentStore
        .getState()
        .deleteObjects(targets.map((target) => ({ kind: target.kind, id: target.id }))),
  };
}
