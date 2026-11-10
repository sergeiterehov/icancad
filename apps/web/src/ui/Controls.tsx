import clsx from 'clsx';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export function IconButton({
  label,
  tooltip,
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tooltip?: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip ?? label}>
      <button
        type="button"
        aria-label={label}
        data-active={active ? 'true' : undefined}
        className={clsx('icon-btn', className)}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Segmented({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

// A tab is one option of a segmented switch. Labels never wrap: the row is a
// single line like the sketch plane selector.
export function SegmentedTab({
  label,
  icon,
  active,
  disabled,
  tooltip,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="segmented-tab"
      data-active={active ? 'true' : undefined}
      disabled={disabled}
      aria-pressed={active}
      title={tooltip}
      onClick={onClick}
    >
      {icon ? (
        <span className="segmented-tab-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="segmented-tab-label">{label}</span>
    </button>
  );
}

export function Button({
  variant = 'secondary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  'data-testid'?: string;
}) {
  return (
    <button type="button" className={clsx('btn', `btn-${variant}`, className)} {...props}>
      {children}
    </button>
  );
}

export function PanelSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel-section">
      <header className="panel-section-header">
        <span className="panel-section-title">
          {title}
          {count !== undefined && <span className="panel-count">{count}</span>}
        </span>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <Field label={label}>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

export function DimensionField({
  axis,
  label,
  value,
  suffix,
  onCommit,
}: {
  axis: string;
  label: string;
  value: number;
  suffix?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      if (parsed !== value) onCommit(parsed);
      else setDraft(String(value));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <Tooltip content={label}>
      <label className="dimension-field">
        <span className="dimension-axis">{axis}</span>
        <input
          className="dimension-input"
          inputMode="decimal"
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        {suffix && <span className="dimension-unit">{suffix}</span>}
      </label>
    </Tooltip>
  );
}

export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
