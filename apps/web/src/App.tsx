import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcuts } from './hooks/useShortcuts';
import { useApplyTheme } from './hooks/useTheme';
import {
  useAutosave,
  useHydrateProject,
  useKernelBoot,
  useRebuildScene,
} from './hooks/usePersistence';
import { useDocumentStore } from './stores/documentStore';
import { useUiStore } from './stores/uiStore';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ContextMenuHost } from './ui/ContextMenu';
import { FloatDock } from './ui/FloatDock';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/LeftPanel';
import { ProjectDeleteDialog } from './ui/ProjectDeleteDialog';
import { ProjectMenu, ProjectName } from './ui/ProjectMenu';
import { AppSkeleton } from './ui/Skeleton';
import { SketchToolRail } from './ui/SketchToolRail';
import { Timeline } from './ui/Timeline';
import { Toast } from './ui/Toast';
import { ToolRail } from './ui/ToolRail';
import { useFloatingBarShift } from './ui/useFloatingBarShift';
import { Viewport } from './viewport/Viewport';

export default function App() {
  const { t } = useTranslation();
  useHydrateProject();
  useKernelBoot();
  useAutosave();
  useRebuildScene();
  useApplyTheme();
  useShortcuts();

  const hydrated = useDocumentStore((state) => state.hydrated);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const leftDockOpen = useUiStore((state) => state.leftDockOpen);
  const rightDockOpen = useUiStore((state) => state.rightDockOpen);
  // The inspector carries the parameters of the selected operation, so it stays
  // in place while one is selected or being edited. The sketch editor owns the
  // workspace instead and lets the panel auto-hide again.
  const operationSelected = useDocumentStore(
    (state) =>
      state.editingFeatureId !== null ||
      state.selection.some((item) => item.kind === 'feature'),
  );
  const inspectorPinned = activeSketchId === null && operationSelected;
  // Both floating bars stay centred until a dock reaches them.
  const toolDock = useRef<HTMLDivElement>(null);
  const operationsDock = useRef<HTMLDivElement>(null);
  useFloatingBarShift(toolDock);
  useFloatingBarShift(operationsDock);

  return (
    <div className="app-shell">
      <div
        className="workspace"
        data-left-dock={leftDockOpen ? 'open' : 'closed'}
        data-right-dock={rightDockOpen ? 'open' : 'closed'}
      >
        {hydrated ? (
          <>
            <Viewport />
            <ProjectMenu />

            <FloatDock side="left" label={t('panels.model')} testId="left">
              <div className="project-strip">
                <ProjectName />
              </div>
              <LeftPanel />
            </FloatDock>

            <FloatDock
              side="right"
              label={t('panels.inspector')}
              testId="right"
              pinned={inspectorPinned}
            >
              <Inspector />
            </FloatDock>

            <div className="tool-dock" ref={toolDock}>
              {activeSketchId ? <SketchToolRail /> : <ToolRail />}
            </div>

            <div className="operations-dock" ref={operationsDock}>
              <Timeline />
            </div>
          </>
        ) : (
          <AppSkeleton />
        )}
      </div>

      <ContextMenuHost />
      <Toast />
      <ConfirmDialog />
      <ProjectDeleteDialog />
    </div>
  );
}
