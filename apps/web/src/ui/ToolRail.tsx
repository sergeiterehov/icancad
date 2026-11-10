import { LayersArrowUp, PencilRuler, Square } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useContextMenuStore } from './ContextMenu';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { SectionTool } from './SectionTool';

// Extrude works on a whole sketch or on the faces selected inside one sketch.
function extrudeInput(
  selection: ReturnType<typeof useDocumentStore.getState>['selection'],
  project: ReturnType<typeof useDocumentStore.getState>['project'],
): { sketchId: string; regions: string[] } | null {
  if (selection.length === 0) return null;
  if (selection.every((item) => item.kind === 'sketch')) {
    return selection.length === 1 ? { sketchId: selection[0]!.id, regions: [] } : null;
  }
  if (selection.every((item) => item.kind === 'face')) {
    const [sketchId] = selection[0]!.id.split('#');
    if (!sketchId) return null;
    if (selection.some((item) => item.id.split('#')[0] !== sketchId)) return null;
    const regions = selection.map((item) => item.id.split('#')[1] ?? '').filter(Boolean);
    return regions.length > 0 ? { sketchId, regions } : null;
  }
  void project;
  return null;
}

export function ToolRail() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const addSketch = useDocumentStore((state) => state.addSketch);
  const addExtrude = useDocumentStore((state) => state.addExtrude);
  const project = useDocumentStore((state) => state.project);
  const selection = useDocumentStore((state) => state.selection);
  const sketchSelection = extrudeInput(selection, project);
  const openMenu = useContextMenuStore((state) => state.open);

  const openSketchMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(
      rect.left,
      rect.bottom + 6,
      (['XY', 'XZ', 'YZ'] as const).map((plane) => ({
        id: plane,
        label: t(`sketch.plane${plane}`),
        icon: <Square size={14} />,
        onSelect: () => {
          const sketchId = addSketch(t('features.sketch'), plane);
          if (sketchId) setActiveSketch(sketchId);
        },
      })),
    );
  };

  return (
    <nav className="tool-rail" aria-label={t('panels.tools')}>
      <IconButton
        label={t('tools.sketch')}
        active={Boolean(activeSketchId)}
        onClick={openSketchMenu}
      >
        <PencilRuler size={17} />
      </IconButton>
      <IconButton
        label={t('tools.extrude')}
        tooltip={t('tools.extrude')}
        onClick={() => addExtrude(t('features.extrude'), sketchSelection ?? undefined)}
      >
        <LayersArrowUp size={17} />
      </IconButton>

      <div className="tool-separator" />

      <SectionTool />
    </nav>
  );
}
