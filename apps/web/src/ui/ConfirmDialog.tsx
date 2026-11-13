import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { Button } from './Controls';
import { FeatureIcon } from './featureIcons';

export function ConfirmDialog() {
  const { t } = useTranslation();
  const request = useUiStore((state) => state.deleteRequest);
  const cancel = useUiStore((state) => state.cancelDelete);
  const confirm = useDocumentStore((state) => state.confirmRemoveFeature);
  const removeOnly = useDocumentStore((state) => state.removeFeaturesOnly);
  const features = useDocumentStore((state) => state.project.features);

  if (!request) return null;

  const multiple = request.featureIds.length > 1;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(multiple ? 'delete.titleMultiple' : 'delete.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t(multiple ? 'delete.titleMultiple' : 'delete.title')}</h2>
        <p className="dialog-text">
          {multiple
            ? t('delete.textMultiple', { count: request.featureIds.length })
            : t('delete.text', { name: request.name })}
        </p>
        <ul className="dialog-list">
          {request.dependents.map((dependent) => {
            const feature = features.find((candidate) => candidate.id === dependent.id);
            return (
              <li key={dependent.id}>
                <span className="dialog-list-icon" aria-hidden="true">
                  {feature ? <FeatureIcon feature={feature} size={14} /> : <Layers size={14} />}
                </span>
                {dependent.name}
              </li>
            );
          })}
        </ul>
        <p className="dialog-text dialog-hint">{t('delete.fork')}</p>
        <div className="dialog-actions">
          <Button variant="ghost" className="dialog-cancel" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => removeOnly(request.featureIds)}>
            {t('delete.confirmWithoutLinks')}
          </Button>
          <Button variant="primary" onClick={() => confirm(request.featureIds)}>
            {t('delete.confirmWithLinks')}
          </Button>
        </div>
      </div>
    </div>
  );
}
