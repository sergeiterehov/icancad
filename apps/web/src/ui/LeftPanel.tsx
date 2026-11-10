import {
  activeFeatureIds,
  bodiesInHistory,
  createId,
  objectName,
  objectVisible,
  sketchObjectId,
  type BodyObject,
  type MeshFormat,
  type SketchFeature,
} from '@icancad/model';
import clsx from 'clsx';
import { Box, Eye, EyeOff, FileUp, PencilRuler, Plus, Trash2 } from 'lucide-react';
import { useRef, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { saveAsset } from '../persistence/db';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { isDirectlySelected, linkedBodyIds } from '../stores/selection';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { showContextMenu, useContextMenuStore } from './ContextMenu';
import { formatNumber } from './format';

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

export function LeftPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const project = useDocumentStore((state) => state.project);
  const bodies = bodiesInHistory(project);
  const activeIds = activeFeatureIds(project);
  const selection = useDocumentStore((state) => state.selection);
  const select = useDocumentStore((state) => state.select);
  const toggleBodyVisibility = useDocumentStore((state) => state.toggleBodyVisibility);
  const toggleSketchVisibility = useDocumentStore((state) => state.toggleSketchVisibility);
  const removeFeature = useDocumentStore((state) => state.removeFeature);
  const deleteBody = useDocumentStore((state) => state.deleteBody);
  const addBox = useDocumentStore((state) => state.addPrimitiveBox);
  const meshes = useKernelStore((state) => state.meshes);
  const kernelReady = useKernelStore((state) => state.status === 'ready');
  const openMenu = useContextMenuStore((state) => state.open);
  const showToast = useUiStore((state) => state.showToast);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const meshInput = useRef<HTMLInputElement>(null);

  const highlightedBodyIds = linkedBodyIds(selection, project);
  const hasSketches = project.features.some(
    (feature) => feature.type === 'sketch' && activeIds.has(feature.id),
  );
  const isEmpty = bodies.length === 0 && !hasSketches;

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
    const mesh = meshes[body.id];
    const direct = isDirectlySelected(selection, 'body', body.id);
    const linked = !direct && highlightedBodyIds.includes(body.id);
    return (
      <div
        key={body.id}
        className={clsx(
          'tree-row',
          direct && 'selected',
          linked && 'linked',
          !body.visible && 'muted',
        )}
        onContextMenu={(event) =>
          showContextMenu(event, [
            {
              id: 'visibility',
              label: body.visible ? t('tree.hide') : t('tree.show'),
              icon: body.visible ? <EyeOff size={14} /> : <Eye size={14} />,
              onSelect: () => toggleBodyVisibility(body.id),
            },
            {
              id: 'delete',
              label: t('context.deleteObject'),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => deleteBody(body.id, t('context.deleteObject')),
            },
          ])
        }
      >
        <button
          type="button"
          className="tree-main"
          onClick={(event) =>
            select(
              { kind: 'body', id: body.id },
              { additive: event.metaKey || event.ctrlKey || event.shiftKey },
            )
          }
        >
          <span className="tree-icon" style={{ color: body.color }}>
            <Box size={14} />
          </span>
          <span className="tree-name">{body.name}</span>
          {mesh && <span className="tree-meta">{formatNumber(mesh.triangleCount, locale, 0)}</span>}
        </button>
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

  const renderSketch = (feature: SketchFeature): ReactNode => {
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
        onContextMenu={(event) =>
          showContextMenu(event, [
            {
              id: 'edit',
              label: t('sketch.edit'),
              icon: <PencilRuler size={14} />,
              onSelect: () => setActiveSketch(feature.id),
            },
            {
              id: 'delete',
              label: t('context.deleteObject'),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => removeFeature(feature.id),
            },
          ])
        }
      >
        <button
          type="button"
          className="tree-main"
          onClick={(event) =>
            select(
              { kind: 'sketch', id: feature.id },
              { additive: event.metaKey || event.ctrlKey || event.shiftKey },
            )
          }
          onDoubleClick={() => setActiveSketch(feature.id)}
        >
          <span className="tree-icon">
            <PencilRuler size={14} />
          </span>
          <span className="tree-name">{objectName(project, objectId, feature.name)}</span>
          <span className="tree-meta">{formatNumber(feature.entities.length, locale, 0)}</span>
        </button>
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

  for (const feature of project.features) {
    if (!activeIds.has(feature.id)) continue;
    if (feature.type === 'sketch') rows.push(renderSketch(feature));
    for (const body of bodiesByCreator.get(feature.id) ?? []) {
      rows.push(renderBody(body));
      placedBodies.add(body.id);
    }
  }
  for (const body of bodies) {
    if (!placedBodies.has(body.id)) rows.push(renderBody(body));
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
