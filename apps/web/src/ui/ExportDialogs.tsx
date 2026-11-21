import { useTranslation } from 'react-i18next';
import { EXPORT_QUALITIES } from '../io/exportQuality';
import { useExportStore } from '../stores/exportStore';
import { Button, Segmented, SegmentedTab } from './Controls';

/** Dialogs of the export flow: what to write, then how finely to tessellate. */
export function ExportDialogs() {
  const { t } = useTranslation();
  const scope = useExportStore((state) => state.scope);
  const stl = useExportStore((state) => state.stl);
  const exporting = useExportStore((state) => state.exporting);
  const chooseScope = useExportStore((state) => state.chooseScope);
  const setQuality = useExportStore((state) => state.setQuality);
  const confirmStl = useExportStore((state) => state.confirmStl);
  const cancel = useExportStore((state) => state.cancel);
  const selectedCount = scope?.selectedBodyIds.length ?? 0;

  return (
    <>
      {scope && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => {
            if (!exporting) cancel();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('project.exportScopeTitle')}
            data-testid="export-scope-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="dialog-title">{t('project.exportScopeTitle')}</h2>
            <p className="dialog-text">{t('project.exportScopeText')}</p>
            <div className="dialog-actions">
              <Button variant="ghost" disabled={exporting} onClick={cancel}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="secondary"
                disabled={exporting}
                data-testid="export-scope-model"
                onClick={() => void chooseScope('model')}
              >
                {t('project.exportScopeModel')}
              </Button>
              <Button
                variant="primary"
                disabled={exporting}
                data-testid="export-scope-selected"
                onClick={() => void chooseScope('selected')}
              >
                {t('project.exportScopeSelected', { count: selectedCount })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {stl && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => {
            if (!exporting) cancel();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('project.stlQualityTitle')}
            data-testid="stl-export-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="dialog-title">{t('project.stlQualityTitle')}</h2>
            <p className="dialog-text">{t('project.stlQualityText')}</p>
            <Segmented ariaLabel={t('project.stlQuality')}>
              {EXPORT_QUALITIES.map((quality) => (
                <SegmentedTab
                  key={quality.id}
                  label={t(quality.labelKey as never)}
                  active={stl.quality === quality.id}
                  onClick={() => setQuality(quality.id)}
                />
              ))}
            </Segmented>
            <div className="dialog-actions">
              <Button variant="ghost" disabled={exporting} onClick={cancel}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={exporting}
                data-testid="stl-export-confirm"
                onClick={() => void confirmStl()}
              >
                {t('project.export')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
