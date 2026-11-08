import { HISTORY_START, type Feature } from '@icancad/model';
import clsx from 'clsx';
import { ArrowBigUp, Box, CornerUpLeft, Layers, PenTool, Scissors, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, selectedFeatureIds } from '../stores/selection';
import { showContextMenu } from './ContextMenu';
import { Tooltip } from './Tooltip';

function FeatureIcon({ type }: { type: Feature['type'] }) {
  switch (type) {
    case 'primitive':
      return <Box size={16} />;
    case 'sketch':
      return <PenTool size={16} />;
    case 'extrude':
      return <ArrowBigUp size={16} />;
    case 'boolean':
      return <Scissors size={16} />;
    default:
      return <Layers size={16} />;
  }
}

function RollbackCaret({
  index,
  active,
  onSelect,
}: {
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const label = t('timeline.goTo', { index });
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={clsx('timeline-caret', active && 'active')}
        aria-label={label}
        aria-pressed={active}
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

  const position =
    project.historyEnd === null
      ? project.features.length
      : project.historyEnd === HISTORY_START
        ? 0
        : project.features.findIndex((feature) => feature.id === project.historyEnd) + 1;

  const hasBodySelection = selection.some((item) => item.kind === 'body');
  const hasFeatureSelection = selection.some((item) => item.kind === 'feature');
  const dimmingEnabled = hasBodySelection && !hasFeatureSelection;
  const highlightedFeatureIds = selectedFeatureIds(selection, project);

  const goTo = (index: number) => {
    if (index === 0) setHistoryEnd(HISTORY_START);
    else if (index === project.features.length) setHistoryEnd(null);
    else setHistoryEnd(project.features[index - 1]?.id ?? null);
  };

  return (
    <div className="panel timeline-panel">
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
                    active={position === index}
                    onSelect={() => goTo(index)}
                  />
                  <Tooltip content={feature.name}>
                    <button
                      type="button"
                      className={clsx(
                        'timeline-op',
                        direct && 'selected',
                        dimmed && 'dimmed',
                        (rolledBack || feature.suppressed) && 'muted',
                      )}
                      aria-label={feature.name}
                      onContextMenu={(event) =>
                        showContextMenu(event, [
                          {
                            id: 'rollback',
                            label: t('timeline.rollback'),
                            icon: <CornerUpLeft size={14} />,
                            disabled: position === index + 1,
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
                    >
                      <FeatureIcon type={feature.type} />
                      {featureErrors[feature.id] && <span className="tree-badge error">!</span>}
                    </button>
                  </Tooltip>
                </div>
              );
            })}
            <RollbackCaret
              index={project.features.length}
              active={position === project.features.length}
              onSelect={() => goTo(project.features.length)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
