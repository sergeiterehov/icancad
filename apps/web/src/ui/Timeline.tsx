import { HISTORY_START, type Feature } from '@icancad/model';
import clsx from 'clsx';
import {
  Box,
  CornerUpLeft,
  FileUp,
  Layers,
  PencilRuler,
  Scissors,
  SquareChevronsRight,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, selectedFeatureIds } from '../stores/selection';
import { canEditSketch } from '../sketch/sectionPlane';
import { rebuildFrom } from '../kernel/rebuild';
import { showContextMenu } from './ContextMenu';
import { ChamferIcon, FilletIcon } from './edgeIcons';
import { ExtrudeOpIcon } from './featureIcons';
import { Tooltip } from './Tooltip';
import { translate } from './translate';
import { timelineCaretMark, type TimelineCaretMark } from './timelineCaret';

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
    // The history names the concrete operation, so it shows the kind's icon.
    case 'edge-treatment':
      return feature.kind === 'chamfer' ? (
        <ChamferIcon size={16} />
      ) : (
        <FilletIcon size={16} />
      );
    default:
      return <Layers size={16} />;
  }
}

function RollbackCaret({
  index,
  active,
  disabled,
  mark,
  calculating,
  onSelect,
}: {
  index: number;
  active: boolean;
  disabled?: boolean;
  /** Position of the caret relative to the first failed operation. */
  mark: TimelineCaretMark;
  calculating?: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const label = mark === 'error' ? t('timeline.failedNext') : t('timeline.goTo', { index });
  const unreachable = mark === 'unreachable';
  return (
    <Tooltip
      content={unreachable ? t('timeline.blockedByError') : disabled ? t('timeline.locked') : label}
    >
      <button
        type="button"
        className={clsx(
          'timeline-caret',
          active && 'active',
          mark === 'error' && 'error',
          calculating && 'calculating',
        )}
        aria-label={unreachable ? t('timeline.blockedByError') : label}
        aria-pressed={active}
        disabled={disabled || unreachable}
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
  const rebuildCursor = useKernelStore((state) => state.rebuildCursor);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  // While an operation is being edited the model is evaluated at its position,
  // so the cursor stays put until the operation is dismissed.
  const locked = activeSketchId !== null || editingFeatureId !== null;

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
  // The red caret sits in front of that operation; the positions inside it and
  // after it describe operations the model never reached.
  const failedIndex = project.features.findIndex((feature) => featureErrors[feature.id]);
  const caretMark = (index: number) => timelineCaretMark(index, failedIndex);
  const blockedPosition = (index: number) => caretMark(index) === 'unreachable';

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
                    active={position === index && !blockedPosition(index)}
                    disabled={locked}
                    mark={caretMark(index)}
                    calculating={rebuildCursor === index}
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
                            id: 'rebuild',
                            label: t('context.rebuildFromHere'),
                            icon: <SquareChevronsRight size={14} />,
                            onSelect: () => rebuildFrom(feature.id),
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
                        if (feature.type === 'sketch' && canEditSketch(feature, featureErrors)) {
                          setActiveSketch(feature.id);
                        }
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
                position === project.features.length && !blockedPosition(project.features.length)
              }
              disabled={locked}
              mark={caretMark(project.features.length)}
              calculating={rebuildCursor === project.features.length}
              onSelect={() => goTo(project.features.length)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
