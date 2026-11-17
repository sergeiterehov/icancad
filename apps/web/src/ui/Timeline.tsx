import {
  HISTORY_START,
  groupFeatureIds,
  objectVisible,
  sketchObjectId,
  timelineNodes,
  type Feature,
  type GroupNode,
} from '@icancad/model';
import clsx from 'clsx';
import {
  ArrowLeft,
  CornerUpLeft,
  Eye,
  EyeOff,
  Folder,
  FolderMinus,
  FolderPlus,
  MousePointer2,
  Pencil,
  SquareChevronsRight,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore, useViewModel, type SelectionItem } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, selectedFeatureIds } from '../stores/selection';
import { canEditSketch } from '../sketch/sectionPlane';
import { rebuildFrom } from '../kernel/rebuild';
import { showContextMenu, type ContextMenuItem } from './ContextMenu';
import { FeatureIcon } from './featureIcons';
import { RenameInput } from './RenameInput';
import { KernelStatus } from './KernelStatus';
import { Tooltip } from './Tooltip';
import { translate } from './translate';
import { timelineCaretMark, type TimelineCaretMark } from './timelineCaret';
import { chipOpensSketch, chipSelects } from './operationStrip';
import {
  adjacentGroups,
  atLevelEdge,
  groupableRun,
  holdingGroup,
  levelCaretPosition,
  menuEntryTargets,
  menuRun,
} from './timelineGroups';
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
  const createGroup = useDocumentStore((state) => state.createGroup);
  const addToGroup = useDocumentStore((state) => state.addToGroup);
  const detachFromGroup = useDocumentStore((state) => state.detachFromGroup);
  const toggleSelection = useDocumentStore((state) => state.toggleSelection);
  const ungroupGroup = useDocumentStore((state) => state.ungroupGroup);
  const renameGroup = useDocumentStore((state) => state.renameGroup);
  const setObjectsVisible = useDocumentStore((state) => state.setObjectsVisible);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const projectionLost = useKernelStore((state) => state.projectionLost);
  const rebuildCursor = useKernelStore((state) => state.rebuildCursor);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const storedGroupId = useUiStore((state) => state.timelineGroupId);
  const setTimelineGroup = useUiStore((state) => state.setTimelineGroup);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  const editingFeature = editingFeatureId
    ? project.features.find((feature) => feature.id === editingFeatureId)
    : undefined;
  const pickingArrayOperations = useUiStore((state) => state.pickingArrayOperations);
  // The operations an array already repeats are marked only while it is asking
  // for them: the picking mode is what makes a marked chip mean "already in the
  // list", in the same violet a selected face has.
  const pickedOperations =
    pickingArrayOperations &&
    editingFeature?.type === 'array' &&
    editingFeature.target === 'geometry'
      ? new Set(editingFeature.featureIds)
      : null;
  // While an operation is being edited the model is evaluated at its position,
  // so the cursor stays put until the operation is dismissed. Picking operations
  // for an array is the one case that needs the strip to stay live: the chips
  // are exactly what it takes.
  const locked = activeSketchId !== null || (editingFeatureId !== null && !pickingArrayOperations);

  // A folder that no longer exists (an undone grouping, another model) is the
  // top level: the strip never shows a level it cannot name.
  const openGroup = storedGroupId
    ? project.groups.find((group) => group.id === storedGroupId)
    : undefined;
  const groupId = openGroup?.id ?? null;
  useEffect(() => {
    if (storedGroupId !== groupId) setTimelineGroup(groupId);
  }, [storedGroupId, groupId, setTimelineGroup]);
  // A level change closes an unfinished rename: the name it edited is another
  // folder's now.
  const [renaming, setRenaming] = useState(false);
  useEffect(() => setRenaming(false), [groupId]);

  const nodes = timelineNodes(project, groupId);
  const nodeKinds = new Map<string, SelectionItem['kind']>(
    nodes.map((node) => [node.id, node.kind]),
  );
  // Every caret on this level covers the flat positions of its own items: the
  // level decides where a position is shown, never the other way round.
  const levelStart = nodes[0]?.start ?? 0;
  const levelEnd = nodes.length > 0 ? (nodes[nodes.length - 1]?.end ?? 0) + 1 : levelStart;

  // The strip is a list of operations in build order, so Shift takes the range
  // between two chips just like it does between two rows of the tree. A finger
  // gets no such range and nothing to add a row to: an operation is the one
  // thing being edited, so a tap takes it on its own.
  const clickNode = useListSelection({
    ids: nodes.map((node) => node.id),
    selected: selection
      .filter((item) => item.kind === 'feature' || item.kind === 'group')
      .map((item) => item.id),
    finger: 'replace',
    onSelect: (ids, { id }) =>
      selectMany(
        ids.map((entryId) => ({
          kind: nodeKinds.get(entryId) ?? ('feature' as const),
          id: entryId,
        })),
        { kind: nodeKinds.get(id) ?? 'feature', id },
      ),
  });

  const position =
    project.historyEnd === null
      ? project.features.length
      : project.historyEnd === HISTORY_START
        ? 0
        : project.features.findIndex((feature) => feature.id === project.historyEnd) + 1;

  // A cursor inside a folder is not drawn on this level: the folder itself
  // wears the caret, so the strip keeps saying where the model stands.
  const holding = holdingGroup(nodes, position);
  const activePosition = holding ? null : levelCaretPosition(position, levelStart, levelEnd);

  // Adding an operation moves the cursor to its end; the strip follows once the
  // operation is committed, so the cursor stays in the middle of the panel
  // instead of running out of it.
  const track = useRef<HTMLDivElement>(null);
  const count = project.features.length;
  const previousCount = useRef(count);
  const follow = useRef(false);
  const revealCaret = useCallback(() => {
    const strip = track.current;
    const caret =
      strip?.querySelector<HTMLElement>('.timeline-caret.active') ??
      strip?.querySelector<HTMLElement>('.timeline-group.caret');
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
  }, []);
  useEffect(() => {
    if (count > previousCount.current) follow.current = true;
    previousCount.current = count;
    if (!follow.current || locked) return;
    follow.current = false;
    revealCaret();
  }, [count, position, locked, revealCaret]);
  // Entering a folder is a new level, so the caret it holds is what has to be
  // in view.
  const previousLevel = useRef(groupId);
  useEffect(() => {
    if (previousLevel.current === groupId) return;
    previousLevel.current = groupId;
    revealCaret();
  }, [groupId, revealCaret]);

  const hasObjectSelection = selection.some(
    (item) => item.kind !== 'feature' && item.kind !== 'group',
  );
  const hasFeatureSelection = selection.some((item) => item.kind === 'feature');
  // An object on its own does not dim the rest of the strip: the operations it
  // relates to are lit the way the pointer lights them, and everything else
  // stays as readable as before.
  const relatedHighlight = hasObjectSelection && !hasFeatureSelection;
  const highlightedFeatureIds = selectedFeatureIds(selection, project);
  const hoveredFeatureId = useUiStore((state) => state.hoveredFeature?.featureId ?? null);

  // Rebuild stops at the first failed operation, so nothing after it exists.
  // The red caret sits in front of that operation; the positions inside it and
  // after it describe operations the model never reached.
  const failedIndex = project.features.findIndex((feature) => featureErrors[feature.id]);
  const caretMark = (index: number) => timelineCaretMark(index, failedIndex);
  const blockedPosition = (index: number) => caretMark(index) === 'unreachable';

  // Carets are flat positions, not rows of the level: a folder covers as many
  // positions as it holds operations.
  const goToPosition = (flat: number) => {
    if (flat <= 0) setHistoryEnd(HISTORY_START);
    else if (flat >= project.features.length) setHistoryEnd(null);
    else setHistoryEnd(project.features[flat - 1]?.id ?? null);
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

  const groupItems = (ids: readonly string[]): SelectionItem[] =>
    ids.map((id) => ({ kind: nodeKinds.get(id) ?? ('feature' as const), id }));

  const deleteTargetsOf = (targets: readonly string[]) => [
    ...new Set(
      targets.flatMap((id) =>
        (nodeKinds.get(id) ?? 'feature') === 'group' ? groupFeatureIds(project, id) : [id],
      ),
    ),
  ];

  const nodeNames = new Map(
    nodes.map((node) => [node.id, node.kind === 'group' ? node.group.name : node.feature.name]),
  );

  /**
   * Selection and folder moves that both kinds of timeline entry share. The
   * run is the clicked item or the contiguous selection it belongs to; a gap
   * in the selection leaves only the clicked item movable.
   */
  const moveMenuItems = (clickedId: string, targets: readonly string[]): ContextMenuItem[] => {
    const run = menuRun(nodes, selection, clickedId);
    const targetItems = groupItems(targets);
    const allSelected = targetItems.every((item) =>
      selection.some((candidate) => candidate.kind === item.kind && candidate.id === item.id),
    );
    const items: ContextMenuItem[] = [
      {
        id: 'select',
        label: allSelected ? t('context.deselect') : t('context.select'),
        icon: <MousePointer2 size={14} />,
        onSelect: () => toggleSelection(targetItems),
      },
      { id: 'select-separator', separator: true },
    ];
    for (const adjacentId of adjacentGroups(nodes, run)) {
      const name = nodeNames.get(adjacentId) ?? '';
      items.push({
        id: `add-to-${adjacentId}`,
        label: t('context.addToGroup', { name }),
        icon: <FolderPlus size={14} />,
        onSelect: () => addToGroup(adjacentId, groupItems(run)),
      });
    }
    if (groupId !== null && atLevelEdge(nodes, run)) {
      items.push({
        id: 'detach-group',
        label: t('context.removeFromGroup'),
        icon: <FolderMinus size={14} />,
        onSelect: () => detachFromGroup(groupId, groupItems(run)),
      });
    }
    return items;
  };

  const groupTooltip = (node: GroupNode, error: boolean, warning: boolean) => (
    <span className="timeline-tooltip">
      <span className="timeline-tooltip-name">{node.group.name}</span>
      {error && <span className="timeline-tooltip-error">{t('timeline.errorHint')}</span>}
      {warning && (
        <span className="timeline-tooltip-warning">{t('timeline.projectionWarning')}</span>
      )}
    </span>
  );

  return (
    <div
      className="panel timeline-panel"
      data-testid="timeline"
      data-locked={locked ? 'true' : undefined}
    >
      <div className="timeline-body">
        {openGroup && (
          <div className="timeline-level">
            <Tooltip content={t('timeline.leaveGroup')}>
              <button
                type="button"
                className="timeline-level-exit"
                aria-label={t('timeline.leaveGroup')}
                onClick={() => setTimelineGroup(openGroup.parentId)}
              >
                <ArrowLeft size={16} />
              </button>
            </Tooltip>
            {renaming ? (
              <RenameInput
                label={t('inspector.name')}
                value={openGroup.name}
                onCommit={(name) => {
                  setRenaming(false);
                  renameGroup(openGroup.id, name);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <span className="timeline-level-name" onDoubleClick={() => setRenaming(true)}>
                {openGroup.name}
              </span>
            )}
          </div>
        )}
        <div className="timeline-scroll" ref={track}>
          {nodes.length === 0 ? (
            <p className="empty-row">{t('timeline.empty')}</p>
          ) : (
            <div className="timeline-track">
              {nodes.map((node) => {
                const flat = node.start;
                const direct = isDirectlySelected(selection, node.kind, node.id);
                const rolledBack = flat >= position;
                if (node.kind === 'group') {
                  const leaves = groupFeatureIds(project, node.id);
                  const error = leaves.some((id) => Boolean(featureErrors[id]));
                  const warning =
                    !error && leaves.some((id) => (projectionLost[id]?.length ?? 0) > 0);
                  const related =
                    leaves.includes(editingFeatureId ?? '') ||
                    leaves.some((id) => highlightedFeatureIds.includes(id)) ||
                    (pickingArrayOperations !== null && leaves.includes(hoveredFeatureId ?? ''));
                  const picked = leaves.some((id) => pickedOperations?.has(id) ?? false);
                  const caret = holding?.id === node.id;
                  return (
                    <div key={node.id} className="timeline-step">
                      <RollbackCaret
                        index={flat}
                        active={activePosition === flat && !blockedPosition(flat)}
                        disabled={locked}
                        mark={caretMark(flat)}
                        calculating={rebuildCursor === flat}
                        onSelect={() => goToPosition(flat)}
                      />
                      <Tooltip content={groupTooltip(node, error, warning)}>
                        <button
                          type="button"
                          className={clsx(
                            'timeline-op',
                            'timeline-group',
                            direct && 'selected',
                            related && 'related',
                            picked && 'picked',
                            rolledBack && 'muted',
                            error && 'error',
                            !error && warning && 'warning',
                            caret && 'caret',
                            caret && caretMark(position) === 'error' && 'caret-error',
                            caret && rebuildCursor === position && 'calculating',
                          )}
                          aria-label={node.group.name}
                          onContextMenu={(event) => {
                            const targets = menuEntryTargets(nodes, selection, node.id);
                            const deleteTargets = deleteTargetsOf(targets);
                            const run = groupableRun(nodes, selection, node.id);
                            showContextMenu(event, [
                              ...moveMenuItems(node.id, targets),
                              ...(run
                                ? [
                                    {
                                      id: 'group',
                                      label: t('context.group'),
                                      icon: <Folder size={14} />,
                                      onSelect: () => createGroup(groupItems(run)),
                                    },
                                  ]
                                : []),
                              {
                                id: 'ungroup',
                                label: t('context.ungroup'),
                                icon: <FolderMinus size={14} />,
                                onSelect: () => ungroupGroup(node.id),
                              },
                              {
                                id: 'delete',
                                label:
                                  targets.length > 1
                                    ? t('context.deleteOperations', {
                                        count: deleteTargets.length,
                                      })
                                    : t('context.deleteGroup'),
                                icon: <Trash2 size={14} />,
                                danger: true,
                                onSelect: () => removeFeatures(deleteTargets),
                              },
                            ]);
                          }}
                          onClick={(event) => {
                            // The sketch editor owns the workspace, so the strip
                            // does not select an operation under it.
                            if (!chipSelects(activeSketchId)) return;
                            clickNode(event, node.id);
                          }}
                          onDoubleClick={() => {
                            if (!chipSelects(activeSketchId)) return;
                            setTimelineGroup(node.id);
                          }}
                        >
                          <Folder size={16} />
                        </button>
                      </Tooltip>
                    </div>
                  );
                }
                const feature = node.feature;
                const picked = pickedOperations?.has(feature.id) ?? false;
                const related = relatedHighlight && highlightedFeatureIds.includes(feature.id);
                // Geometry under the pointer names its operation, but only while
                // operations are being picked: the strip answers a question the
                // picking mode is asking.
                const pointed = pickingArrayOperations !== null && hoveredFeatureId === feature.id;
                const sketchEditable =
                  feature.type === 'sketch' && canEditSketch(feature, featureErrors);
                // The operation being edited sits behind the cursor, but the user
                // is working on it: it must stay as bright as the rest.
                const editing = feature.id === editingFeatureId;
                const targets = menuEntryTargets(nodes, selection, feature.id);
                const deleteTargets = deleteTargetsOf(targets);
                const run = groupableRun(nodes, selection, feature.id);
                return (
                  <div key={feature.id} className="timeline-step">
                    <RollbackCaret
                      index={flat}
                      active={activePosition === flat && !blockedPosition(flat)}
                      disabled={locked}
                      mark={caretMark(flat)}
                      calculating={rebuildCursor === flat}
                      onSelect={() => goToPosition(flat)}
                    />
                    <Tooltip content={timelineTooltip(feature, featureErrors[feature.id])}>
                      <button
                        type="button"
                        className={clsx(
                          'timeline-op',
                          direct && 'selected',
                          picked && 'picked',
                          (related || pointed) && 'related',
                          ((rolledBack && !editing) || feature.suppressed) && 'muted',
                          Boolean(featureErrors[feature.id]) && 'error',
                          !featureErrors[feature.id] && projectionWarning(feature) && 'warning',
                        )}
                        aria-label={feature.name}
                        onContextMenu={(event) => {
                          const sketchObject =
                            feature.type === 'sketch' ? sketchObjectId(feature.id) : null;
                          const sketchVisible = sketchObject
                            ? objectVisible(project, sketchObject)
                            : true;
                          showContextMenu(event, [
                            ...moveMenuItems(feature.id, targets),
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
                                locked || position === flat + 1 || blockedPosition(flat + 1),
                              onSelect: () => goToPosition(flat + 1),
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
                            ...(run
                              ? [
                                  {
                                    id: 'group',
                                    label: t('context.group'),
                                    icon: <Folder size={14} />,
                                    onSelect: () => createGroup(groupItems(run)),
                                  },
                                ]
                              : []),
                            {
                              id: 'delete',
                              label:
                                targets.length > 1
                                  ? t('context.deleteOperations', { count: deleteTargets.length })
                                  : t('context.deleteOperation'),
                              icon: <Trash2 size={14} />,
                              danger: true,
                              onSelect: () => removeFeatures(deleteTargets),
                            },
                          ]);
                        }}
                        onClick={(event) => {
                          // The sketch editor owns the workspace, so the strip
                          // does not select an operation under it.
                          if (!chipSelects(activeSketchId)) return;
                          clickNode(event, feature.id);
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
                index={levelEnd}
                active={activePosition === levelEnd && !blockedPosition(levelEnd)}
                disabled={locked}
                mark={caretMark(levelEnd)}
                calculating={rebuildCursor === levelEnd}
                onSelect={() => goToPosition(levelEnd)}
              />
            </div>
          )}
        </div>
      </div>
      <KernelStatus />
    </div>
  );
}
