import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { Button } from './Controls';

export function ConfirmDialog() {
  const { t } = useTranslation();
  const request = useUiStore((state) => state.deleteRequest);
  const cancel = useUiStore((state) => state.cancelDelete);
  const confirm = useDocumentStore((state) => state.confirmRemoveFeature);

  if (!request) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('delete.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('delete.title')}</h2>
        <p className="dialog-text">
          {request.featureIds.length > 1
            ? t('delete.textMultiple', { count: request.featureIds.length })
            : t('delete.text', { name: request.name })}
        </p>
        <ul className="dialog-list">
          {request.dependents.map((dependent) => (
            <li key={dependent.id}>{dependent.name}</li>
          ))}
        </ul>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => confirm(request.featureIds)}>
            {t('delete.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
