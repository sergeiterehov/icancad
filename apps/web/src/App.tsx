import { Group, Panel, Separator } from 'react-resizable-panels';
import { useApplyTheme } from './hooks/useTheme';
import {
  useAutosave,
  useHydrateProject,
  useKernelBoot,
  useRebuildScene,
} from './hooks/usePersistence';
import { useDocumentStore } from './stores/documentStore';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ContextMenuHost } from './ui/ContextMenu';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/LeftPanel';
import { Splash } from './ui/Splash';
import { StatusBar } from './ui/StatusBar';
import { Timeline } from './ui/Timeline';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { Viewport } from './viewport/Viewport';

export default function App() {
  useHydrateProject();
  useKernelBoot();
  useAutosave();
  useRebuildScene();
  useApplyTheme();

  const hydrated = useDocumentStore((state) => state.hydrated);

  if (!hydrated) return <Splash />;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Group orientation="horizontal">
          <Panel id="left" defaultSize="17%" minSize="170px" maxSize="32%" className="pane-fill">
            <LeftPanel />
          </Panel>

          <Separator className="resize-handle" />

          <Panel id="center" defaultSize="57%" minSize="280px" className="pane-fill">
            <Group orientation="vertical">
              <Panel id="viewport" defaultSize="76%" minSize="30%" className="pane-fill">
                <Viewport />
              </Panel>
              <Separator className="resize-handle" />
              <Panel id="timeline" defaultSize="38px" minSize="38px" maxSize="38px" className="pane-fill">
                <Timeline />
              </Panel>
            </Group>
          </Panel>

          <Separator className="resize-handle" />

          <Panel id="right" defaultSize="26%" minSize="250px" maxSize="38%" className="pane-fill">
            <Inspector />
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <ContextMenuHost />
      <Toast />
      <ConfirmDialog />
    </div>
  );
}
