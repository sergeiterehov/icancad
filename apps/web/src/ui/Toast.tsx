import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../stores/uiStore';
import { translate } from './translate';

export function Toast() {
  const toast = useUiStore((state) => state.toast);
  const dismiss = useUiStore((state) => state.dismissToast);
  const { t } = useTranslation();

  // An update waits for the user: the reload is theirs to choose, so the toast
  // stays until it is answered or closed.
  useEffect(() => {
    if (!toast || toast.action) return;
    const timer = setTimeout(dismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div className={clsx('toast', toast.kind === 'error' && 'toast-error')} role="status">
      <span>{translate(t, toast.key)}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            const action = toast.action;
            dismiss();
            action?.onSelect();
          }}
        >
          {translate(t, toast.action.key)}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-close"
        onClick={dismiss}
        aria-label={t('common.close')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
