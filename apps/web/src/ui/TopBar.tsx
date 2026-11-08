import { Download, FolderOpen, Redo2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from '../persistence/projectFile';
import { setSetting } from '../persistence/db';
import { queueProjectSave } from '../persistence/saveQueue';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
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

  const [nameDraft, setNameDraft] = useState(projectName);
  useEffect(() => setNameDraft(projectName), [projectName]);

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== projectName) renameProject(next);
    else setNameDraft(projectName);
  };

  const handleExport = () => {
    const project = useDocumentStore.getState().project;
    const blob = serializeProjectFile(project);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = projectFileName(project.name);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('toast.exported');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const { project } = parseProjectFile(data);
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

      <div className="topbar-center">
        <ToolRail />
      </div>

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
        <IconButton label={t('topbar.export')} onClick={handleExport}>
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
