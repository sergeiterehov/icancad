import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNarrowLayout } from './hooks/useNarrowLayout';
import { useShortcuts } from './hooks/useShortcuts';
import { useFormulaResolution } from './hooks/useFormulaResolution';
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
import { ModelDeleteDialog } from './ui/ModelDeleteDialog';
import { ProjectDeleteDialog } from './ui/ProjectDeleteDialog';
import { ProjectMenu } from './ui/ProjectMenu';
import { SectionPanel } from './ui/SectionPanel';
import { AppSkeleton } from './ui/Skeleton';
import { SketchToolRail } from './ui/SketchToolRail';
import { Timeline } from './ui/Timeline';
import { Toast } from './ui/Toast';
import { ToolRail } from './ui/ToolRail';
import { useDockClearance } from './ui/useDockClearance';
import { useFloatingBarShift } from './ui/useFloatingBarShift';
import { Viewport } from './viewport/Viewport';
import { installPointerWatch } from './viewport/inputProfile';

export default function App() {
  const { t } = useTranslation();
  useHydrateProject();
  useKernelBoot();
  useAutosave();
  useFormulaResolution();
  useRebuildScene();
  useApplyTheme();
  useShortcuts();

  const hydrated = useDocumentStore((state) => state.hydrated);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  // What is on screen, not what the user asked for: a panel unfolds for its
  // subject too, and the bars and the cube keep clear of it either way.
  const leftDockShown = useUiStore((state) => state.leftDockShown);
  const rightDockShown = useUiStore((state) => state.rightDockShown);
  const compactPanels = useUiStore((state) => state.compactPanels);
  const narrow = useNarrowLayout();
  const pinnedPanels = useUiStore((state) => state.pinnedPanels);
  // The inspector carries the parameters of whatever the timeline selected, so
  // that item is its subject: while there is one, its own unfolded state rules
  // over the panel's, and the panel's own state waits underneath for the moment
  // the subject is gone. A folder is such a subject too — it has a name and a
  // contents list to show. The tree is left to itself: it is a map of the model,
  // not a form, so nothing unfolds it but the user. The sketch editor owns the
  // workspace instead and gives the inspector back its own state.
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  const selectedTimelineItemId = useDocumentStore(
    (state) =>
      state.selection.find((item) => item.kind === 'feature' || item.kind === 'group')?.id ?? null,
  );
  const subjectItem =
    narrow || activeSketchId !== null ? null : (editingFeatureId ?? selectedTimelineItemId);
  // A screen that cannot show both docks side by side starts with them closed,
  // and a rotation into that width puts them away again: the model keeps the
  // screen and the panels return when the hand asks for them.
  useEffect(() => {
    if (!narrow || pinnedPanels) return;
    const ui = useUiStore.getState();
    ui.setLeftDockOpen(false);
    ui.setRightDockOpen(false);
  }, [narrow, pinnedPanels]);
  // A click carries no pointer type of its own, so the press before it is what
  // says whether a finger or a mouse asked for the selection.
  useEffect(() => installPointerWatch(), []);
  // Both floating bars stay centred until a dock reaches them.
  const toolDock = useRef<HTMLDivElement>(null);
  const operationsDock = useRef<HTMLDivElement>(null);
  useFloatingBarShift(toolDock, hydrated);
  useFloatingBarShift(operationsDock, hydrated);
  useDockClearance(hydrated);

  return (
    <div className="app-shell">
      <div
        className="workspace"
        data-left-dock={leftDockShown ? 'open' : 'closed'}
        data-right-dock={rightDockShown ? 'open' : 'closed'}
        data-compact-panels={compactPanels ? 'true' : 'false'}
        data-narrow={narrow ? 'true' : 'false'}
      >
        {hydrated ? (
          <>
            <Viewport />
            <ProjectMenu />

            <FloatDock side="left" label={t('panels.model')} testId="left">
              <LeftPanel />
            </FloatDock>

            <FloatDock
              side="right"
              label={t('panels.inspector')}
              testId="right"
              subject={subjectItem}
            >
              <SectionPanel />
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
      <ModelDeleteDialog />
    </div>
  );
}
