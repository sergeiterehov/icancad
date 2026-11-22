import {
  activeModel,
  bodiesInHistory,
  createId,
  type MeshFormat,
  type Project,
} from '@icancad/model';
import {
  Columns3,
  Download,
  ExternalLink,
  FileArchive,
  FileBox,
  FilePlus2,
  FileUp,
  FolderOpen,
  HardDrive,
  Languages,
  LayoutPanelLeft,
  Moon,
  MonitorSmartphone,
  Package,
  Palette,
  PanelLeft,
  Redo2,
  RefreshCw,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MOD_KEY } from '../hooks/useShortcuts';
import { setLocale, type Locale } from '../i18n';
import { downloadBlob } from '../io/download';
import { inspectStep } from '../kernel/import';
import { loadAsset, saveAsset } from '../persistence/db';
import {
  createAndOpenProject,
  flushCurrentProject,
  listLocalProjects,
  openProjectById,
  switchToProject,
} from '../persistence/projects';
import {
  parseProjectFile,
  projectFileName,
  serializeProjectFile,
} from '../persistence/projectFile';
import { promptInstall } from '../pwa/install';
import { applyUpdate } from '../pwa/updates';
import { directBodyIds } from '../stores/selection';
import { useDocumentStore } from '../stores/documentStore';
import { useExportStore } from '../stores/exportStore';
import { useKernelStore } from '../stores/kernelStore';
import { usePwaStore } from '../stores/pwaStore';
import { useThemeStore } from '../stores/themeStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore, type ContextMenuItem } from './ContextMenu';
import { Tooltip } from './Tooltip';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

const IMPORT_ACCEPT = '.stl,.obj,.ply,.glb,.step,.stp';

const SOURCE_URL = 'https://github.com/sergeiterehov/icancad';

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

/**
 * The logo is the project switcher: it stays in the corner while the model
 * panel is closed, and it carries the autosave indicator.
 */
