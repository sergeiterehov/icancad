import { HISTORY_START, objectVisible, sketchObjectId, type Feature } from '@icancad/model';
import clsx from 'clsx';
import { CornerUpLeft, Eye, EyeOff, Pencil, SquareChevronsRight, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore, useViewModel } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, menuFeatureIds, selectedFeatureIds } from '../stores/selection';
import { canEditSketch } from '../sketch/sectionPlane';
import { rebuildFrom } from '../kernel/rebuild';
import { showContextMenu } from './ContextMenu';
import { FeatureIcon } from './featureIcons';
import { KernelStatus } from './KernelStatus';
import { Tooltip } from './Tooltip';
import { translate } from './translate';
import { timelineCaretMark, type TimelineCaretMark } from './timelineCaret';
import { chipOpensSketch, chipSelects } from './operationStrip';
import { useListSelection } from './useListSelection';

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
  const project = useViewModel();
  const selection = useDocumentStore((state) => state.selection);
  const selectMany = useDocumentStore((state) => state.selectMany);
  const setHistoryEnd = useDocumentStore((state) => state.setHistoryEnd);
  const removeFeatures = useDocumentStore((state) => state.removeFeatures);
  const setObjectsVisible = useDocumentStore((state) => state.setObjectsVisible);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const projectionLost = useKernelStore((state) => state.projectionLost);
  const rebuildCursor = useKernelStore((state) => state.rebuildCursor);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  // While an operation is being edited the model is evaluated at its position,
  // so the cursor stays put until the operation is dismissed.
  const locked = activeSketchId !== null || editingFeatureId !== null;

  // The strip is a list of operations in build order, so Shift takes the range
  // between two chips just like it does between two rows of the tree. A finger
  // gets no such range and nothing to add a row to: an operation is the one
  // thing being edited, so a tap takes it on its own.
  const clickFeature = useListSelection({
    ids: project.features.map((feature) => feature.id),
    selected: selection.filter((item) => item.kind === 'feature').map((item) => item.id),
    finger: 'replace',
    onSelect: (ids, { id }) =>
      selectMany(
        ids.map((featureId) => ({ kind: 'feature' as const, id: featureId })),
        { kind: 'feature', id },
      ),
  });

  const position =
    project.historyEnd === null
      ? project.features.length
      : project.historyEnd === HISTORY_START
        ? 0
        : project.features.findIndex((feature) => feature.id === project.historyEnd) + 1;

  // Adding an operation moves the cursor to its end; the strip follows once the
  // operation is committed, so the cursor stays in the middle of the panel
  // instead of running out of it.
  const track = useRef<HTMLDivElement>(null);
  const count = project.features.length;
  const previousCount = useRef(count);
  const follow = useRef(false);
  useEffect(() => {
    if (count > previousCount.current) follow.current = true;
    previousCount.current = count;
    if (!follow.current || locked) return;
    follow.current = false;
    const strip = track.current;
    const caret = strip?.querySelector<HTMLElement>('.timeline-caret.active');
    if (!strip || !caret) return;
    // Scroll the strip itself: scrollIntoView also walks the document, which
    // shifts the whole workspace when a model switch changes the caret.
    const stripBox = strip.getBoundingClientRect();
    const caretBox = caret.getBoundingClientRect();
    strip.scrollTo({
      left:
        strip.scrollLeft + caretBox.left - stripBox.left - (strip.clientWidth - caretBox.width) / 2,
      behavior: 'smooth',
    });
  }, [count, position, locked]);

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

  const projectionWarning = (feature: Feature) => (projectionLost[feature.id]?.length ?? 0) > 0;

  const timelineTooltip = (feature: Feature, error: string | undefined) =>
    error ? (
      <span className="timeline-tooltip">
        <span className="timeline-tooltip-name">{feature.name}</span>
        <span>{t('timeline.errorHint')}</span>
        <span className="timeline-tooltip-error">{translate(t, `errors.${error}`, error)}</span>
      </span>
    ) : projectionWarning(feature) ? (
      <span className="timeline-tooltip">
        <span className="timeline-tooltip-name">{feature.name}</span>
        <span className="timeline-tooltip-warning">{t('timeline.projectionWarning')}</span>
      </span>
    ) : (
      feature.name
    );

  return (
    <div
      className="panel timeline-panel"
      data-testid="timeline"
      data-locked={locked ? 'true' : undefined}
    >
      <div className="timeline-body">
        {project.features.length === 0 ? (
          <p className="empty-row">{t('timeline.empty')}</p>
        ) : (
          <div className="timeline-track" ref={track}>
            {project.features.map((feature, index) => {
              const direct = isDirectlySelected(selection, 'feature', feature.id);
              const related = highlightedFeatureIds.includes(feature.id);
              const dimmed = dimmingEnabled && !related;
              const sketchEditable =
                feature.type === 'sketch' && canEditSketch(feature, featureErrors);
              // The operation being edited sits behind the cursor, but the user
              // is working on it: it must stay as bright as the rest.
              const rolledBack = index >= position && feature.id !== editingFeatureId;
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
                        !featureErrors[feature.id] && projectionWarning(feature) && 'warning',
                      )}
                      aria-label={feature.name}
                      onContextMenu={(event) => {
                        // Right-clicking a chip keeps the operation selection it
                        // belongs to, like every other menu in the app.
                        const targets = menuFeatureIds(selection, feature.id);
                        const sketchObject =
                          feature.type === 'sketch' ? sketchObjectId(feature.id) : null;
                        const sketchVisible = sketchObject
                          ? objectVisible(project, sketchObject)
                          : true;
                        showContextMenu(event, [
                          // A sketch is the one operation with a mode of its own:
                          // its menu offers that mode, and that is what tells it
                          // apart from a plain click on the chip, which only
                          // selects. Every other operation is edited where its
                          // parameters are, so it has nothing to add here.
                          ...(feature.type === 'sketch'
                            ? [
                                {
                                  id: 'edit',
                                  label: t('sketch.edit'),
                                  icon: <Pencil size={14} />,
                                  onSelect: () => setActiveSketch(feature.id),
                                  ...(sketchEditable ? {} : { disabled: true }),
                                },
                              ]
                            : []),
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
                          // A sketch is an object of the model too, so its
                          // operation hides and shows the same lines.
                          ...(sketchObject
                            ? [
                                {
                                  id: 'visibility',
                                  label: sketchVisible ? t('tree.hide') : t('tree.show'),
                                  icon: sketchVisible ? <EyeOff size={14} /> : <Eye size={14} />,
                                  onSelect: () =>
                                    setObjectsVisible([
                                      { objectId: sketchObject, visible: !sketchVisible },
                                    ]),
                                },
                              ]
                            : []),
                          {
                            id: 'delete',
                            label:
                              targets.length > 1
                                ? t('context.deleteOperations', { count: targets.length })
                                : t('context.deleteOperation'),
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: () => removeFeatures(targets),
                          },
                        ]);
                      }}
                      onClick={(event) => {
                        // The sketch editor owns the workspace, so the strip
                        // does not select an operation under it.
                        if (!chipSelects(activeSketchId)) return;
                        clickFeature(event, feature.id);
                      }}
                      onDoubleClick={() => {
                        // The one move the strip keeps in the editor: a second
                        // press hands it over to another sketch.
                        if (chipOpensSketch(feature, activeSketchId, sketchEditable)) {
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
      <KernelStatus />
    </div>
  );
}
