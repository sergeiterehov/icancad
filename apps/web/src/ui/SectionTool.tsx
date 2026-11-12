import { createId, type SectionPlane } from '@icancad/model';
import { SquareDashedBottom } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';

export function SectionTool() {
  const { t } = useTranslation();
  const sectionPlanes = useDocumentStore((state) => state.project.view.sectionPlanes);
  const setSectionPlanes = useDocumentStore((state) => state.setSectionPlanes);
  const sectionEnabled = useUiStore((state) => state.sectionEnabled);
  const setSectionEnabled = useUiStore((state) => state.setSectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const active = sectionEnabled && (sectionPlanes.length > 0 || activeSketchId !== null);

  const toggle = () => {
    // While editing a sketch its own plane already provides the section.
    if (sectionPlanes.length === 0 && !activeSketchId) {
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

  return (
    <IconButton label={t('tools.section')} active={active} onClick={toggle}>
      <SquareDashedBottom size={17} />
    </IconButton>
  );
}
