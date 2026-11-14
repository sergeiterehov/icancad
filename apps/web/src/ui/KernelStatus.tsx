import { bodiesInHistory, solidBodiesInHistory } from '@icancad/model';
import { Check, TriangleAlert, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cancelKernelWork } from '../kernel/client';
import { useViewProject } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { Button } from './Controls';
import { formatNumber } from './format';
import { Tooltip } from './Tooltip';

const POPOVER_WIDTH = 268;

/**
 * Kernel state of the operations panel: a fixed icon after the divider shows
 * whether everything is calculated, still running or failed.
 */
export function KernelStatus() {
  const { t, i18n } = useTranslation();
  const status = useKernelStore((state) => state.status);
  const ratio = useKernelStore((state) => state.ratio);
  const version = useKernelStore((state) => state.version);
  const loadMs = useKernelStore((state) => state.loadMs);
  const tasks = useKernelStore((state) => state.tasks);
  const project = useViewProject();
  const featureCount = project.features.length;
  const bodyCount = solidBodiesInHistory(project).length;
  const meshCount = bodiesInHistory(project).filter((body) => body.kind === 'mesh').length;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number } | null>(
    null,
  );

  const runningTask = tasks.find((task) => task.status === 'running');
  const runningTaskId = runningTask?.id ?? null;
  const queuedCount = tasks.filter((task) => task.status === 'queued').length;
  const busy = status !== 'ready' || tasks.length > 0;
  const failed = status === 'error';

  // A running rebuild has no timestamp of its own, so the indicator counts from
  // the moment the task appeared.
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    setTaskStartedAt(runningTaskId === null ? null : Date.now());
  }, [runningTaskId]);
  useEffect(() => {
    if (runningTaskId === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [runningTaskId]);

  const locale = (i18n.resolvedLanguage ?? 'en').startsWith('ru') ? 'ru' : 'en';

  const statusLabel =
    status === 'ready'
      ? t('inspector.ready')
      : status === 'loading'
        ? t('inspector.loading')
        : status === 'error'
          ? t('inspector.error')
          : '—';

  const elapsed =
    runningTask && taskStartedAt !== null
      ? t('kernelStatus.elapsed', {
          time: formatNumber(Math.max(0, now - taskStartedAt) / 1000, locale, 1),
        })
      : null;

  const hint = failed
    ? t('kernelStatus.errorHint')
    : status !== 'ready'
      ? `${t('status.kernelLoading')}${ratio !== undefined ? ` ${Math.round(ratio * 100)}%` : ''}`
      : runningTask
        ? `${runningTask.label}${elapsed ? ` · ${elapsed}` : ''}${
            queuedCount > 0 ? ` · ${t('kernelStatus.queued', { count: queuedCount })}` : ''
          }`
        : version && loadMs !== null
          ? t('status.kernelReady', { version, ms: formatNumber(loadMs, locale, 0) })
          : t('kernelStatus.ready');

  useLayoutEffect(() => {
    if (!detailsOpen) {
      setPopoverPosition(null);
      return;
    }
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const left = Math.max(
      8,
      Math.min(anchor.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8),
    );
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
    <div className="timeline-status" data-state={failed ? 'error' : busy ? 'busy' : 'ready'}>
      <Tooltip content={hint} delay={400}>
        <button
          ref={buttonRef}
          type="button"
          className="kernel-indicator"
          data-testid="kernel-state"
          aria-label={t('kernelStatus.details')}
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {failed ? (
            <TriangleAlert size={16} />
          ) : busy ? (
            <span className="spinner tiny-spinner" />
          ) : (
            <Check size={16} />
          )}
        </button>
      </Tooltip>

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
                  <span className="kernel-row-value">{formatNumber(loadMs, locale, 0)} ms</span>
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
                  <div key={task.id} className={`kernel-queue-item ${task.status}`}>
                    <span className="kernel-queue-label">{task.label}</span>
                    <span className="kernel-queue-state">
                      {task.status === 'running' ? t('status.taskRunning') : t('status.taskQueued')}
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
    </div>
  );
}
