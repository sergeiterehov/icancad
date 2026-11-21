import {
  activeFeatureIds,
  activeModel,
  bodiesInHistory,
  featureBodyId,
  objectColor,
  objectVisible,
  SKETCH_COLOR,
  sketchObjectId,
  type BodyObject,
  type SketchFeature,
} from '@icancad/model';
import clsx from 'clsx';
import {
  AlertTriangle,
  Box,
  Eye,
  EyeOff,
  PawPrint,
  Pencil,
  SquareMinus,
  SquarePen,
  SquarePlus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { canEditSketch, sketchPlaneReady } from '../sketch/sectionPlane';
import {
  useDocumentStore,
  useViewModel,
  type SelectionItem,
  type SelectionKind,
} from '../stores/documentStore';
import { useKernelStore, type PreviewBodyMark, type PreviewMarkKind } from '../stores/kernelStore';
import { isDirectlySelected, linkedBodyIds } from '../stores/selection';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import {
  colorMenuItem,
  deleteMenuItem,
  objectTargets,
  transformMenuItem,
  visibilityMenuItem,
} from './objectMenu';
import { showContextMenu, type ContextMenuItem } from './ContextMenu';
import { FeatureIcon, SketchIcon } from './featureIcons';
import { ModelSwitcher } from './ModelSwitcher';
import { RenameInput } from './RenameInput';
import { Tooltip } from './Tooltip';
import { useListSelection } from './useListSelection';

/** One row of the tree, in the order it is shown. */
type TreeEntry =
  | { kind: 'body'; key: string; body: BodyObject }
  | { kind: 'sketch'; key: string; feature: SketchFeature; phantom: boolean }
  | { kind: 'preview'; key: string; mark: PreviewBodyMark };

/** The document object a body row stands for. */
function bodySelection(body: BodyObject): SelectionItem {
  return { kind: body.kind === 'mesh' ? 'mesh' : 'body', id: body.id };
}

/** Key a list row is selected by: the object it names. */
function selectionKey(item: SelectionItem): string {
  return `${item.kind}:${item.id}`;
}

/** The object a row selects, or null for a row that cannot be selected. */
function entrySelection(entry: TreeEntry): SelectionItem | null {
  if (entry.kind === 'body') return bodySelection(entry.body);
  if (entry.kind === 'sketch' && !entry.phantom) {
    return { kind: 'sketch', id: entry.feature.id };
  }
  return null;
}

export function LeftPanel() {
  const { t } = useTranslation();
  const project = useViewModel();
  const activeIds = activeFeatureIds(project);
  const selection = useDocumentStore((state) => state.selection);
  const selectMany = useDocumentStore((state) => state.selectMany);
  const toggleBodyVisibility = useDocumentStore((state) => state.toggleBodyVisibility);
  const toggleSketchVisibility = useDocumentStore((state) => state.toggleSketchVisibility);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const consumedBodies = useKernelStore((state) => state.consumedBodies);
  const projectionLost = useKernelStore((state) => state.projectionLost);
  const preview = useKernelStore((state) => state.preview);
  const bodies = bodiesInHistory(project, consumedBodies);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const pickingArrayBodies = useUiStore((state) => state.pickingArrayBodies);
  const [renaming, setRenaming] = useState<string | null>(null);
  // While an array waits for bodies, the ones it already has stay readable in
  // the tree in the same accent as a selection.
  const pickedArrayBodies = (() => {
    if (!pickingArrayBodies) return null;
    const feature = project.features.find((candidate) => candidate.id === pickingArrayBodies);
    return feature?.type === 'array' ? new Set(feature.bodyIds) : null;
  })();

  // Renaming happens in the tree: double click on an object row, or the context
  // menu. A sketch row is the operation that creates it, so its name is stored
  // on the feature instead of in the object metadata.
  const renameObject = (objectId: string, name: string) => {
    useDocumentStore.getState().apply({ type: 'metadata/patch', objectId, patch: { name } });
  };
  const renameSketch = (feature: SketchFeature, name: string) => {
    useDocumentStore.getState().apply({ type: 'feature/replace', feature: { ...feature, name } });
  };
  // The context menu acts on the whole selection: right-clicking a row that is
  // not selected selects it first.
  const ensureSelected = (kind: SelectionKind, id: string) => {
    const state = useDocumentStore.getState();
    if (state.selection.some((item) => item.kind === kind && item.id === id)) return;
    state.select({ kind, id });
  };

  const objectMenu = (renameTargetId?: string): ContextMenuItem[] => {
    const state = useDocumentStore.getState();
    const targets = objectTargets(activeModel(state.project), state.selection);
    const single = targets.length === 1;
    const items: ContextMenuItem[] = [];
    if (single && renameTargetId) {
      items.push({
        id: 'rename',
        label: t('context.rename'),
        icon: <Pencil size={14} />,
        onSelect: () => setRenaming(renameTargetId),
      });
    }
    const color = colorMenuItem(targets, t('context.color'));
    if (color) items.push(color);
    const visibility = visibilityMenuItem(targets, {
      hide: t('tree.hide'),
      show: t('tree.show'),
    });
    if (visibility) items.push(visibility);
    const transform = transformMenuItem(targets, t('features.transform'));
    if (transform) items.push(transform);
    const remove = deleteMenuItem(
      targets,
      single ? t('context.deleteObject') : t('context.deleteSelected', { count: targets.length }),
    );
    if (remove) items.push(remove);
    return items;
  };

  const highlightedBodyIds = linkedBodyIds(selection, project);
  const hasSketches = project.features.some(
    (feature) =>
      feature.type === 'sketch' &&
      (activeIds.has(feature.id) || feature.id === preview?.featureId) &&
      sketchPlaneReady(feature) &&
      !featureErrors[feature.id],
  );
  // The operation being edited reports which objects it adds, changes or
  // removes, so the tree shows the same phantom delta as the viewport.
  // A silent mark exists so picking uses the input shape; the tree says nothing
  // about it, because the object itself does not change.
  const previewMarks = new Map(
    (preview?.bodies ?? []).filter((mark) => !mark.silent).map((mark) => [mark.id, mark]),
  );
  const previewAdded = (preview?.bodies ?? []).filter((mark) => mark.kind === 'added');
  const isEmpty = bodies.length === 0 && !hasSketches && previewAdded.length === 0;

  // The tree is a list like every other one: the rows are collected in the
  // order they are shown, so a Shift click can take the range between two of
  // them. Rows the operation only previews are not part of it: they cannot be
  // selected, so they cannot be inside a range either.
  const bodiesByCreator = new Map<string, BodyObject[]>();
  for (const body of bodies) {
    const list = bodiesByCreator.get(body.createdBy) ?? [];
    list.push(body);
    bodiesByCreator.set(body.createdBy, list);
  }
  const placedBodies = new Set<string>();
  const entries: TreeEntry[] = [];

  // The operation being edited is not in the active history, but its preview is
  // on screen, so its sketch object is listed as a phantom row.
  const previewedSketchId = preview?.featureId ?? null;
  for (const feature of project.features) {
    const previewedSketch = feature.id === previewedSketchId && feature.type === 'sketch';
    if (!activeIds.has(feature.id) && !previewedSketch) continue;
    if (feature.type === 'sketch') {
      if (sketchPlaneReady(feature) && !featureErrors[feature.id]) {
        entries.push({
          kind: 'sketch',
          key: selectionKey({ kind: 'sketch', id: feature.id }),
          feature,
          phantom: previewedSketch && !activeIds.has(feature.id),
        });
      }
    }
    for (const body of bodiesByCreator.get(feature.id) ?? []) {
      entries.push({ kind: 'body', key: selectionKey(bodySelection(body)), body });
      placedBodies.add(body.id);
    }
  }
  for (const body of bodies) {
    if (!placedBodies.has(body.id)) {
      entries.push({ kind: 'body', key: selectionKey(bodySelection(body)), body });
    }
  }
  // Objects the edited operation will add are not document objects yet: they
  // are shown dimmed and cannot be selected.
  for (const mark of previewAdded) {
    if (bodies.some((body) => body.id === mark.id)) continue;
    entries.push({ kind: 'preview', key: `preview-${mark.id}`, mark });
  }

  const selectable = entries.flatMap((entry) => {
    const item = entrySelection(entry);
    return item ? [{ key: entry.key, item }] : [];
  });
  const itemByKey = new Map(selectable.map(({ key, item }) => [key, item]));
  const clickRow = useListSelection({
    ids: selectable.map(({ key }) => key),
    selected: selection.map(selectionKey),
    onSelect: (keys, { id }) => {
      const clicked = itemByKey.get(id);
      if (!clicked) return;
      selectMany(
        keys.flatMap((key) => {
          const item = itemByKey.get(key);
          return item ? [item] : [];
        }),
        clicked,
      );
    },
  });

  const markIcon = (kind: PreviewMarkKind) => {
    if (kind === 'added') return <SquarePlus size={13} />;
    if (kind === 'modified') return <SquarePen size={13} />;
    return <SquareMinus size={13} />;
  };
  const markLabel = (kind: PreviewMarkKind) =>
    kind === 'added'
      ? t('tree.previewAdded')
      : kind === 'modified'
        ? t('tree.previewModified')
        : t('tree.previewRemoved');

  const renderBody = (body: BodyObject): ReactNode => {
    const kind = body.kind === 'mesh' ? 'mesh' : 'body';
    const direct = isDirectlySelected(selection, kind, body.id);
    const picked = pickedArrayBodies?.has(body.id) ?? false;
    const linked = !direct && highlightedBodyIds.includes(body.id);
    const mark = previewMarks.get(body.id);
    return (
      <div
        key={body.id}
        className={clsx(
          'tree-row',
          direct && 'selected',
          picked && 'picked',
          linked && 'linked',
          !body.visible && 'muted',
          mark && `preview-${mark.kind}`,
        )}
        onContextMenu={(event) => {
          ensureSelected(kind, body.id);
          showContextMenu(event, objectMenu(body.id));
        }}
      >
        {renaming === body.id ? (
          <span className="tree-main">
            <span className="tree-icon" style={{ color: body.color }}>
              {body.kind === 'mesh' ? <PawPrint size={14} /> : <Box size={14} />}
            </span>
            <RenameInput
              label={t('context.rename')}
              value={body.name}
              onCommit={(name) => {
                setRenaming(null);
                renameObject(body.id, name);
              }}
              onCancel={() => setRenaming(null)}
            />
          </span>
        ) : (
          <button
            type="button"
            className="tree-main"
            onClick={(event) => clickRow(event, selectionKey({ kind, id: body.id }))}
            onDoubleClick={() => setRenaming(body.id)}
          >
            <span className="tree-icon" style={{ color: body.color }}>
              {body.kind === 'mesh' ? <PawPrint size={14} /> : <Box size={14} />}
            </span>
            <span className="tree-name">{body.name}</span>
          </button>
        )}
        {mark && (
          <Tooltip content={markLabel(mark.kind)}>
            <span
              className={clsx('tree-preview-icon', mark.kind)}
              aria-label={markLabel(mark.kind)}
            >
              {markIcon(mark.kind)}
            </span>
          </Tooltip>
        )}
        <IconButton
          label={body.visible ? t('tree.hide') : t('tree.show')}
          className="tiny tree-eye"
          data-hidden={String(!body.visible)}
          onClick={() => toggleBodyVisibility(body.id)}
        >
          {body.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </IconButton>
      </div>
    );
  };

  const renderSketch = (feature: SketchFeature, phantom = false): ReactNode => {
    if (phantom) {
      // The edited sketch is the operation's result: shown, not selectable.
      return (
        <div
          key={feature.id}
          className="tree-row preview-added"
          aria-label={t('tree.previewAdded')}
        >
          <span className="tree-main">
            <span
              className="tree-icon"
              style={{ color: objectColor(project, sketchObjectId(feature.id), SKETCH_COLOR) }}
            >
              <SketchIcon size={14} />
            </span>
            <span className="tree-name">{feature.name}</span>
          </span>
          <span className="tree-preview-icon added" aria-hidden="true">
            <SquarePlus size={13} />
          </span>
        </div>
      );
    }
    const direct = isDirectlySelected(selection, 'sketch', feature.id);
    const linked =
      !direct && selection.some((item) => item.kind === 'feature' && item.id === feature.id);
    const objectId = sketchObjectId(feature.id);
    const visible = objectVisible(project, objectId);
    return (
      <div
        key={feature.id}
        className={clsx('tree-row', direct && 'selected', linked && 'linked', !visible && 'muted')}
        onContextMenu={(event) => {
          ensureSelected('sketch', feature.id);
          showContextMenu(event, [
            {
              id: 'edit',
              label: t('sketch.edit'),
              icon: <SketchIcon size={14} />,
              onSelect: () => setActiveSketch(feature.id),
              disabled: !canEditSketch(feature, featureErrors),
            },
            ...objectMenu(feature.id),
          ]);
        }}
      >
        {renaming === feature.id ? (
          <span className="tree-main">
            <span
              className="tree-icon"
              style={{ color: objectColor(project, objectId, SKETCH_COLOR) }}
            >
              <SketchIcon size={14} />
            </span>
            <RenameInput
              label={t('context.rename')}
              value={feature.name}
              onCommit={(name) => {
                setRenaming(null);
                renameSketch(feature, name);
              }}
              onCancel={() => setRenaming(null)}
            />
          </span>
        ) : (
          <button
            type="button"
            className="tree-main"
            onClick={(event) => clickRow(event, selectionKey({ kind: 'sketch', id: feature.id }))}
            onDoubleClick={() => {
              if (canEditSketch(feature, featureErrors)) setActiveSketch(feature.id);
            }}
          >
            <span
              className="tree-icon"
              style={{ color: objectColor(project, objectId, SKETCH_COLOR) }}
            >
              <SketchIcon size={14} />
            </span>
            <span className="tree-name">{feature.name}</span>
          </button>
        )}
        {(projectionLost[feature.id]?.length ?? 0) > 0 && (
          <Tooltip content={t('tree.projectionLost')}>
            <span className="tree-warning-icon" aria-label={t('tree.projectionLost')}>
              <AlertTriangle size={13} />
            </span>
          </Tooltip>
        )}
        <IconButton
          label={visible ? t('tree.hide') : t('tree.show')}
          className="tiny tree-eye"
          data-hidden={String(!visible)}
          onClick={() => toggleSketchVisibility(feature.id)}
        >
          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </IconButton>
      </div>
    );
  };

  const renderPreview = (mark: PreviewBodyMark): ReactNode => {
    const creator = project.features.find((candidate) => featureBodyId(candidate.id) === mark.id);
    return (
      <div
        key={`preview-${mark.id}`}
        className="tree-row preview-added"
        aria-label={t('tree.previewAdded')}
      >
        <span className="tree-main">
          <span className="tree-icon" style={{ color: mark.color }}>
            {creator ? <FeatureIcon feature={creator} size={14} /> : <Box size={14} />}
          </span>
          <span className="tree-name">{mark.name}</span>
        </span>
        <span className="tree-preview-icon added" aria-hidden="true">
          <SquarePlus size={13} />
        </span>
      </div>
    );
  };

  const rows = entries.map((entry) =>
    entry.kind === 'body'
      ? renderBody(entry.body)
      : entry.kind === 'sketch'
        ? renderSketch(entry.feature, entry.phantom)
        : renderPreview(entry.mark),
  );

  return (
    <div className="panel">
      <ModelSwitcher />
      <div className="panel-body">
        {isEmpty ? (
          <div className="panel-empty">
            <p className="empty-row">{t('tree.emptyObjects')}</p>
          </div>
        ) : (
          <div className="tree-list">{rows}</div>
        )}
      </div>
    </div>
  );
}
