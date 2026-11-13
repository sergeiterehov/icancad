import {
  createId,
  type SketchEntity,
  type SketchFeature,
  type SketchMeasure,
} from '@icancad/model';
import { Ruler } from 'lucide-react';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { constraintIdsForEntities } from './constraintModel';
import { measureInfo, measuresForEntity } from './measure';

export interface ReferenceMenuOptions {
  /** Geometry currently selected; a right-click on a member keeps the group. */
  selectedEntityIds?: string[];
  onSelectConstraints?: (constraintIds: string[]) => void;
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
  const { onSelectConstraints } = options;
  if (onSelectConstraints) {
    const targets = options.selectedEntityIds?.includes(entityId)
      ? options.selectedEntityIds
      : [entityId];
    const constraintIds = constraintIdsForEntities(feature, targets);
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
        const info = measureInfo(entity, measure, locale, 'mm');
        return {
          id: `reference-${measure}`,
          label: info ? `${info.text}` : t(`sketch.measure_${measure}`),
          checked: enabled.has(measure),
          onSelect: () => toggle(measure),
        } satisfies ContextMenuItem;
      }),
    );
  }
  return items;
}
