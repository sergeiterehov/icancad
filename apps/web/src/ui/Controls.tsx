import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
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

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="switch"
      data-active={checked ? 'true' : undefined}
      onClick={() => onChange(!checked)}
    />
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
  icon,
  action,
  className,
  children,
}: {
  title: string;
  count?: number;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx('panel-section', className)}>
      <header className="panel-section-header">
        <span className="panel-section-title">
          {icon && <span className="panel-section-icon">{icon}</span>}
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

// An input-like control for picking one object in the viewport. The value is
// optional: an empty picker is only marked invalid when the caller says so.
export function ObjectPickerField({
  label,
  value,
  placeholder,
  icon,
  active,
  invalid,
  onClick,
  testId,
  compact = false,
}: {
  label: string;
  value?: string;
  placeholder: string;
  icon: ReactNode;
  active?: boolean;
  invalid?: boolean;
  onClick: () => void;
  testId?: string;
  /** Sits in a row of controls instead of a labelled form field. */
  compact?: boolean;
}) {
  const button = (
    <button
      type="button"
      className="picker-field"
      aria-label={compact ? label : undefined}
      data-active={active ? 'true' : undefined}
      data-invalid={invalid ? 'true' : undefined}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="picker-field-icon" aria-hidden="true">
        {icon}
      </span>
      <span className={clsx('picker-field-value', !value && 'placeholder')}>
        {value ?? placeholder}
      </span>
    </button>
  );
  if (compact) return button;
  return <Field label={label}>{button}</Field>;
}

export function DimensionField({
  axis,
  icon,
  label,
  value,
  suffix,
  allowNegative,
  warning,
  onCommit,
}: {
  axis?: string;
  icon?: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  /** Positions are signed and may be zero; sizes are positive lengths. */
  allowNegative?: boolean;
  /** Shown as a yellow mark next to the field; the value was reduced. */
  warning?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    const valid = Number.isFinite(parsed) && (allowNegative || parsed > 0);
    if (valid) {
      if (parsed !== value) onCommit(parsed);
      else setDraft(String(value));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <Tooltip content={label}>
      <label className="dimension-field">
        {icon ? (
          <span className="dimension-axis" aria-hidden="true">
            {icon}
          </span>
        ) : (
          <span className="dimension-axis">{axis}</span>
        )}
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
        {warning && (
          <Tooltip content={warning}>
            <span className="dimension-warning" data-testid="dimension-warning">
              <TriangleAlert size={13} aria-hidden="true" />
              <span className="visually-hidden">{warning}</span>
            </span>
          </Tooltip>
        )}
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
