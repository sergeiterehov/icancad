import type { SketchFeature } from '@icancad/model';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { constraintEntityIds, constraintLabel, diagnoseSketch } from '../sketch/constraintModel';
import { isNumericConstraint } from '../sketch/dimensions';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from './ContextMenu';
import { PanelSection } from './Controls';
import { formatNumber } from './format';
import { Tooltip } from './Tooltip';

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
  const problemIds = useUiStore((state) => state.sketchProblemConstraintIds);
  const openMenu = useContextMenuStore((state) => state.open);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const problems = new Set(problemIds);
  const hasProblems = feature.constraints.some((constraint) => problems.has(constraint.id));
  const visibleConstraints = onlyProblems
    ? feature.constraints.filter((constraint) => problems.has(constraint.id))
    : feature.constraints;

  useEffect(() => {
    if (!hasProblems && onlyProblems) setOnlyProblems(false);
  }, [hasProblems, onlyProblems]);

  const selectedEntityIds = new Set(
    selectionKeys.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const active = feature.constraints.find((constraint) => constraint.id === selectedConstraintId);

  const removeConstraint = (id: string) => {
    const next = {
      ...feature,
      constraints: feature.constraints.filter((candidate) => candidate.id !== id),
    };
    apply({ type: 'feature/replace', feature: next });
    if (selectedConstraintId === id) selectConstraint(null);
    void diagnoseSketch(next);
  };

  return (
    <PanelSection
      title={t('sketch.constraints')}
      count={feature.constraints.length}
      action={
        hasProblems ? (
          <Tooltip content={t('constraint.problemsHint')}>
            <button
              type="button"
              className="panel-warning"
              aria-label={t('constraint.problemsHint')}
              data-active={onlyProblems ? 'true' : undefined}
              data-testid="constraint-problems"
              onClick={() => setOnlyProblems((current) => !current)}
            >
              <AlertTriangle size={14} />
            </button>
          </Tooltip>
        ) : undefined
      }
    >
      {feature.constraints.length === 0 ? (
        <p className="hint">{t('sketch.constraintsEmpty')}</p>
      ) : (
        <div className="constraint-list">
          {visibleConstraints.map((constraint) => {
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
                data-problem={problems.has(constraint.id) ? 'true' : undefined}
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
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectConstraint(constraint.id);
                  openMenu(event.clientX, event.clientY, [
                    {
                      id: 'delete',
                      label: t('common.delete'),
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: () => removeConstraint(constraint.id),
                    },
                  ]);
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
              </div>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}
