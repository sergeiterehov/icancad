import {
  activeFeatureIds,
  bodiesInHistory,
  createId,
  objectColor,
  objectVisible,
  SKETCH_COLOR,
  sketchObjectId,
  type BodyObject,
  type MeshFormat,
  type SketchFeature,
} from '@icancad/model';
import clsx from 'clsx';
import {
  Box,
  Eye,
  EyeOff,
  FileUp,
  PawPrint,
  Pencil,
  PencilRuler,
  Plus,
  SquareMinus,
  SquarePen,
  SquarePlus,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { saveAsset } from '../persistence/db';
import { canEditSketch, sketchPlaneReady } from '../sketch/sectionPlane';
import {
  useDocumentStore,
  useViewProject,
  type SelectionKind,
} from '../stores/documentStore';
import { useKernelStore, type PreviewMarkKind } from '../stores/kernelStore';
import { isDirectlySelected, linkedBodyIds } from '../stores/selection';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import {
  colorMenuItem,
  deleteMenuItem,
  objectTargets,
  visibilityMenuItem,
} from './objectMenu';
import { showContextMenu, useContextMenuStore, type ContextMenuItem } from './ContextMenu';
import { Tooltip } from './Tooltip';

const MESH_ACCEPT = '.stl,.obj,.ply,.glb';

const MESH_FORMATS: Record<string, MeshFormat> = {
  stl: 'stl',
  obj: 'obj',
  ply: 'ply',
  glb: 'glb',
};

const MESH_MIME: Record<MeshFormat, string> = {
  stl: 'model/stl',
  obj: 'text/plain',
  ply: 'application/octet-stream',
  glb: 'model/gltf-binary',
};

// The tree renames in place; committing happens on Enter or on blur.
function RenameInput({
  label,
  value,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else onCancel();
  };
  return (
    <input
      className="tree-rename"
      aria-label={label}
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export function LeftPanel() {
  const { t } = useTranslation();
  const project = useViewProject();
  const bodies = bodiesInHistory(project);
  const activeIds = activeFeatureIds(project);
  const selection = useDocumentStore((state) => state.selection);
  const select = useDocumentStore((state) => state.select);
  const toggleBodyVisibility = useDocumentStore((state) => state.toggleBodyVisibility);
  const toggleSketchVisibility = useDocumentStore((state) => state.toggleSketchVisibility);
  const addBox = useDocumentStore((state) => state.addPrimitiveBox);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const preview = useKernelStore((state) => state.preview);
  const kernelReady = useKernelStore((state) => state.status === 'ready');
  const openMenu = useContextMenuStore((state) => state.open);
  const showToast = useUiStore((state) => state.showToast);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const meshInput = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Renaming happens in the tree: double click on an object row, or the context
  // menu. A sketch row is the operation that creates it, so its name is stored
  // on the feature instead of in the object metadata.
  const renameObject = (objectId: string, name: string) => {
    useDocumentStore.getState().apply({ type: 'metadata/patch', objectId, patch: { name } });
  };
  const renameSketch = (feature: SketchFeature, name: string) => {
    useDocumentStore
      .getState()
      .apply({ type: 'feature/replace', feature: { ...feature, name } });
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
    const targets = objectTargets(state.project, state.selection);
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

  const openAddMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 6, [
      {
        id: 'import',
        label: t('tree.import'),
        icon: <FileUp size={14} />,
        onSelect: () => meshInput.current?.click(),
      },
      {
        id: 'box',
        label: t('features.box'),
        icon: <Box size={14} />,
        disabled: !kernelReady,
        onSelect: () => addBox(t('features.box')),
      },
    ]);
  };

  const handleImportMesh = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const format = MESH_FORMATS[extension];
      if (!format) throw new Error('UNSUPPORTED_FORMAT');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const featureId = createId('feat');
      await saveAsset(featureId, new Blob([new Uint8Array(bytes)], { type: MESH_MIME[format] }));
      const name = file.name.replace(/\.[^.]+$/, '') || file.name;
      useDocumentStore.getState().addImportedMesh(name, featureId, format);
      showToast('toast.meshImported');
    } catch {
      showToast('toast.importFailed', 'error');
    }
  };

  const renderBody = (body: BodyObject): ReactNode => {
    const kind = body.kind === 'mesh' ? 'mesh' : 'body';
    const direct = isDirectlySelected(selection, kind, body.id);
    const linked = !direct && highlightedBodyIds.includes(body.id);
    const mark = previewMarks.get(body.id);
    return (
      <div
        key={body.id}
        className={clsx(
          'tree-row',
          direct && 'selected',
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
            onClick={(event) =>
              select(
                { kind, id: body.id },
                { additive: event.metaKey || event.ctrlKey || event.shiftKey },
              )
            }
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
            <span className={clsx('tree-preview-icon', mark.kind)} aria-label={markLabel(mark.kind)}>
              {markIcon(mark.kind)}
            </span>
          </Tooltip>
        )}
        <IconButton
          label={body.visible ? t('tree.hide') : t('tree.show')}
          className="tiny"
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
              <PencilRuler size={14} />
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
        className={clsx(
          'tree-row',
          direct && 'selected',
          linked && 'linked',
          !visible && 'muted',
        )}
        onContextMenu={(event) => {
          ensureSelected('sketch', feature.id);
          showContextMenu(event, [
            {
              id: 'edit',
              label: t('sketch.edit'),
              icon: <PencilRuler size={14} />,
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
              <PencilRuler size={14} />
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
            onClick={(event) =>
              select(
                { kind: 'sketch', id: feature.id },
                { additive: event.metaKey || event.ctrlKey || event.shiftKey },
              )
            }
            onDoubleClick={() => {
              if (canEditSketch(feature, featureErrors)) setActiveSketch(feature.id);
            }}
          >
            <span
              className="tree-icon"
              style={{ color: objectColor(project, objectId, SKETCH_COLOR) }}
            >
              <PencilRuler size={14} />
            </span>
            <span className="tree-name">{feature.name}</span>
          </button>
        )}
        <IconButton
          label={visible ? t('tree.hide') : t('tree.show')}
          className="tiny"
          onClick={() => toggleSketchVisibility(feature.id)}
        >
          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </IconButton>
      </div>
    );
  };

  const bodiesByCreator = new Map<string, BodyObject[]>();
  for (const body of bodies) {
    const list = bodiesByCreator.get(body.createdBy) ?? [];
    list.push(body);
    bodiesByCreator.set(body.createdBy, list);
  }
  const placedBodies = new Set<string>();
  const rows: ReactNode[] = [];

  // The operation being edited is not in the active history, but its preview is
  // on screen, so its sketch object is listed as a phantom row.
  const previewedSketchId = preview?.featureId ?? null;
  for (const feature of project.features) {
    const previewedSketch = feature.id === previewedSketchId && feature.type === 'sketch';
    if (!activeIds.has(feature.id) && !previewedSketch) continue;
    if (feature.type === 'sketch') {
      if (sketchPlaneReady(feature) && !featureErrors[feature.id]) {
        rows.push(renderSketch(feature, previewedSketch && !activeIds.has(feature.id)));
      }
    }
    for (const body of bodiesByCreator.get(feature.id) ?? []) {
      rows.push(renderBody(body));
      placedBodies.add(body.id);
    }
  }
  for (const body of bodies) {
    if (!placedBodies.has(body.id)) rows.push(renderBody(body));
  }
  // Objects the edited operation will add are not document objects yet: they
  // are shown dimmed and cannot be selected.
  for (const mark of previewAdded) {
    if (bodies.some((body) => body.id === mark.id)) continue;
    rows.push(
      <div
        key={`preview-${mark.id}`}
        className="tree-row preview-added"
        aria-label={t('tree.previewAdded')}
      >
        <span className="tree-main">
          <span className="tree-icon" style={{ color: mark.color }}>
            <Box size={14} />
          </span>
          <span className="tree-name">{mark.name}</span>
        </span>
        <span className="tree-preview-icon added" aria-hidden="true">
          <SquarePlus size={13} />
        </span>
      </div>,
    );
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <span>{t('panels.model')}</span>
        <IconButton label={t('tree.addObject')} onClick={openAddMenu}>
          <Plus size={15} />
        </IconButton>
      </header>

      <div className="panel-body">
        {isEmpty ? (
          <p className="empty-row">{t('tree.emptyObjects')}</p>
        ) : (
          <div className="tree-list">{rows}</div>
        )}
      </div>

      <input
        ref={meshInput}
        type="file"
        accept={MESH_ACCEPT}
        className="hidden-input"
        data-testid="import-mesh"
        onChange={(event) => void handleImportMesh(event)}
      />
    </div>
  );
}
