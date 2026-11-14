import { useTranslation } from 'react-i18next';

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
 * The 3D area of the skeleton, with the action that is being carried out and,
 * when the work can report how far it got, a bar under it.
 */
export function SkeletonStage({
  action,
  testId,
  progress,
}: {
  action: string;
  testId?: string;
  /** 0..1; nothing means the work has no measurable progress. */
  progress?: number;
}) {
  const percent = progress === undefined ? null : Math.round(progress * 100);
  return (
    <div className="skeleton-3d" data-testid={testId} aria-busy="true">
      <span className="skeleton-caption" role="status">
        {action}
      </span>
      {percent !== null && (
        <div
          className="skeleton-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="skeleton-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

/** Placeholder for the whole workspace while the project is being restored. */
export function AppSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="skeleton-body" data-testid="app-skeleton" aria-busy="true">
      <SkeletonStage action={t('status.openingProject')} />
      {/* The logo place: the mark and the name it now spells out beside it. */}
      <span className="skeleton-logo" aria-hidden="true">
        <span className="skeleton-logo-mark" />
        <span className="skeleton-logo-name" />
      </span>
      <SkeletonDock side="left" rows={6} />
      <SkeletonDock side="right" rows={4} />
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
