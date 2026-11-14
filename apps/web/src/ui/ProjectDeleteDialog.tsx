import { useTranslation } from 'react-i18next';
import { deleteLocalProject } from '../persistence/projects';
import { useUiStore } from '../stores/uiStore';
import { Button } from './Controls';

export function ProjectDeleteDialog() {
  const { t } = useTranslation();
  const request = useUiStore((state) => state.projectDeleteRequest);
  const cancel = useUiStore((state) => state.cancelProjectDelete);
  const showToast = useUiStore((state) => state.showToast);

  if (!request) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('projectDelete.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('projectDelete.title')}</h2>
        <p className="dialog-text">{t('projectDelete.text', { name: request.name })}</p>
        <div className="dialog-actions">
          <Button variant="ghost" className="dialog-cancel" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              cancel();
              void deleteLocalProject(request.id, t('project.untitled'))
                .then(() => showToast('toast.projectDeleted'))
                .catch(() => showToast('toast.projectDeleteFailed', 'error'));
            }}
          >
            {t('projectDelete.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
