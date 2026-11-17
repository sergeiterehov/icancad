import { bodiesInHistory, solidBodiesInHistory, type Feature } from '@icancad/model';
import { ThumbsUp, TriangleAlert, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cancelKernelWork } from '../kernel/client';
import { useViewModel } from '../stores/documentStore';
import { useFormulaStore } from '../stores/formulaStore';
import { timelineDuration, useKernelStore } from '../stores/kernelStore';
import {
  SKETCH_SOLVER_NAME,
  SKETCH_SOLVER_VERSION,
  useSketchSolverStore,
} from '../stores/sketchSolverStore';
import { Button } from './Controls';
import { formatNumber } from './format';
import { Tooltip } from './Tooltip';
import { translate } from './translate';

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
  const kernelError = useKernelStore((state) => state.error);
  const tasks = useKernelStore((state) => state.tasks);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const operationMs = useKernelStore((state) => state.operationMs);
  const sketchPending = useSketchSolverStore((state) => state.pending);
  const sketchLastMs = useSketchSolverStore((state) => state.lastMs);
  const formulaStatus = useFormulaStore((state) => state.status);
  const formulaPython = useFormulaStore((state) => state.python);
  const formulaPyodide = useFormulaStore((state) => state.pyodide);
  const project = useViewModel();
  const featureCount = project.features.length;
  const bodyCount = solidBodiesInHistory(project).length;
  const meshCount = bodiesInHistory(project).filter((body) => body.kind === 'mesh').length;
  const timelineMs = timelineDuration(project.features, operationMs);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number } | null>(
    null,
  );

  const runningTask = tasks.find((task) => task.status === 'running');
  const runningTaskId = runningTask?.id ?? null;
  const queuedCount = tasks.filter((task) => task.status === 'queued').length;
  const sketchSolving = sketchPending > 0;
  const busy = status !== 'ready' || tasks.length > 0 || sketchSolving;
  // A failed operation is as bad as a failed kernel: the model the user sees is
  // missing a step, so the indicator says so and the popover names the step.
  const failures: { feature: Feature; code: string }[] = project.features
    .filter((feature) => Boolean(featureErrors[feature.id]))
    .map((feature) => ({ feature, code: featureErrors[feature.id]! }));
  const failed = status === 'error' || failures.length > 0;
  const kernelFailed = status === 'error';

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
      ? failures.length > 0
        ? t('inspector.error')
        : t('inspector.ready')
      : status === 'loading'
        ? t('inspector.loading')
        : status === 'error'
          ? t('inspector.error')
          : '—';
  const pythonStateLabel =
    formulaStatus === 'ready'
      ? t('inspector.ready')
      : formulaStatus === 'loading'
        ? t('inspector.loading')
        : formulaStatus === 'error'
          ? t('inspector.error')
          : t('kernelStatus.idle');

  const elapsed =
    runningTask && taskStartedAt !== null
      ? t('kernelStatus.elapsed', {
          time: formatNumber(Math.max(0, now - taskStartedAt) / 1000, locale, 1),
        })
      : null;

  const hint = kernelFailed
    ? t('kernelStatus.errorHint')
    : failures.length > 0
      ? failures.length === 1
        ? t('kernelStatus.operationError')
        : t('kernelStatus.operationErrors', { count: failures.length })
      : status !== 'ready'
        ? `${t('status.kernelLoading')}${ratio !== undefined ? ` ${Math.round(ratio * 100)}%` : ''}`
        : sketchSolving
          ? t('kernelStatus.sketchSolving')
          : runningTask
            ? `${runningTask.label}${elapsed ? ` · ${elapsed}` : ''}${
                queuedCount > 0 ? ` · ${t('kernelStatus.queued', { count: queuedCount })}` : ''
              }`
            : t('status.kernelReady');

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
            <span className="spinner indicator-spinner" />
          ) : (
            <ThumbsUp size={16} />
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
              <div className="kernel-row">
                <span>{t('kernelStatus.timelineTime')}</span>
                <span className="kernel-row-value" data-testid="timeline-time">
                  {formatNumber(timelineMs, locale, 1)} ms
                </span>
              </div>
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

            <span className="kernel-popover-title">{t('kernelStatus.sketchSolver')}</span>
            <div className="kernel-rows">
              <div className="kernel-row">
                <span>{t('inspector.status')}</span>
                <span className="kernel-row-value" data-testid="sketch-solver-state">
                  {sketchSolving ? t('kernelStatus.solving') : t('kernelStatus.idle')}
                </span>
              </div>
              <div className="kernel-row">
                <span>{t('inspector.version')}</span>
                <span className="kernel-row-value">
                  {SKETCH_SOLVER_NAME} {SKETCH_SOLVER_VERSION}
                </span>
              </div>
              {sketchLastMs !== null && (
                <div className="kernel-row">
                  <span>{t('kernelStatus.lastSolve')}</span>
                  <span className="kernel-row-value">
                    {formatNumber(sketchLastMs, locale, 1)} ms
                  </span>
                </div>
              )}
            </div>

            <span className="kernel-popover-title">{t('kernelStatus.python')}</span>
            <div className="kernel-rows">
              <div className="kernel-row">
                <span>{t('kernelStatus.pythonRuntime')}</span>
                <span className="kernel-row-value" data-testid="python-runtime-state">
                  {pythonStateLabel}
                </span>
              </div>
              {formulaPython && (
                <div className="kernel-row">
                  <span>Python</span>
                  <span className="kernel-row-value">{formulaPython}</span>
                </div>
              )}
              {formulaPyodide && (
                <div className="kernel-row">
                  <span>Pyodide</span>
                  <span className="kernel-row-value">{formulaPyodide}</span>
                </div>
              )}
            </div>

            {(kernelFailed || failures.length > 0) && (
              <div className="kernel-errors" data-testid="kernel-errors">
                <span className="kernel-queue-title">{t('kernelStatus.operationErrorsTitle')}</span>
                {kernelFailed && (
                  <p className="kernel-error-text">
                    {kernelError ?? t('errors.KERNEL_LOAD_FAILED')}
                  </p>
                )}
                {failures.map(({ feature, code }) => (
                  <div key={feature.id} className="kernel-error">
                    <span className="kernel-error-name">{feature.name}</span>
                    <span className="kernel-error-text">
                      {translate(t, `errors.${code}`, code)}
                    </span>
                  </div>
                ))}
              </div>
            )}

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
