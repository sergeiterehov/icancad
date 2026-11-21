import clsx from 'clsx';
import { isFormula, type ParamValue } from '@icancad/model';
import { TriangleAlert, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from './Tooltip';
import { formatNumber } from './format';
import { useContextMenuStore } from './ContextMenu';
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

export function Segmented({
  ariaLabel,
  compact,
  children,
}: {
  ariaLabel: string;
  /** The row shrinks to its tabs instead of filling the panel. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={clsx('segmented', compact && 'compact')} role="group" aria-label={ariaLabel}>
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
  square,
  tooltip,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** A square tab: one symbol, as wide as it is tall. */
  square?: boolean;
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx('segmented-tab', square && 'square')}
      data-active={active ? 'true' : undefined}
      disabled={disabled}
      aria-pressed={active}
      aria-label={square ? label : undefined}
      title={tooltip ?? (square ? label : undefined)}
      onClick={onClick}
    >
      {icon ? (
        <span className="segmented-tab-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {/* A square tab with an icon is the symbol alone: the label is its name,
          for the screen reader and the tooltip, not a word on the button. */}
      {square && icon ? null : <span className="segmented-tab-label">{label}</span>}
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
  divided,
  className,
  children,
}: {
  title: string;
  count?: number;
  icon?: ReactNode;
  action?: ReactNode;
  divided?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx('panel-section', divided && 'panel-section-divided', className)}>
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

/**
 * The one place an error is shown inside a panel: a strip from edge to edge of
 * its section, red text on a tinted background. Dialogs and pickers use it too,
 * so a failure always reads the same way.
 */
export function FormError({ title, message }: { title?: string; message: string }) {
  return (
    <div className="form-error" role="alert">
      {title && <span className="form-error-title">{title}</span>}
      <span>{message}</span>
    </div>
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
  onClear,
  clearLabel,
  testId,
  compact = false,
}: {
  label: string;
  value?: string;
  placeholder: string;
  icon: ReactNode;
  active?: boolean;
  invalid?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Drops the picked object; the picker then holds nothing again. */
  onClear?: () => void;
  /** Name of the clear action, for its tooltip and its menu entry. */
  clearLabel?: string;
  testId?: string;
  /** Sits in a row of controls instead of a labelled form field. */
  compact?: boolean;
}) {
  const openMenu = useContextMenuStore((state) => state.open);
  const clear = value ? onClear : undefined;
  const button = (
    <button
      type="button"
      className="picker-field"
      aria-label={compact ? label : undefined}
      data-active={active ? 'true' : undefined}
      data-invalid={invalid ? 'true' : undefined}
      data-testid={testId}
      onClick={onClick}
      // A single picker holds one object: Delete and Backspace drop it, and the
      // context menu offers the same thing for a mouse.
      onKeyDown={(event) => {
        if (!clear) return;
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault();
        clear();
      }}
      onContextMenu={(event) => {
        if (!clear || !clearLabel) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY, [
          { id: 'clear', label: clearLabel, icon: <X size={13} />, onSelect: clear },
        ]);
      }}
    >
      <span className="picker-field-icon" aria-hidden="true">
        {icon}
      </span>
      <span className={clsx('picker-field-value', !value && 'placeholder')}>
        {value ?? placeholder}
      </span>
      {clear && clearLabel && (
        <span
          className="picker-field-clear"
          role="button"
          tabIndex={-1}
          aria-label={clearLabel}
          title={clearLabel}
          onClick={(event) => {
            event.stopPropagation();
            clear();
          }}
        >
          <X size={12} />
        </span>
      )}
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
  tooltip,
  value,
  suffix,
  allowNegative,
  warning,
  onCommit,
}: {
  axis?: string;
  icon?: ReactNode;
  label: string;
  /** Longer explanation shown on hover; the label itself stays short. */
  tooltip?: ReactNode;
  value: number;
  suffix?: string;
  /** Positions are signed and may be zero; sizes are positive lengths. */
  allowNegative?: boolean;
  /** Shown as a yellow mark next to the field; the value was reduced. */
  warning?: string;
  onCommit: (value: number) => void;
}) {
  return (
    <Tooltip content={tooltip ?? label}>
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

const FORMULA_PREFIX = '=';

/** A draft is a formula when its leading non-space character is `=`. */
function isFormulaDraft(draft: string): boolean {
  return draft.trimStart().startsWith(FORMULA_PREFIX);
}

function formulaSource(draft: string): string {
  return draft.trimStart().slice(FORMULA_PREFIX.length).trim();
}

/** The text a field shows for an authored parameter. */
export function paramText(value: ParamValue): string {
  return isFormula(value) ? `${FORMULA_PREFIX}${value.formula}` : String(value);
}

/**
 * A numeric input that also takes a Python expression: `=` as the first
 * character switches the field to a formula. The field then shows the number it
 * computes and reveals the expression while focused.
 */
export function ParamField({
  axis,
  icon,
  label,
  tooltip,
  value,
  resolved,
  suffix,
  allowNegative,
  warning,
  error,
  onCommit,
}: {
  axis?: string;
  icon?: ReactNode;
  label: string;
  /** Longer explanation shown on hover; the label itself stays short. */
  tooltip?: ReactNode;
  /** The authored parameter: a literal or a formula. */
  value: ParamValue;
  /** The formula result; undefined until the engine has one. */
  resolved?: number;
  suffix?: string;
  /** Positions are signed and may be zero; sizes are positive lengths. */
  allowNegative?: boolean;
  /** Shown as a yellow mark next to the field; the value was reduced. */
  warning?: string;
  /** Formula diagnostic shown in red; the field stays editable. */
  error?: string;
  onCommit: (value: ParamValue) => void;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const formula = isFormula(value);
  const computed = resolved !== undefined && Number.isFinite(resolved) ? resolved : undefined;
  const text = paramText(value);
  // A driven field shows what it computes, in the accent colour; its formula
  // appears only while the field is being edited.
  const display = error
    ? '—'
    : formula
      ? computed === undefined
        ? '—'
        : formatNumber(computed, locale, 2)
      : text;
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const step = useRef(wheelStep(text));
  // The draft came from a wheel step, so it keeps the padding of that step and
  // follows the value the parent accepted.
  const stepping = useRef(false);
  const beginWheelGesture = useDocumentStore((state) => state.beginWheelGesture);
  const endApplyGesture = useDocumentStore((state) => state.endApplyGesture);
  const cancelApplyGesture = useDocumentStore((state) => state.cancelApplyGesture);
  const latest = useRef({ draft, value, resolved, onCommit });
  latest.current = { draft, value, resolved, onCommit };

  // An unchanged authored value replaces the draft; a focused field keeps what
  // is being typed. The text, not the object, is the identity: a parent may
  // build `{ formula }` inline on every render.
  useEffect(() => {
    if (!focused) {
      setDraft(display);
      return;
    }
    // A wheel step changes the resolved value, not the authored text. Keep the
    // field showing the number it landed on while the scroll continues.
    if (stepping.current) {
      const shown = typeof value === 'number' ? value : computed;
      if (shown !== undefined) setDraft(formatStep(shown, step.current));
    }
  }, [display, focused, value, computed]);

  // The whole visit to the field is one edit, like the plain numeric field.
  useEffect(() => () => endApplyGesture(), [endApplyGesture]);

  const accepts = (next: number) => Number.isFinite(next) && (allowNegative || next > 0);

  const commit = () => {
    endApplyGesture();
    const current = latest.current;
    const text = current.draft.trim();
    stepping.current = false;
    if (isFormulaDraft(text)) {
      const source = formulaSource(text);
      // An empty expression is not a formula: the saved value comes back.
      if (!source) {
        setDraft(paramText(current.value));
        return;
      }
      if (!isFormula(current.value) || current.value.formula !== source) {
        current.onCommit({ formula: source });
      }
      setDraft(`${FORMULA_PREFIX}${source}`);
      return;
    }
    const parsed = parseNumber(text);
    if (!accepts(parsed)) {
      setDraft(paramText(current.value));
      return;
    }
    if (typeof current.value !== 'number' || parsed !== current.value) current.onCommit(parsed);
    setDraft(String(parsed));
  };

  // A formula scrolls the panel instead of stepping its value.
  useWheelStep(
    inputRef,
    (direction) => {
      const current = latest.current;
      if (isFormulaDraft(current.draft)) return;
      const parsed = parseNumber(current.draft);
      if (!Number.isFinite(parsed)) return;
      const next = steppedValue(parsed, step.current, direction);
      if (!accepts(next)) return;
      if (typeof current.value === 'number' && next === current.value) return;
      // The draft has to move with the value: the next notch is measured from
      // the text in the field, and the user has to see where the scroll landed.
      beginWheelGesture();
      stepping.current = true;
      setDraft(formatStep(next, step.current));
      current.onCommit(next);
    },
    !formula,
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelApplyGesture();
      stepping.current = false;
      setDraft(paramText(latest.current.value));
      event.currentTarget.blur();
    }
  };

  return (
    <Tooltip content={error ?? tooltip ?? label}>
      <label
        className={clsx('dimension-field', formula && 'is-formula', error && 'has-error')}
        data-testid={error ? 'param-error' : undefined}
      >
        {icon ? (
          <span className="dimension-axis" aria-hidden="true">
            {icon}
          </span>
        ) : (
          axis && <span className="dimension-axis">{axis}</span>
        )}
        <input
          ref={inputRef}
          className="dimension-input"
          // Formulas are available in every parameter, so the on-screen keyboard
          // must offer letters and "="; a decimal pad cannot type an expression.
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(event) => {
            stepping.current = false;
            step.current = wheelStep(event.target.value);
            setDraft(event.target.value);
          }}
          onFocus={(event) => {
            // A new visit never extends the gesture of the previous one.
            endApplyGesture();
            setFocused(true);
            stepping.current = false;
            setDraft(text);
            step.current = wheelStep(text);
            // Focus reveals the authored value: a number or the formula.
            const input = event.currentTarget;
            requestAnimationFrame(() => input.setSelectionRange(0, text.length));
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={onKeyDown}
        />
        {suffix && <span className="dimension-unit">{suffix}</span>}
        {warning && (
          <span className="dimension-warning" data-testid="dimension-warning">
            <TriangleAlert size={13} aria-hidden="true" />
            <span className="visually-hidden">{warning}</span>
          </span>
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
