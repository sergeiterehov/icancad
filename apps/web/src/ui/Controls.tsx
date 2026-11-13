import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Tooltip } from './Tooltip';
import { formatStep, parseNumber, steppedValue, wheelStep } from './numberStep';
import { useDocumentStore } from '../stores/documentStore';

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

/** A wheel notch is a hundred pixels; line-mode deltas are scaled to it. */
const WHEEL_NOTCH_PX = 100;


/**
 * Wheel stepping while the field has the caret. The listener is native because
 * React's wheel handlers are passive and could not keep the panel from
 * scrolling under the pointer. `active` re-attaches it when the input mounts.
 */
export function useWheelStep(
  ref: RefObject<HTMLInputElement | null>,
  onStep: (direction: number) => void,
  active = true,
) {
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  useEffect(() => {
    const input = ref.current;
    if (!input || !active) return;
    let accumulated = 0;
    const onWheel = (event: WheelEvent) => {
      // The panel keeps its own scrolling until the field is actually edited.
      if (document.activeElement !== input) return;
      // Pinch-zoom and browser zoom stay with the browser.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const delta =
        event.deltaMode === 1
          ? event.deltaY * 40
          : event.deltaMode === 2
            ? event.deltaY * WHEEL_NOTCH_PX
            : event.deltaY;
      if (accumulated !== 0 && Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;
      if (Math.abs(accumulated) < WHEEL_NOTCH_PX) return;
      accumulated = 0;
      stepRef.current(-Math.sign(delta));
    };
    input.addEventListener('wheel', onWheel, { passive: false });
    return () => input.removeEventListener('wheel', onWheel);
  }, [ref, active]);
}

function useNumberDraft({
  value,
  onCommit,
  allowNegative = true,
}: {
  value: number;
  onCommit: (value: number) => void;
  allowNegative?: boolean;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const beginWheelGesture = useDocumentStore((state) => state.beginWheelGesture);
  const endApplyGesture = useDocumentStore((state) => state.endApplyGesture);
  const cancelApplyGesture = useDocumentStore((state) => state.cancelApplyGesture);
  const inputRef = useRef<HTMLInputElement>(null);
  // The precision the user started from. It is not read back from the draft on
  // every notch: 12.3 keeps stepping by 0.1 after the value reaches 12.
  const step = useRef(wheelStep(String(value)));
  // The draft came from a wheel step, so it keeps the padding of that step.
  const stepping = useRef(false);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };

  useEffect(() => {
    setDraft(stepping.current ? formatStep(value, step.current) : String(value));
  }, [value]);

  // The whole visit to the field is one edit: it is recorded when the field is
  // left, and dropped when the field disappears with the page.
  useEffect(() => () => endApplyGesture(), []);

  const accepts = (next: number) => Number.isFinite(next) && (allowNegative || next > 0);

  const change = (text: string) => {
    stepping.current = false;
    setDraft(text);
    step.current = wheelStep(text);
  };

  // Typing and focusing decide the precision, so a scroll keeps it.
  const focus = () => {
    // A new visit to a field never extends the gesture of the previous one.
    endApplyGesture();
    const current = latest.current;
    stepping.current = false;
    step.current = wheelStep(current.draft.trim() === '' ? String(current.value) : current.draft);
  };

  const commit = () => {
    endApplyGesture();
    const current = latest.current;
    const parsed = parseNumber(current.draft);
    if (!accepts(parsed)) {
      stepping.current = false;
      setDraft(String(current.value));
      return;
    }
    if (parsed !== current.value) current.onCommit(parsed);
    else {
      stepping.current = false;
      setDraft(String(current.value));
    }
  };

  useWheelStep(inputRef, (direction) => {
    const current = latest.current;
    if (current.draft.trim() === '') return;
    const parsed = parseNumber(current.draft);
    if (!Number.isFinite(parsed)) return;
    const next = steppedValue(parsed, step.current, direction);
    if (!accepts(next) || next === current.value) return;
    // The whole scroll is one undo step; a pause starts a new one.
    beginWheelGesture();
    stepping.current = true;
    setDraft(formatStep(next, step.current));
    current.onCommit(next);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelApplyGesture();
      stepping.current = false;
      setDraft(String(latest.current.value));
      event.currentTarget.blur();
    }
  };

  return { draft, change, focus, inputRef, commit, onKeyDown };
}

/**
 * The one numeric input of the app: themed by the classes of its frame, edited
 * in a draft and changed by one unit of the typed precision per wheel notch.
 */
export function NumberField({
  label,
  value,
  onCommit,
  allowNegative,
  className,
  inputClassName = 'input',
  prefix,
  suffix,
  trailing,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  /** Positions are signed and may be zero; sizes are positive lengths. */
  allowNegative?: boolean;
  /** Frame around the input, e.g. `dimension-field`. */
  className?: string;
  inputClassName?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Mark after the input, e.g. the warning of a reduced value. */
  trailing?: ReactNode;
  testId?: string;
}) {
  const field = useNumberDraft({ value, onCommit, allowNegative });
  return (
    <label className={className}>
      {prefix}
      <input
        ref={field.inputRef}
        className={inputClassName}
        inputMode="decimal"
        aria-label={label}
        value={field.draft}
        data-testid={testId}
        onChange={(event) => field.change(event.target.value)}
        onFocus={field.focus}
        onBlur={field.commit}
        onKeyDown={field.onKeyDown}
      />
      {suffix}
      {trailing}
    </label>
  );
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
  return (
    <Tooltip content={label}>
      <NumberField
        label={label}
        value={value}
        allowNegative={allowNegative}
        onCommit={onCommit}
        className="dimension-field"
        inputClassName="dimension-input"
        prefix={
          icon ? (
            <span className="dimension-axis" aria-hidden="true">
              {icon}
            </span>
          ) : (
            <span className="dimension-axis">{axis}</span>
          )
        }
        suffix={suffix ? <span className="dimension-unit">{suffix}</span> : undefined}
        trailing={
          warning ? (
            <Tooltip content={warning}>
              <span className="dimension-warning" data-testid="dimension-warning">
                <TriangleAlert size={13} aria-hidden="true" />
                <span className="visually-hidden">{warning}</span>
              </span>
            </Tooltip>
          ) : undefined
        }
      />
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
