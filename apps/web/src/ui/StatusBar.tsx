import { bodiesInHistory, solidBodiesInHistory } from '@icancad/model';
import clsx from 'clsx';
import { Check, Globe, Moon, Sun, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { setLocale, type Locale } from '../i18n';
import { cancelKernelWork } from '../kernel/client';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useThemeStore } from '../stores/themeStore';
import { Button, IconButton } from './Controls';
import { useContextMenuStore } from './ContextMenu';
import { formatNumber } from './format';
import { Tooltip } from './Tooltip';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

const POPOVER_WIDTH = 268;

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const locale: Locale = (i18n.resolvedLanguage ?? 'en').startsWith('ru') ? 'ru' : 'en';
  const status = useKernelStore((state) => state.status);
  const ratio = useKernelStore((state) => state.ratio);
  const version = useKernelStore((state) => state.version);
  const loadMs = useKernelStore((state) => state.loadMs);
  const featureCount = useDocumentStore((state) => state.project.features.length);
  const bodyCount = useDocumentStore((state) => solidBodiesInHistory(state.project).length);
  const meshCount = useDocumentStore(
    (state) => bodiesInHistory(state.project).filter((body) => body.kind === 'mesh').length,
  );
  const saveState = useDocumentStore((state) => state.saveState);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const tasks = useKernelStore((state) => state.tasks);
  const openMenu = useContextMenuStore((state) => state.open);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number } | null>(
    null,
  );

  const runningTask = tasks.find((task) => task.status === 'running');
  const queuedCount = tasks.filter((task) => task.status === 'queued').length;

  const statusLabel =
    status === 'ready'
      ? t('inspector.ready')
      : status === 'loading'
        ? t('inspector.loading')
        : status === 'error'
          ? t('inspector.error')
          : '—';

  const saveLabel =
    saveState === 'saving'
      ? t('topbar.saving')
      : saveState === 'error'
        ? t('topbar.saveError')
        : saveState === 'saved'
          ? t('topbar.saved')
          : '';

  const openLanguageMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(
      rect.left,
      rect.bottom + 6,
      LOCALES.map((item) => ({
        id: item.value,
        label: item.label,
        icon: item.value === locale ? <Check size={14} /> : undefined,
        onSelect: () => void setLocale(item.value),
      })),
    );
  };

  useLayoutEffect(() => {
    if (!detailsOpen) {
      setPopoverPosition(null);
      return;
    }
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const left = Math.max(8, Math.min(anchor.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
    setPopoverPosition({ left, bottom: window.innerHeight - anchor.top + 8 });
  }, [detailsOpen]);

  useEffect(() => {
    if (!detailsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setDetailsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    const handleDismiss = () => setDetailsOpen(false);

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleDismiss);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [detailsOpen]);

  return (
    <footer className="statusbar">
      <span
        className={clsx('save-state', saveState)}
        data-testid="save-state"
        data-state={saveState}
      >
        <span className="save-dot" />
        {saveLabel}
      </span>

      <span className="status-hint" />

      <Tooltip content={t('status.detailsHint')}>
        <button
          ref={buttonRef}
          type="button"
          className="status-button"
          data-testid="kernel-state"
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {runningTask ? (
            <>
              <span className="spinner tiny-spinner" />
              {runningTask.label}
              {queuedCount > 0 ? ` +${queuedCount}` : ''}
            </>
          ) : (
            <>
              {status === 'loading' && (
                <>
                  <span className="spinner tiny-spinner" />
                  {t('status.kernelLoading')}
                  {ratio !== undefined ? ` ${Math.round(ratio * 100)}%` : ''}
                </>
              )}
              {status === 'ready' &&
                loadMs !== null &&
                t('status.ms', { ms: formatNumber(loadMs, locale, 0) })}
              {status === 'error' && <span className="error">{t('status.kernelError')}</span>}
            </>
          )}
        </button>
      </Tooltip>

      <IconButton label={t('topbar.language')} onClick={openLanguageMenu}>
        <Globe size={15} />
      </IconButton>

      <IconButton
        label={theme === 'dark' ? t('topbar.themeLight') : t('topbar.themeDark')}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </IconButton>

      {detailsOpen &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={t('inspector.kernel')}
            className="kernel-popover"
            style={popoverPosition ?? { left: -9999, bottom: 0 }}
          >
            <span className="kernel-popover-title">{t('inspector.kernel')}</span>

            <div className="kernel-rows">
              <div className="kernel-row">
                <span>{t('inspector.status')}</span>
                <span className="kernel-row-value">{statusLabel}</span>
              </div>
              {version && (
                <div className="kernel-row">
                  <span>{t('inspector.version')}</span>
                  <span className="kernel-row-value">{version}</span>
                </div>
              )}
              {loadMs !== null && (
                <div className="kernel-row">
                  <span>{t('inspector.loadTime')}</span>
                  <span className="kernel-row-value">
                    {formatNumber(loadMs, locale, 0)} ms
                  </span>
                </div>
              )}
              <div className="kernel-row">
                <span>{t('inspector.features')}</span>
                <span className="kernel-row-value">{featureCount}</span>
              </div>
              <div className="kernel-row">
                <span>{t('inspector.bodies')}</span>
                <span className="kernel-row-value">{bodyCount}</span>
              </div>
              <div className="kernel-row">
                <span>{t('inspector.meshes')}</span>
                <span className="kernel-row-value">{meshCount}</span>
              </div>
            </div>

            {tasks.length > 0 && (
              <div className="kernel-queue">
                <span className="kernel-queue-title">{t('status.queue')}</span>
                {tasks.map((task) => (
                  <div key={task.id} className={clsx('kernel-queue-item', task.status)}>
                    <span className="kernel-queue-label">{task.label}</span>
                    <span className="kernel-queue-state">
                      {task.status === 'running'
                        ? t('status.taskRunning')
                        : t('status.taskQueued')}
                    </span>
                  </div>
                ))}
                <Button variant="secondary" className="kernel-cancel" onClick={cancelKernelWork}>
                  <X size={14} />
                  {t('status.cancel')}
                </Button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </footer>
  );
}
