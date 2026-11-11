import { useTranslation } from 'react-i18next';

/** Ghost rows that stand in for a panel whose content is not there yet. */
function SkeletonPane({ rows }: { rows: number }) {
  return (
    <div className="skeleton-pane">
      <span className="skeleton-line head" />
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton-line" />
      ))}
    </div>
  );
}

/** The 3D area of the skeleton, with the action that is being carried out. */
export function SkeletonStage({ action, testId }: { action: string; testId?: string }) {
  return (
    <div className="skeleton-3d" data-testid={testId} aria-busy="true">
      <span className="skeleton-caption" role="status">
        {action}
      </span>
    </div>
  );
}

/** Placeholder for the whole workspace while the project is being restored. */
export function AppSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="skeleton-body" data-testid="app-skeleton" aria-busy="true">
      <SkeletonPane rows={6} />
      <div className="skeleton-center">
        <SkeletonStage action={t('status.openingProject')} />
        <div className="skeleton-timeline">
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
        </div>
      </div>
      <SkeletonPane rows={4} />
    </div>
  );
}
