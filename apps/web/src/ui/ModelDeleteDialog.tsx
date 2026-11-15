import { useTranslation } from 'react-i18next';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { Button } from './Controls';

/** A model with objects asks first: its whole history goes away. */
export function ModelDeleteDialog() {
  const { t } = useTranslation();
  const request = useUiStore((state) => state.modelDeleteRequest);
  const cancel = useUiStore((state) => state.cancelModelDelete);
  const removeModel = useDocumentStore((state) => state.removeModel);

  if (!request) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('model.deleteTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('model.deleteTitle')}</h2>
        <p className="dialog-text">{t('model.deleteText', { name: request.name })}</p>
        <div className="dialog-actions">
          <Button variant="ghost" className="dialog-cancel" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              cancel();
              removeModel(request.id);
            }}
          >
            {t('model.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
