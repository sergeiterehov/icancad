import { ArrowBigUp, CircleDot, Layers, MousePointer2, PenTool, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Controls';

export function ToolRail() {
  const { t } = useTranslation();
  const planned = t('tools.comingSoon');

  return (
    <nav className="tool-rail" aria-label={t('panels.tools')}>
      <IconButton label={t('tools.select')} active>
        <MousePointer2 size={17} />
      </IconButton>

      <div className="tool-separator" />

      <IconButton label={t('tools.sketch')} tooltip={planned} disabled>
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
      <IconButton label={t('tools.section')} tooltip={planned} disabled>
        <Scissors size={17} />
      </IconButton>
    </nav>
  );
}
