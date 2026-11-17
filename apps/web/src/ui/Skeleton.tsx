import { useNarrowLayout } from '../hooks/useNarrowLayout';
import { useStartupProgress } from '../hooks/useStartupProgress';

/** Ghost rows that stand in for a panel whose content is not there yet. */
function SkeletonDock({ side, rows }: { side: 'left' | 'right'; rows: number }) {
  return (
    <div className={`skeleton-dock skeleton-dock-${side}`}>
      <span className="skeleton-line head" />
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton-line" />
      ))}
    </div>
  );
}

/**
 * The 3D area of the skeleton with one overall bar and the action it is doing
 * under it. A stage without a ratio runs inside the unfinished part of the bar.
 */
export function SkeletonStage({
  action,
  testId,
  progress,
  busy = false,
}: {
  action: string;
  testId?: string;
  /** 0..1; nothing means the work has no measurable progress. */
  progress?: number;
  /** Keep the bar running inside the part that is not complete yet. */
  busy?: boolean;
}) {
  const percent = progress === undefined ? null : Math.round(progress * 100);
  const running = percent === null || busy;
  return (
    <div className="skeleton-3d" data-testid={testId} aria-busy="true">
      <div
        className="skeleton-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={running ? undefined : (percent ?? undefined)}
        data-indeterminate={running ? 'true' : undefined}
      >
        <span className="skeleton-progress-fill" style={{ width: `${percent ?? 0}%` }} />
        {running && (
          <span className="skeleton-progress-runner" style={{ left: `${percent ?? 0}%` }} />
        )}
      </div>
      <span className="skeleton-caption" role="status">
        {action}
      </span>
    </div>
  );
}

/** Placeholder for the whole workspace while the project is being restored. */
export function AppSkeleton() {
  const startup = useStartupProgress();
  const narrow = useNarrowLayout();
  return (
    <div className="skeleton-body" data-testid="app-skeleton" aria-busy="true">
      <SkeletonStage action={startup.message} progress={startup.progress} busy={startup.busy} />
      {/* The logo place: the mark and the name it now spells out beside it. */}
      <span className="skeleton-logo" aria-hidden="true">
        <span className="skeleton-logo-mark" />
        <span className="skeleton-logo-name" />
      </span>
      {/* A narrow screen starts with the panels closed, so its skeleton keeps
          their space for the model instead of promising panels it will hide. */}
      {!narrow && <SkeletonDock side="left" rows={6} />}
      {!narrow && <SkeletonDock side="right" rows={4} />}
      <div className="skeleton-tool-pill" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className="skeleton-icon" />
        ))}
      </div>
      <div className="skeleton-operations" aria-hidden="true">
        <span className="skeleton-pill" />
        <span className="skeleton-pill" />
        <span className="skeleton-pill" />
      </div>
    </div>
  );
}
