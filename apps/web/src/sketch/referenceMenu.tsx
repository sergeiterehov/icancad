import {
  createId,
  type SketchEntity,
  type SketchFeature,
  type SketchMeasure,
} from '@icancad/model';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { measureInfo, measuresForEntity } from './measure';

export function referenceMenuItems(
  feature: SketchFeature,
  entityId: string,
  t: (key: string) => string,
  locale: string,
  onChange: (next: SketchFeature) => void,
): ContextMenuItem[] {
  const entity: SketchEntity | undefined = feature.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity) return [];
  const enabled = new Set(
    feature.references.filter((reference) => reference.entityId === entityId).map((r) => r.measure),
  );
  const measures = measuresForEntity(entity);
  if (measures.length === 0) return [];

  const toggle = (measure: SketchMeasure) => {
    const references = enabled.has(measure)
      ? feature.references.filter(
          (reference) => !(reference.entityId === entityId && reference.measure === measure),
        )
      : [...feature.references, { id: createId('ref'), entityId, measure }];
    onChange({ ...feature, references });
  };

  return [
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
  ];
}
