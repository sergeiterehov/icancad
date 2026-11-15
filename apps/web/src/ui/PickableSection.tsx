import { AlertCircle, Check, Pencil, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormError, IconButton, PanelSection } from './Controls';
import { Tooltip } from './Tooltip';

export function ErrorBadge({ message }: { message: string }) {
  return (
    <Tooltip content={message} delay={150} className="error-badge">
      <AlertCircle size={13} aria-label={message} />
    </Tooltip>
  );
}

export interface PickableRow {
  key: string;
  icon: ReactNode;
  name: string;
  meta?: ReactNode;
  error?: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

/**
 * A list that is read-only until its pencil button starts picking. The same
 * shell serves picked faces, picked bodies and picked operations.
 */
export function PickableSection({
  title,
  count,
  picking,
  onTogglePicking,
  pickLabel,
  finishLabel,
  hint,
  emptyHint,
  pickHint,
  removeLabel,
  error,
  rows,
  divided = true,
}: {
  title: string;
  count?: number;
  picking: boolean;
  onTogglePicking: () => void;
  pickLabel: string;
  finishLabel: string;
  hint?: string;
  /** Why the picked set cannot be used yet; shown as the section's error strip. */
  error?: string;
  emptyHint: string;
  pickHint: string;
  removeLabel: string;
  rows: PickableRow[];
  /** A rule above the section; off for a list inside a block that has one. */
  divided?: boolean;
}) {
  const actionLabel = picking ? finishLabel : pickLabel;
  return (
    <PanelSection
      title={title}
      count={count}
      divided={divided}
      // Inside a block the list is part of it, so it adds no inset of its own
      // and lines up with the rows above.
      className={divided ? undefined : 'panel-section-inline'}
      action={
        <IconButton
          label={actionLabel}
          tooltip={actionLabel}
          active={picking}
          onClick={onTogglePicking}
        >
          {picking ? <Check size={14} /> : <Pencil size={14} />}
        </IconButton>
      }
    >
      {error && <FormError message={error} />}
      {hint && <p className="panel-hint">{hint}</p>}
      {rows.length === 0 ? (
        !hint && <p className="panel-hint">{picking ? pickHint : emptyHint}</p>
      ) : (
        <div className="selection-list">
          {rows.map((row) => {
            const content = (
              <>
                <span className="tree-icon">{row.icon}</span>
                <span className="tree-name">{row.name}</span>
                <span className="tree-meta">
                  {row.meta}
                  {row.error && <ErrorBadge message={row.error} />}
                </span>
                {picking && row.onRemove && (
                  <IconButton label={removeLabel} tooltip={removeLabel} onClick={row.onRemove}>
                    <X size={13} />
                  </IconButton>
                )}
              </>
            );
            const className = 'selection-item';
            const active = row.active ? 'true' : undefined;
            const error = row.error ? 'true' : undefined;
            if (picking && row.onClick) {
              return (
                <button
                  key={row.key}
                  type="button"
                  className={className}
                  data-active={active}
                  data-error={error}
                  onClick={row.onClick}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={row.key} className={className} data-active={active} data-error={error}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}
