import { HISTORY_START, type Feature } from '@icancad/model';
import clsx from 'clsx';
import { Box, CornerUpLeft, FileUp, Layers, PencilRuler, Scissors, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, selectedFeatureIds } from '../stores/selection';
import { showContextMenu } from './ContextMenu';
import { ExtrudeOpIcon } from './featureIcons';
import { Tooltip } from './Tooltip';
import { translate } from './translate';

function FeatureIcon({ feature }: { feature: Feature }) {
  switch (feature.type) {
    case 'primitive':
      return <Box size={16} />;
    case 'sketch':
      return <PencilRuler size={16} />;
    case 'extrude':
      return <ExtrudeOpIcon op={feature.op} size={16} />;
    case 'boolean':
      return <Scissors size={16} />;
    case 'import-mesh':
      return <FileUp size={16} />;
    case 'delete-body':
      return <Trash2 size={16} />;
    default:
      return <Layers size={16} />;
  }
}

function RollbackCaret({
  index,
  active,
  disabled,
  blocked,
  pastFailure,
  onSelect,
}: {
  index: number;
  active: boolean;
  disabled?: boolean;
  /** The position immediately after the failed operation: the red barrier. */
  blocked?: boolean;
  /** A position beyond the barrier: inactive, but not red. */
  pastFailure?: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const label = t('timeline.goTo', { index });
  const outsideHistory = blocked || pastFailure;
  return (
    <Tooltip
      content={
        outsideHistory
          ? t('timeline.blockedByError')
          : disabled
            ? t('timeline.locked')
            : label
      }
    >
      <button
        type="button"
        className={clsx('timeline-caret', active && 'active', blocked && 'error')}
        aria-label={outsideHistory ? t('timeline.blockedByError') : label}
        aria-pressed={active}
        disabled={disabled || outsideHistory}
        onClick={onSelect}
      />
    </Tooltip>
  );
}

export function Timeline() {
  const { t } = useTranslation();
  const project = useDocumentStore((state) => state.project);
  const selection = useDocumentStore((state) => state.selection);
  const select = useDocumentStore((state) => state.select);
  const setHistoryEnd = useDocumentStore((state) => state.setHistoryEnd);
  const removeFeature = useDocumentStore((state) => state.removeFeature);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const locked = activeSketchId !== null;

  const position =
    project.historyEnd === null
      ? project.features.length
      : project.historyEnd === HISTORY_START
        ? 0
        : project.features.findIndex((feature) => feature.id === project.historyEnd) + 1;

  const hasObjectSelection = selection.some((item) => item.kind !== 'feature');
  const hasFeatureSelection = selection.some((item) => item.kind === 'feature');
  const dimmingEnabled = hasObjectSelection && !hasFeatureSelection;
  const highlightedFeatureIds = selectedFeatureIds(selection, project);

  // Rebuild stops at the first failed operation, so nothing after it exists.
  const failedIndex = project.features.findIndex((feature) => featureErrors[feature.id]);
  const blockedPosition = (index: number) => failedIndex >= 0 && index > failedIndex;
  // Only the cursor immediately after the failure is red; later ones are just
  // inactive and never highlight on hover.
  const barrierPosition = (index: number) => failedIndex >= 0 && index === failedIndex + 1;
  const pastFailurePosition = (index: number) => failedIndex >= 0 && index > failedIndex + 1;

  const goTo = (index: number) => {
    if (index === 0) setHistoryEnd(HISTORY_START);
    else if (index === project.features.length) setHistoryEnd(null);
    else setHistoryEnd(project.features[index - 1]?.id ?? null);
  };

  const timelineTooltip = (feature: Feature, error: string | undefined) =>
    error ? (
      <span className="timeline-tooltip">
        <span className="timeline-tooltip-name">{feature.name}</span>
        <span>{t('timeline.errorHint')}</span>
        <span className="timeline-tooltip-error">
          {translate(t, `errors.${error}`, error)}
        </span>
      </span>
    ) : (
      feature.name
    );

  return (
    <div className="panel timeline-panel" data-locked={locked ? 'true' : undefined}>
      <div className="timeline-body">
        {project.features.length === 0 ? (
          <p className="empty-row">{t('timeline.empty')}</p>
        ) : (
          <div className="timeline-track">
            {project.features.map((feature, index) => {
              const direct = isDirectlySelected(selection, 'feature', feature.id);
              const related = highlightedFeatureIds.includes(feature.id);
              const dimmed = dimmingEnabled && !related;
              const rolledBack = index >= position;
              return (
                <div key={feature.id} className="timeline-step">
                  <RollbackCaret
                    index={index}
                    active={position === index && !pastFailurePosition(index)}
                    disabled={locked}
                    blocked={barrierPosition(index)}
                    pastFailure={pastFailurePosition(index)}
                    onSelect={() => goTo(index)}
                  />
                  <Tooltip content={timelineTooltip(feature, featureErrors[feature.id])}>
                    <button
                      type="button"
                      className={clsx(
                        'timeline-op',
                        direct && 'selected',
                        dimmed && 'dimmed',
                        (rolledBack || feature.suppressed) && 'muted',
                        Boolean(featureErrors[feature.id]) && 'error',
                      )}
                      aria-label={feature.name}
                      onContextMenu={(event) =>
                        showContextMenu(event, [
                          {
                            id: 'rollback',
                            label: t('timeline.rollback'),
                            icon: <CornerUpLeft size={14} />,
                            disabled:
                              locked || position === index + 1 || blockedPosition(index + 1),
                            onSelect: () => goTo(index + 1),
                          },
                          {
                            id: 'delete',
                            label: t('context.deleteOperation'),
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: () => removeFeature(feature.id),
                          },
                        ])
                      }
                      onClick={(event) =>
                        select(
                          { kind: 'feature', id: feature.id },
                          { additive: event.metaKey || event.ctrlKey || event.shiftKey },
                        )
                      }
                      onDoubleClick={() => {
                        if (feature.type === 'sketch') setActiveSketch(feature.id);
                      }}
                    >
                      <FeatureIcon feature={feature} />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
            <RollbackCaret
              index={project.features.length}
              active={
                position === project.features.length &&
                !pastFailurePosition(project.features.length)
              }
              disabled={locked}
              blocked={barrierPosition(project.features.length)}
              pastFailure={pastFailurePosition(project.features.length)}
              onSelect={() => goTo(project.features.length)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
