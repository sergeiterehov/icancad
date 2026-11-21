import {
  MESH_UNITS,
  MILLIMETRES_PER_MESH_UNIT,
  type ImportMeshFeature,
  type MeshUnit,
} from '@icancad/model';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { PanelSection, Segmented, SegmentedTab } from './Controls';

const UNIT_LABEL = {
  mm: 'importUnits.mm',
  cm: 'importUnits.cm',
  m: 'importUnits.m',
  in: 'importUnits.in',
  ft: 'importUnits.ft',
} as const satisfies Record<MeshUnit, string>;

/** The unit the imported file is written in; conversion happens on rebuild. */
export function ImportMeshSection({ feature }: { feature: ImportMeshFeature }) {
  const { t } = useTranslation();
  const apply = useDocumentStore((state) => state.apply);

  return (
    <PanelSection title={t('importUnits.title')}>
      <Segmented ariaLabel={t('importUnits.title')}>
        {MESH_UNITS.map((unit) => (
          <SegmentedTab
            key={unit}
            label={t(UNIT_LABEL[unit])}
            active={feature.unit === unit}
            tooltip={
              unit === 'mm'
                ? undefined
                : t('importUnits.factor', {
                    unit: t(UNIT_LABEL[unit]),
                    factor: MILLIMETRES_PER_MESH_UNIT[unit],
                  })
            }
            onClick={() =>
              apply({ type: 'feature/replace', feature: { ...feature, unit } })
            }
          />
        ))}
      </Segmented>
      <p className="hint">{t('importUnits.hint')}</p>
    </PanelSection>
  );
}
