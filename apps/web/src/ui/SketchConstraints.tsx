import { isFormula, type SketchFeature } from '@icancad/model';
import { AlertTriangle, MousePointer2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  constraintEntityIds,
  constraintsGeometryIds,
  diagnoseSketch,
} from '../sketch/constraintModel';
import { isNumericConstraint } from '../sketch/dimensions';
import { useDocumentStore } from '../stores/documentStore';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';
import { useUiStore } from '../stores/uiStore';
import { CONSTRAINT_CATALOG, constraintLabel } from './constraintCatalog';
import { useContextMenuStore } from './ContextMenu';
import { PanelSection } from './Controls';
import { formatNumber } from './format';
import { formulaMessage } from './formulaMessage';
import { ErrorBadge } from './PickableSection';
import { Tooltip } from './Tooltip';
import { useListSelection } from './useListSelection';

function constraintValue(
  constraint: SketchFeature['constraints'][number],
  locale: string,
  resolved: number | undefined,
  error?: string,
): string {
  if (!isNumericConstraint(constraint)) return '';
  if (error) return '—';
  const number = Number.isFinite(resolved)
    ? resolved
    : typeof constraint.value === 'number'
      ? constraint.value
      : undefined;
  if (number === undefined) return '—';
  const value = formatNumber(number, locale, 2);
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
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const selectedConstraintIds = useUiStore((state) => state.sketchConstraintIds);
  const selectConstraint = useUiStore((state) => state.selectSketchConstraint);
  const selectConstraints = useUiStore((state) => state.selectSketchConstraints);
  const setDimensionEdit = useUiStore((state) => state.setSketchDimensionEdit);
  const problemIds = useUiStore((state) => state.sketchProblemConstraintIds);
  const openMenu = useContextMenuStore((state) => state.open);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const resolution = useFormulaStore((state) => state.resolution);
  const formulaRevision = resolution?.revision ?? 0;
  const resolvedConstraints = useMemo(() => {
    const resolved = resolvedFeatureFor(feature);
    return new Map(
      (resolved?.type === 'sketch' ? resolved.constraints : []).map((constraint) => [
        constraint.id,
        constraint,
      ]),
    );
  }, [feature, formulaRevision]);

  const constraintErrors = useMemo(() => {
    const errors = resolution?.errors[feature.id] ?? {};
    const found = new Map<string, string>();
    feature.constraints.forEach((constraint, index) => {
      const message = formulaMessage(t, errors[`constraints.${index}.value`]);
      if (message) found.set(constraint.id, message);
    });
    return found;
  }, [feature, resolution?.errors, t]);
  const constraintErrorText = feature.constraints
    .filter((constraint) => constraintErrors.has(constraint.id))
    .map(
      (constraint) =>
        `${constraintLabel((key) => t(key as never), constraint.type)}: ${constraintErrors.get(
          constraint.id,
        )}`,
    )
    .join(' · ');

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
  const activeConstraintIds = new Set(selectedConstraintIds);

  // Constraints select like every other list. A plain click on the constraint
  // that is already alone in the selection closes it again, which is how the
  // value editor in the panel is dismissed.
  const clickConstraint = useListSelection({
    ids: visibleConstraints.map((constraint) => constraint.id),
    selected: selectedConstraintIds,
    repeatClears: true,
    onSelect: (ids) => selectConstraints(ids),
  });

  const removeConstraint = (id: string) => {
    const next = {
      ...feature,
      constraints: feature.constraints.filter((candidate) => candidate.id !== id),
    };
    apply({ type: 'feature/replace', feature: next });
    if (activeConstraintIds.has(id)) {
      selectConstraint(null);
    }
    void diagnoseSketch(next);
  };

  return (
    <PanelSection
      title={t('sketch.constraints')}
      count={feature.constraints.length}
      divided
      action={
        hasProblems || constraintErrors.size > 0 ? (
          <span className="panel-section-actions">
            {constraintErrors.size > 0 && <ErrorBadge message={constraintErrorText} />}
            {hasProblems && (
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
            )}
          </span>
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
              (selectedConstraintIds.length > 0 && !activeConstraintIds.has(constraint.id));
            const Icon = CONSTRAINT_CATALOG[constraint.type]?.icon;
            const constraintError = constraintErrors.get(constraint.id);
            return (
              <div
                key={constraint.id}
                className={`constraint-row${isFormula(constraint.value) ? ' is-formula' : ''}`}
                data-active={activeConstraintIds.has(constraint.id) ? 'true' : undefined}
                data-dimmed={dimmed ? 'true' : undefined}
                data-problem={problems.has(constraint.id) ? 'true' : undefined}
                role="button"
                tabIndex={0}
                onClick={(event) => clickConstraint(event, constraint.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  clickConstraint(event, constraint.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Opening the menu never changes the selection: a clicked
                  // member of a multi-selection keeps it, otherwise the action
                  // applies to that constraint alone.
                  const targets = activeConstraintIds.has(constraint.id)
                    ? feature.constraints.filter((candidate) =>
                        activeConstraintIds.has(candidate.id),
                      )
                    : [constraint];
                  const geometryIds = constraintsGeometryIds(targets);
                  openMenu(event.clientX, event.clientY, [
                    {
                      id: 'select-geometry',
                      label: t('sketch.selectRelatedGeometry'),
                      icon: <MousePointer2 size={14} />,
                      disabled: geometryIds.length === 0,
                      onSelect: () => setSketchSelection(geometryIds),
                    },
                    { id: 'constraint-separator', separator: true },
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
                <span className="constraint-icon" aria-hidden="true">
                  {Icon ? <Icon size={13} /> : null}
                </span>
                <span className="constraint-label">
                  {constraintLabel((key) => t(key as never), constraint.type)}
                </span>
                {constraint.value !== undefined && isNumericConstraint(constraint) && (
                  <button
                    type="button"
                    className={`constraint-value-text${isFormula(constraint.value) ? ' is-formula' : ''}${
                      constraintError ? ' is-error' : ''
                    }`}
                    title={t('constraint.editValue')}
                    aria-label={`${constraintValue(
                      constraint,
                      locale,
                      resolvedConstraints.get(constraint.id)?.value,
                      constraintError,
                    )}. ${t('constraint.editValue')}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDimensionEdit(constraint.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {constraintValue(
                      constraint,
                      locale,
                      resolvedConstraints.get(constraint.id)?.value,
                      constraintError,
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}
