import {
  createId,
  type SketchEntity,
  type SketchFeature,
  type SketchMeasure,
} from '@icancad/model';
import { isFundamentalEntityId } from '@icancad/sketch';
import { ClipboardPaste, Copy, LineStyle, Ruler, Split, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { referenceIcon } from '../ui/referenceCatalog';
import { constructionSelection, toggleConstruction } from './construction';
import { constraintIdsForEntities } from './constraintModel';
import { measuresForEntity, referenceText } from './measure';

export interface ReferenceMenuOptions {
  /** Geometry currently selected; a right-click on a member keeps the group. */
  selectedEntityIds?: string[];
  onSelectConstraints?: (constraintIds: string[]) => void;
  onDelete?: (entityIds: string[]) => void;
  /** Copies the named geometry to the system clipboard (ADR 0059). */
  onCopy?: (entityIds: string[]) => void;
  /** Pastes the clipboard where the menu was opened, with no preview. */
  onPaste?: () => void;
}

/**
 * The menu of an empty spot in the sketch. Pasting is the whole of it: with no
 * geometry under the pointer there is nothing else the click could mean.
 */
export function sketchBackgroundMenuItems(
  t: (key: string) => string,
  onPaste: () => void,
): ContextMenuItem[] {
  return [
    {
      id: 'paste-geometry',
      label: t('sketch.paste'),
      icon: <ClipboardPaste size={14} />,
      onSelect: onPaste,
    },
  ];
}

export function referenceMenuItems(
  feature: SketchFeature,
  entityId: string,
  t: (key: string) => string,
  locale: string,
  onChange: (next: SketchFeature) => void,
  options: ReferenceMenuOptions = {},
): ContextMenuItem[] {
  const entity: SketchEntity | undefined = feature.entities.find(
    (candidate) => candidate.id === entityId,
  );
  const enabled = new Set(
    feature.references.filter((reference) => reference.entityId === entityId).map((r) => r.measure),
  );
  const measures = entity ? measuresForEntity(entity) : [];

  const toggle = (measure: SketchMeasure) => {
    const references = enabled.has(measure)
      ? feature.references.filter(
          (reference) => !(reference.entityId === entityId && reference.measure === measure),
        )
      : [...feature.references, { id: createId('ref'), entityId, measure }];
    onChange({ ...feature, references });
  };

  const items: ContextMenuItem[] = [];
  const targets = options.selectedEntityIds?.includes(entityId)
    ? options.selectedEntityIds
    : [entityId];
  const { onSelectConstraints, onDelete, onCopy, onPaste } = options;
  // The clipboard stands first: it is what a right-click on the drawing is most
  // often for, and it reads as the same pair in every editor.
  if (onPaste) {
    items.push({
      id: 'paste-geometry',
      label: t('sketch.paste'),
      icon: <ClipboardPaste size={14} />,
      onSelect: onPaste,
    });
  }
  if (onCopy) {
    items.push({
      id: 'copy-geometry',
      label: t('sketch.copy'),
      icon: <Copy size={14} />,
      disabled: targets.filter((id) => !isFundamentalEntityId(id)).length === 0,
      onSelect: () => onCopy(targets),
    });
  }
  if (items.length > 0) items.push({ id: 'clipboard-separator', separator: true });
  const constructionTargets = constructionSelection(feature, targets);
  if (constructionTargets.length > 0) {
    items.push({
      id: 'toggle-construction',
      label: t('tools.construction'),
      icon: <LineStyle size={14} />,
      checked: constructionTargets.every((target) => target.construction),
      onSelect: () => {
        const next = toggleConstruction(feature, targets);
        if (next) onChange(next);
      },
    });
  }
  if (onSelectConstraints) {
    const constraintIds = constraintIdsForEntities(feature, targets);
    if (items.length > 0) items.push({ id: 'constraint-separator', separator: true });
    items.push({
      id: 'select-constraints',
      label: t('sketch.selectRelatedConstraints'),
      icon: <Ruler size={14} />,
      disabled: constraintIds.length === 0,
      onSelect: () => onSelectConstraints(constraintIds),
    });
  }
  if (entity && measures.length > 0) {
    if (items.length > 0) items.push({ id: 'reference-separator', separator: true });
    items.push(
      { id: 'reference-heading', heading: t('sketch.showMeasures') },
      ...measures.map((measure) => {
        const text = referenceText(entity, measure, locale, 'mm');
        const Icon = referenceIcon(entity, measure);
        return {
          id: `reference-${measure}`,
          label: text ?? t(`sketch.measure_${measure}`),
          icon: <Icon size={14} />,
          checked: enabled.has(measure),
          onSelect: () => toggle(measure),
        } satisfies ContextMenuItem;
      }),
    );
  }
  const projected = new Set((feature.projections ?? []).map((projection) => projection.entityId));
  const detachable = targets.filter((id) => projected.has(id));
  if (detachable.length > 0) {
    const detach = new Set(detachable);
    items.push({
      id: 'detach-projection',
      label: t('sketch.detachProjection'),
      icon: <Split size={14} />,
      onSelect: () =>
        onChange({
          ...feature,
          projections: (feature.projections ?? []).filter(
            (projection) => !detach.has(projection.entityId),
          ),
        }),
    });
  }
  const deletable = targets.filter((id) => !isFundamentalEntityId(id));
  if (onDelete && deletable.length > 0) {
    if (items.length > 0) items.push({ id: 'delete-separator', separator: true });
    items.push({
      id: 'delete-geometry',
      label: t('common.delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => onDelete(deletable),
    });
  }
  return items;
}
