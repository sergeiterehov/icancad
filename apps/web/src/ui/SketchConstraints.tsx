import type { SketchFeature } from '@icancad/model';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { constraintEntityIds, constraintLabel, diagnoseSketch } from '../sketch/constraintModel';
import { isNumericConstraint } from '../sketch/dimensions';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { formatNumber } from './format';
import { IconButton, PanelSection } from './Controls';

function constraintValue(constraint: SketchFeature['constraints'][number], locale: string): string {
  if (!isNumericConstraint(constraint)) return '';
  const value = formatNumber(constraint.value ?? 0, locale, 2);
  switch (constraint.type) {
    case 'angle':
      return `${value}°`;
    case 'radius':
      return `R ${value} mm`;
    case 'diameter':
      return `Ø ${value} mm`;
    default:
      return `${value} mm`;
  }
}

export function SketchConstraints({ feature }: { feature: SketchFeature }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const apply = useDocumentStore((state) => state.apply);
  const selectionKeys = useUiStore((state) => state.sketchSelectionIds);
  const selectedConstraintId = useUiStore((state) => state.sketchConstraintId);
  const selectConstraint = useUiStore((state) => state.selectSketchConstraint);
  const selectedEntityIds = new Set(
    selectionKeys.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const active = feature.constraints.find((constraint) => constraint.id === selectedConstraintId);

  return (
    <PanelSection title={t('sketch.constraints')} count={feature.constraints.length}>
      {feature.constraints.length === 0 ? (
        <p className="hint">{t('sketch.constraintsEmpty')}</p>
      ) : (
        <div className="constraint-list">
          {feature.constraints.map((constraint) => {
            const entityIds = constraintEntityIds(constraint);
            const relatedByElement = [...selectedEntityIds].some((id) => entityIds.has(id));
            const dimmed =
              (selectedEntityIds.size > 0 && !relatedByElement) ||
              (active !== undefined && active.id !== constraint.id);
            return (
              <div
                key={constraint.id}
                className="constraint-row"
                data-active={active?.id === constraint.id ? 'true' : undefined}
                data-dimmed={dimmed ? 'true' : undefined}
                role="button"
                tabIndex={0}
                onClick={() =>
                  selectConstraint(active?.id === constraint.id ? null : constraint.id)
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  selectConstraint(active?.id === constraint.id ? null : constraint.id);
                }}
              >
                <span className="constraint-label">
                  {constraintLabel((key) => t(key as never), constraint.type)}
                </span>
                {constraint.value !== undefined && isNumericConstraint(constraint) && (
                  <span className="constraint-value-text">
                    {constraintValue(constraint, locale)}
                  </span>
                )}
                <IconButton
                  label={t('common.delete')}
                  className="tiny"
                  onClick={(event) => {
                    event.stopPropagation();
                    const next = {
                      ...feature,
                      constraints: feature.constraints.filter(
                        (candidate) => candidate.id !== constraint.id,
                      ),
                    };
                    apply({ type: 'feature/replace', feature: next });
                    if (selectedConstraintId === constraint.id) selectConstraint(null);
                    void diagnoseSketch(next);
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}
