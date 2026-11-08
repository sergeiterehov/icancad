import { createId, type SectionPlane } from '@icancad/model';
import { ArrowBigUp, CircleDot, Layers, MousePointer2, PenTool, Square } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useContextMenuStore } from './ContextMenu';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';

export function ToolRail() {
  const { t } = useTranslation();
  const planned = t('tools.comingSoon');
  const sectionPlanes = useDocumentStore((state) => state.project.view.sectionPlanes);
  const setSectionPlanes = useDocumentStore((state) => state.setSectionPlanes);
  const sectionEnabled = useUiStore((state) => state.sectionEnabled);
  const setSectionEnabled = useUiStore((state) => state.setSectionEnabled);
  const sectionActive = sectionPlanes.length > 0 && sectionEnabled;
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const addSketch = useDocumentStore((state) => state.addSketch);
  const openMenu = useContextMenuStore((state) => state.open);

  const toggleSection = () => {
    if (sectionPlanes.length === 0) {
      const plane: SectionPlane = {
        id: createId('section'),
        name: t('section.plane', { index: 1 }),
        origin: [0, 0, 0],
        normal: [0, 1, 0],
        offset: 0,
        visible: true,
      };
      setSectionPlanes([plane]);
      setSectionEnabled(true);
      return;
    }
    setSectionEnabled(!sectionEnabled);
  };

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
      <IconButton label={t('tools.select')} active>
        <MousePointer2 size={17} />
      </IconButton>

      <div className="tool-separator" />

      <IconButton label={t('tools.sketch')} active={Boolean(activeSketchId)} onClick={openSketchMenu}>
        <PenTool size={17} />
      </IconButton>
      <IconButton label={t('tools.extrude')} tooltip={planned} disabled>
        <ArrowBigUp size={17} />
      </IconButton>
      <IconButton label={t('tools.shell')} tooltip={planned} disabled>
        <Layers size={17} />
      </IconButton>
      <IconButton label={t('tools.hole')} tooltip={planned} disabled>
        <CircleDot size={17} />
      </IconButton>
      <IconButton label={t('tools.section')} active={sectionActive} onClick={toggleSection}>
        <Layers size={17} />
      </IconButton>
    </nav>
  );
}