export function ProjectMenu() {
  const { t, i18n } = useTranslation();
  const saveState = useDocumentStore((state) => state.saveState);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const compactPanels = useUiStore((state) => state.compactPanels);
  const pinnedPanels = useUiStore((state) => state.pinnedPanels);
  const pwaUpdateReady = usePwaStore((state) => state.updateReady);
  const pwaInstalled = usePwaStore((state) => state.installed);
  const openMenu = useContextMenuStore((state) => state.open);
  const updateItems = useContextMenuStore((state) => state.updateItems);
  // Only the logo menu may be rebuilt in place; object and operation menus have
  // their own items.
  const projectMenuOpen = useContextMenuStore((state) => state.menu?.owner === 'project');
  const showToast = useUiStore((state) => state.showToast);
  const requestProjectDelete = useUiStore((state) => state.requestProjectDelete);
  const fileInput = useRef<HTMLInputElement>(null);
  const meshInput = useRef<HTMLInputElement>(null);
  const projectsRef = useRef<Project[]>([]);

  const saveLabel =
    saveState === 'saving'
      ? t('project.saving')
      : saveState === 'error'
        ? t('project.saveError')
        : saveState === 'saved'
          ? t('project.saved')
          : '';

  const handleExport = async () => {
    const project = useDocumentStore.getState().project;
    const assets = new Map<string, Uint8Array>();
    for (const superObject of project.superObjects) {
      for (const feature of superObject.features) {
        if (feature.type !== 'import-mesh' && feature.type !== 'import-step') continue;
        const blob = await loadAsset(feature.assetId);
        if (blob) assets.set(feature.assetId, new Uint8Array(await blob.arrayBuffer()));
      }
    }
    downloadBlob(serializeProjectFile(project, assets), projectFileName(project.name));
    showToast('toast.exported');
  };

  const projectItems = (projects: Project[]): ContextMenuItem[] => {
    if (projects.length === 0) {
      return [
        {
          id: 'no-projects',
          label: t('project.noProjects'),
          disabled: true,
          onSelect: () => undefined,
        },
      ];
    }
    const currentId = useDocumentStore.getState().project.id;
    return projects.map((project) => ({
      id: project.id,
      label: project.name,
      checked: project.id === currentId,
      onSelect: () => {
        void openProjectById(project.id).then((opened) => {
          if (!opened) showToast('toast.invalidProject', 'error');
        });
      },
      action: {
        label: t('project.delete'),
        icon: <Trash2 size={13} />,
        onSelect: () => requestProjectDelete({ id: project.id, name: project.name }),
      },
    }));
  };

  const requestInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === null) showToast('pwa.installHint');
  };

  const menuItems = (projects: Project[]): ContextMenuItem[] => {
    const state = useDocumentStore.getState();
    const currentTheme = useThemeStore.getState().theme;
    const currentLocale: Locale = (i18n.resolvedLanguage ?? 'en').startsWith('ru') ? 'ru' : 'en';
    const selectedBodyCount = directBodyIds(state.selection).length;
    const meshes = useKernelStore.getState().meshes;
    const visibleBodies = bodiesInHistory(
      activeModel(state.project),
      useKernelStore.getState().consumedBodies,
    ).filter((body) => body.visible);
    const projectHasGeometry =
      selectedBodyCount > 0 || visibleBodies.some((body) => meshes[body.id] !== undefined);
    return [
      {
        id: 'new',
        label: t('project.new'),
        icon: <FilePlus2 size={14} />,
        onSelect: () => void createAndOpenProject(t('project.untitled')),
      },
      { id: 'separator-1', separator: true },
      {
        id: 'open',
        label: t('project.open'),
        icon: <FolderOpen size={14} />,
        onSelect: () => fileInput.current?.click(),
      },
      {
        id: 'local',
        label: t('project.local'),
        icon: <HardDrive size={14} />,
        submenu: projectItems(projects),
      },
      { id: 'separator-2', separator: true },
      {
        id: 'import',
        label: t('project.import'),
        icon: <FileUp size={14} />,
        onSelect: () => meshInput.current?.click(),
      },
      {
        id: 'export',
        label: t('project.export'),
        icon: <Download size={14} />,
        submenu: [
          {
            id: 'export-project',
            label: t('project.exportProject'),
            icon: <FileArchive size={14} />,
            onSelect: () => void handleExport(),
          },
          {
            id: 'export-stl',
            label:
              selectedBodyCount > 0
                ? t('project.exportStlSelected', { count: selectedBodyCount })
                : t('project.exportStl'),
            icon: <FileBox size={14} />,
            disabled: !projectHasGeometry,
            onSelect: () => useExportStore.getState().start('stl'),
          },
          {
            id: 'export-step',
            label:
              selectedBodyCount > 0
                ? t('project.exportStepSelected', { count: selectedBodyCount })
                : t('project.exportStep'),
            icon: <Package size={14} />,
            disabled: !projectHasGeometry,
            onSelect: () => useExportStore.getState().start('step'),
          },
        ],
      },
      { id: 'separator-3', separator: true },
      {
        id: 'undo',
        label: t('project.undo'),
        icon: <Undo2 size={14} />,
        hint: `${MOD_KEY}Z`,
        disabled: state.past.length === 0,
        onSelect: () => useDocumentStore.getState().undo(),
      },
      {
        id: 'redo',
        label: t('project.redo'),
        icon: <Redo2 size={14} />,
        hint: `${MOD_KEY}⇧Z`,
        disabled: state.future.length === 0,
        onSelect: () => useDocumentStore.getState().redo(),
      },
      { id: 'separator-4', separator: true },
      {
        id: 'language',
        label: t('project.language'),
        icon: <Languages size={14} />,
        submenu: LOCALES.map((item) => ({
          id: `locale-${item.value}`,
          label: item.label,
          checked: item.value === currentLocale,
          keepOpen: true,
          onSelect: () => void setLocale(item.value),
        })),
      },
      {
        id: 'panels',
        label: t('project.panels'),
        icon: <PanelLeft size={14} />,
        submenu: [
          {
            id: 'pin-panels',
            label: t('project.pinPanels'),
            icon: <Columns3 size={14} />,
            checked: useUiStore.getState().pinnedPanels,
            keepOpen: true,
            onSelect: () =>
              useUiStore.getState().setPinnedPanels(!useUiStore.getState().pinnedPanels),
          },
          {
            id: 'compact-panels',
            label: t('project.compactPanels'),
            icon: <LayoutPanelLeft size={14} />,
            checked: useUiStore.getState().compactPanels,
            keepOpen: true,
            onSelect: () =>
              useUiStore.getState().setCompactPanels(!useUiStore.getState().compactPanels),
          },
        ],
      },
      {
        id: 'theme',
        label: t('project.theme'),
        icon: <Palette size={14} />,
        submenu: [
          {
            id: 'theme-dark',
            label: t('project.themeDark'),
            icon: <Moon size={14} />,
            checked: currentTheme === 'dark',
            keepOpen: true,
            onSelect: () => setTheme('dark'),
          },
          {
            id: 'theme-light',
            label: t('project.themeLight'),
            icon: <Sun size={14} />,
            checked: currentTheme === 'light',
            keepOpen: true,
            onSelect: () => setTheme('light'),
          },
        ],
      },
      { id: 'separator-5', separator: true },
      ...(pwaUpdateReady
        ? [
            {
              id: 'update',
              label: t('pwa.updateAvailable'),
              icon: <RefreshCw size={14} />,
              onSelect: () => void applyUpdate(),
            },
          ]
        : []),
      ...(pwaInstalled
        ? []
        : [
            {
              id: 'install',
              label: t('pwa.install'),
              icon: <MonitorSmartphone size={14} />,
              onSelect: () => void requestInstall(),
            },
          ]),
      {
        id: 'source',
        label: t('project.source'),
        icon: <ExternalLink size={14} />,
        onSelect: () => window.open(SOURCE_URL, '_blank', 'noopener,noreferrer'),
      },
    ];
  };

  const handleImportStep = async (file: File) => {
    const featureId = createId('feat');
    try {
      showToast('toast.stepImporting');
      const data = new Uint8Array(await file.arrayBuffer());
      const inspected = await inspectStep(data, t('project.importStep'));
      if (inspected.bodies.length === 0) {
        showToast('toast.stepNoBodies', 'error');
        return;
      }
      await saveAsset(featureId, new Blob([data], { type: 'application/step' }));
      const name = file.name.replace(/\.[^.]+$/, '') || file.name;
      useDocumentStore.getState().addImportedStep(name, featureId, inspected.bodies);
      showToast('toast.stepImported');
    } catch {
      showToast('toast.stepImportFailed', 'error');
    }
  };

  const handleImportMesh = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (extension === 'step' || extension === 'stp') {
        await handleImportStep(file);
        return;
      }
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

  // Theme, language and the shell switches change while the menu is open; its
  // labels and checks are rebuilt in place so the submenu stays where it is.
  useEffect(() => {
    if (!projectMenuOpen) return;
    updateItems(menuItems(projectsRef.current));
  }, [
    projectMenuOpen,
    theme,
    i18n.resolvedLanguage,
    compactPanels,
    pinnedPanels,
    pwaUpdateReady,
    pwaInstalled,
  ]);

  const openProjectMenu = async (event: MouseEvent<HTMLButtonElement>) => {
    const menu = useContextMenuStore.getState();
    if (menu.menu?.owner === 'project') {
      menu.close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // The list has to show the name that was just typed, not the one from the
    // last autosave.
    await flushCurrentProject().catch(() => undefined);
    let projects: Project[];
    try {
      projects = await listLocalProjects();
    } catch {
      projects = [];
    }
    projectsRef.current = projects;
    openMenu(rect.left, rect.bottom + 8, menuItems(projects), 'project');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const { project, assets } = parseProjectFile(data, {
        modelName: t('model.defaultName'),
      });
      for (const [id, bytes] of assets) {
        await saveAsset(id, new Blob([new Uint8Array(bytes)]));
      }
      await switchToProject(project);
      showToast('toast.imported');
    } catch {
      showToast('toast.invalidProject', 'error');
    }
  };

  return (
    <div className="project-anchor">
      <Tooltip content={saveLabel || t('project.menu')}>
        <button
          type="button"
          className="project-button"
          aria-label={t('project.menu')}
          aria-haspopup="menu"
          data-menu-trigger="project"
          data-testid="save-state"
          data-state={saveState}
          onClick={(event) => void openProjectMenu(event)}
        >
          <span className="brand-badge">
            <span className="brand-mark">IC</span>
            <span className="save-dot" aria-hidden="true" />
          </span>
          {/* The name is spelled out: the mark alone does not say who we are yet. */}
          <span className="brand-name">{t('app.name')}</span>
        </button>
      </Tooltip>
      <span className="project-separator" aria-hidden="true" />
      <ProjectName />

      <input
        ref={fileInput}
        type="file"
        accept=".icad,application/zip"
        className="hidden-input"
        data-testid="import-project"
        onChange={(event) => void handleImport(event)}
      />
      <input
        ref={meshInput}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden-input"
        data-testid="import-mesh"
        onChange={(event) => void handleImportMesh(event)}
      />
    </div>
  );
}

/** The editable project name sits next to the product mark in the corner. */
export function ProjectName() {
  const { t } = useTranslation();
  const projectName = useDocumentStore((state) => state.project.name);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const [draft, setDraft] = useState(projectName);

  useEffect(() => setDraft(projectName), [projectName]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== projectName) renameProject(next);
    else setDraft(projectName);
  };

  return (
    <input
      className="project-name"
      value={draft}
      aria-label={t('project.name')}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(projectName);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
