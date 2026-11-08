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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div className={clsx('toast', toast.kind === 'error' && 'toast-error')} role="status">
      <span>{translate(t, toast.key)}</span>
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
