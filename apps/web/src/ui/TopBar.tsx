import { exportStlBinary } from '@icancad/io';
import { bodiesInHistory } from '@icancad/model';
import { Download, FolderOpen, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
  stlFileName,
} from '../persistence/projectFile';
import { loadAsset, saveAsset, setSetting } from '../persistence/db';
import { queueProjectSave } from '../persistence/saveQueue';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { directBodyIds } from '../stores/selection';
import { useContextMenuStore } from './ContextMenu';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { SketchToolRail } from './SketchToolRail';
import { ToolRail } from './ToolRail';

export function TopBar() {
  const { t } = useTranslation();
  const projectName = useDocumentStore((state) => state.project.name);
  const canUndo = useDocumentStore((state) => state.past.length > 0);
  const canRedo = useDocumentStore((state) => state.future.length > 0);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const showToast = useUiStore((state) => state.showToast);
  const fileInput = useRef<HTMLInputElement>(null);
  const meshes = useKernelStore((state) => state.meshes);
  const selection = useDocumentStore((state) => state.selection);
  const project = useDocumentStore((state) => state.project);
  const bodies = bodiesInHistory(project);
  const openMenu = useContextMenuStore((state) => state.open);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const selectedBodyCount = directBodyIds(selection).length;
  const visibleBodies = bodies.filter((body) => body.visible);
  const projectHasGeometry =
    selectedBodyCount > 0 ? true : visibleBodies.some((body) => meshes[body.id] !== undefined);

  const [nameDraft, setNameDraft] = useState(projectName);
  useEffect(() => setNameDraft(projectName), [projectName]);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== projectName) renameProject(next);
    else setNameDraft(projectName);
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleExport = async () => {
    const project = useDocumentStore.getState().project;
    const assets = new Map<string, Uint8Array>();
    for (const feature of project.features) {
      if (feature.type !== 'import-mesh') continue;
      const blob = await loadAsset(feature.assetId);
      if (blob) assets.set(feature.assetId, new Uint8Array(await blob.arrayBuffer()));
    }
    download(serializeProjectFile(project, assets), projectFileName(project.name));
    showToast('toast.exported');
  };

  const handleExportStl = () => {
    const project = useDocumentStore.getState().project;
    const selected = new Set(directBodyIds(useDocumentStore.getState().selection));
    const candidates = bodiesInHistory(project).filter((body) =>
      selected.size > 0 ? selected.has(body.id) : body.visible,
    );
    const collected = candidates
      .map((body) => meshes[body.id])
      .filter((mesh) => mesh !== undefined);
    if (collected.length === 0) {
      showToast('toast.noGeometry', 'error');
      return;
    }
    download(
      new Blob([new Uint8Array(exportStlBinary(collected))], { type: 'model/stl' }),
      stlFileName(project.name),
    );
    showToast('toast.stlExported');
  };

  const openExportMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.right - 200, rect.bottom + 6, [
      {
        id: 'project',
        label: t('topbar.exportProject'),
        onSelect: () => void handleExport(),
      },
      { id: 'separator', separator: true },
      {
        id: 'stl',
        label:
          selectedBodyCount > 0
            ? t('topbar.exportStlSelected', { count: selectedBodyCount })
            : t('topbar.exportStl'),
        onSelect: handleExportStl,
        disabled: !projectHasGeometry,
      },
    ]);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const { project, assets } = parseProjectFile(data);
      for (const [id, bytes] of assets) {
        await saveAsset(id, new Blob([new Uint8Array(bytes)]));
      }
      useDocumentStore.getState().hydrate(project);
      await queueProjectSave(project);
      await setSetting('lastProjectId', project.id);
      showToast('toast.imported');
    } catch {
      showToast('toast.invalidProject', 'error');
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark">IC</span>
          <span className="brand-name">{t('app.name')}</span>
        </div>

        <input
          className="project-name"
          value={nameDraft}
          aria-label={t('topbar.projectName')}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setNameDraft(projectName);
              event.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="topbar-center">{activeSketchId ? <SketchToolRail /> : <ToolRail />}</div>

      <div className="topbar-right">
        <IconButton label={t('topbar.undo')} disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={t('topbar.redo')} disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </IconButton>

        <div className="topbar-separator" />

        <IconButton label={t('topbar.import')} onClick={() => fileInput.current?.click()}>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton label={t('topbar.export')} onClick={openExportMenu}>
          <Download size={16} />
        </IconButton>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".icad,application/zip"
        className="hidden-input"
        onChange={(event) => void handleImport(event)}
      />
    </header>
  );
}
