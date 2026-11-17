import { isFormula, type SketchFeature } from '@icancad/model';
import { MousePointer2, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyConstraintValue,
  constraintsGeometryIds,
  ConstraintSolveError,
  diagnoseSketch,
} from '../sketch/constraintModel';
import { computeSketchFrame } from '../sketch/sectionPlane';
import {
  dimensionAnnotations,
  referenceAnnotations,
  type DimensionAnnotation,
  type ReferenceAnnotation,
} from '../sketch/dimensions';
import { useDocumentStore, useViewModel } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';
import { useUiStore } from '../stores/uiStore';
import { CONSTRAINT_CATALOG } from '../ui/constraintCatalog';
import { useContextMenuStore } from '../ui/ContextMenu';
import { paramText, useWheelStep } from '../ui/Controls';
import { formulaMessage } from '../ui/formulaMessage';
import { formatStep, parseNumber, steppedValue, wheelStep } from '../ui/numberStep';
import { Tooltip } from '../ui/Tooltip';
import { getViewport } from './handle';

interface Position {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
}

function samePositions(a: Record<string, Position>, b: Record<string, Position>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const first = a[key];
    const second = b[key];
    return (
      first !== undefined &&
      second !== undefined &&
      Math.abs(first.x - second.x) < 0.5 &&
      Math.abs(first.y - second.y) < 0.5
    );
  });
}

export function SketchAnnotations() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const activeSketchReady = useUiStore((state) => state.activeSketchReady);
  const selectionKeys = useUiStore((state) => state.sketchSelectionIds);
  const selectedConstraintIds = useUiStore((state) => state.sketchConstraintIds);
  const selectConstraint = useUiStore((state) => state.selectSketchConstraint);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const dimensionEditId = useUiStore((state) => state.sketchDimensionEditId);
  const setDimensionEdit = useUiStore((state) => state.setSketchDimensionEdit);
  const openMenu = useContextMenuStore((state) => state.open);
  const showToast = useUiStore((state) => state.showToast);
  const project = useViewModel();
  const apply = useDocumentStore((state) => state.apply);
  const beginWheelGesture = useDocumentStore((state) => state.beginWheelGesture);
  const endApplyGesture = useDocumentStore((state) => state.endApplyGesture);
  const cancelApplyGesture = useDocumentStore((state) => state.cancelApplyGesture);
  const meshes = useKernelStore((state) => state.meshes);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  // Precision the value was opened with or typed at, kept across wheel notches.
  const step = useRef(1);

  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === activeSketchId && candidate.type === 'sketch',
  );
  const resolution = useFormulaStore((state) => state.resolution);
  const formulaRevision = resolution?.revision ?? 0;
  const resolvedFeature = useMemo(
    () => (feature ? resolvedFeatureFor(feature) : undefined),
    [feature, formulaRevision],
  );
  const frame = useMemo(() => {
    const driven = resolvedFeature?.type === 'sketch' ? resolvedFeature : feature;
    return driven
      ? computeSketchFrame(
          driven,
          driven.plane.type === 'face' ? meshes[driven.plane.bodyId ?? ''] : undefined,
        )
      : null;
  }, [feature, resolvedFeature, meshes]);
  const annotations = useMemo(
    () =>
      resolvedFeature?.type === 'sketch'
        ? dimensionAnnotations(resolvedFeature, locale)
        : feature
          ? dimensionAnnotations(feature, locale)
          : [],
    [feature, resolvedFeature, locale],
  );
  const constraintErrors = useMemo(() => {
    if (!feature) return new Map<string, string>();
    const errors = resolution?.errors[feature.id] ?? {};
    const found = new Map<string, string>();
    feature.constraints.forEach((constraint, index) => {
      const message = formulaMessage(t, errors[`constraints.${index}.value`]);
      if (message) found.set(constraint.id, message);
    });
    return found;
  }, [feature, resolution?.errors, t]);
  const references = useMemo(
    () => (feature ? referenceAnnotations(feature, locale, 'mm') : []),
    [feature, locale],
  );
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const referencesRef = useRef(references);
  referencesRef.current = references;

  useEffect(() => {
    if (!frame) {
      setPositions({});
      return;
    }
    let frameId = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const viewport = getViewport();
      if (!viewport) {
        // A throttled tab has no animation frames; a timer still places the
        // labels once the viewport exists.
        retry ??= setTimeout(measure, 100);
        return;
      }
      const next: Record<string, Position> = {};
      for (const annotation of [...annotationsRef.current, ...referencesRef.current]) {
        const base = viewport.projectSketchPoint(frame, annotation.point);
        if (!base) continue;
        next[annotation.id] = {
          baseX: base.x,
          baseY: base.y,
          x: base.x + annotation.offset.x,
          y: base.y + annotation.offset.y,
        };
      }
      setPositions((previous) => (samePositions(previous, next) ? previous : next));
    };
    // Measure once before the first frame, so a label never waits for a paint
    // that a throttled tab would not schedule.
    measure();
    const tick = () => {
      measure();
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
      if (retry) clearTimeout(retry);
    };
  }, [frame, annotations, references]);

  useEffect(() => {
    if (!editingId) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
    input.scrollLeft = 0;
    const frame = requestAnimationFrame(() => {
      input.setSelectionRange(0, input.value.length);
      input.scrollLeft = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  useEffect(() => () => endApplyGesture(), []);

  const solving = useRef(false);
  const applyValue = async (annotation: DimensionAnnotation, value: number) => {
    if (!feature) return;
    solving.current = true;
    try {
      const next = await applyConstraintValue(feature, annotation.id, value);
      apply({ type: 'feature/replace', feature: next });
    } catch (error) {
      showToast(
        error instanceof ConstraintSolveError && error.code === 'conflict'
          ? 'constraint.conflict'
          : 'constraint.failed',
        'error',
      );
    } finally {
      solving.current = false;
    }
  };

  // A driven dimension scrolls the view instead of stepping its value.
  const editingFormula = isFormula(
    annotations.find((candidate) => candidate.id === editingId)?.constraint.value,
  );

  // A wheel step applies right away but keeps the value open for the next notch.
  useWheelStep(
    inputRef,
    (direction) => {
      if (!editingId || solving.current) return;
      const annotation = annotations.find((candidate) => candidate.id === editingId);
      if (!annotation || draft.trim() === '') return;
      // A formula scrolls the view instead of stepping its value.
      if (draft.trimStart().startsWith('=')) return;
      const parsed = parseNumber(draft);
      if (!Number.isFinite(parsed)) return;
      const next = steppedValue(parsed, step.current, direction);
      if (next === parsed) return;
      // The whole scroll is one undo step, like a handle drag.
      beginWheelGesture();
      setDraft(formatStep(next, step.current));
      void applyValue(annotation, next);
    },
    editingId !== null && !editingFormula,
  );

  const selectedEntityIds = new Set(
    selectionKeys.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const selectedConstraints = new Set(selectedConstraintIds);
  const soleConstraintId =
    selectedConstraintIds.length === 1 ? selectedConstraintIds[0] : undefined;

  const isDimmed = (annotation: DimensionAnnotation) => {
    if (selectedConstraintIds.length > 0) return !selectedConstraints.has(annotation.id);
    if (selectedEntityIds.size === 0) return false;
    return ![...selectedEntityIds].some((id) => annotation.entityIds.has(id));
  };

  const beginEdit = (annotation: DimensionAnnotation) => {
    endApplyGesture();
    cancelled.current = false;
    setEditingId(annotation.id);
    // The label is measured from the resolved sketch, but the editor edits the
    // authored dimension: a driven one must open as its formula, not its value.
    const authored = feature?.constraints.find((constraint) => constraint.id === annotation.id);
    const text = paramText(authored?.value ?? annotation.constraint.value ?? 0);
    step.current = wheelStep(text);
    setDraft(text);
    selectConstraint(annotation.id);
  };

  // Grow the value field with its text, capped so a long formula still fits a
  // readable annotation instead of running across the viewport.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.width = '0px';
    const width = Math.min(300, Math.max(62, input.scrollWidth + 10));
    input.style.width = `${width}px`;
  }, [draft, editingId]);

  // The constraint list opens the same editor as a double click on the label.
  useEffect(() => {
    if (!dimensionEditId) return;
    const annotation = annotations.find((candidate) => candidate.id === dimensionEditId);
    // A constraint just created is requested before the next frame places its
    // label; keep the request until the annotation exists instead of dropping it.
    if (!annotation) return;
    setDimensionEdit(null);
    beginEdit(annotation);
  }, [dimensionEditId, annotations, setDimensionEdit]);

  const removeConstraint = (id: string) => {
    if (!feature) return;
    const next = {
      ...feature,
      constraints: feature.constraints.filter((constraint) => constraint.id !== id),
    };
    apply({ type: 'feature/replace', feature: next });
    if (selectedConstraintIds.includes(id)) selectConstraint(null);
    void diagnoseSketch(next);
  };

  const openConstraintMenu = (
    annotation: DimensionAnnotation,
    event: { clientX: number; clientY: number; preventDefault: () => void },
  ) => {
    if (!feature) return;
    event.preventDefault();
    // A right-clicked member of a selection keeps the whole selection, like the
    // constraint list in the panel.
    const targets = selectedConstraints.has(annotation.id)
      ? feature.constraints.filter((candidate) => selectedConstraints.has(candidate.id))
      : [annotation.constraint];
    const geometryIds = constraintsGeometryIds(targets);
    openMenu(event.clientX, event.clientY, [
      {
        id: 'select-geometry',
        label: t('sketch.selectRelatedGeometry'),
        icon: <MousePointer2 size={14} />,
        disabled: geometryIds.length === 0,
        onSelect: () => setSketchSelection(geometryIds),
      },
      { id: 'constraint-separator', separator: true },
      {
        id: 'delete',
        label: t('common.delete'),
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => removeConstraint(annotation.constraint.id),
      },
    ]);
  };

  const commit = async (annotation: DimensionAnnotation, raw: string) => {
    endApplyGesture();
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const text = raw.trim();
    if (text.startsWith('=')) {
      const source = text.slice(1).trim();
      setEditingId(null);
      if (!source || !feature) return;
      const constraints = feature.constraints.map((constraint) =>
        constraint.id === annotation.id
          ? { ...constraint, value: { formula: source } }
          : constraint,
      );
      apply({ type: 'feature/replace', feature: { ...feature, constraints } });
      return;
    }
    const value = parseNumber(raw);
    setEditingId(null);
    // Compare with the authored value: a formula that already computes this
    // number still has to become that number when it is replaced.
    const current = feature?.constraints.find(
      (constraint) => constraint.id === annotation.id,
    )?.value;
    if (!Number.isFinite(value) || (typeof current === 'number' && value === current)) return;
    await applyValue(annotation, value);
  };

  // Every hook runs before this point, so entering or leaving the sketch does
  // not change the number of hooks the component calls.
  if (!feature || !activeSketchReady) return null;

  return (
    <div className="sketch-annotations" data-testid="sketch-annotations">
      <svg className="sketch-annotation-lines">
        {annotations.map((annotation) => {
          const position = positions[annotation.id];
          if (!position) return null;
          return (
            <line
              key={annotation.id}
              x1={position.baseX}
              y1={position.baseY}
              x2={position.x}
              y2={position.y}
              data-dimmed={isDimmed(annotation) ? 'true' : undefined}
            />
          );
        })}
      </svg>
      {annotations.map((annotation) => {
        const position = positions[annotation.id];
        if (!position) return null;
        const editing = editingId === annotation.id;
        const authored = feature.constraints.find((constraint) => constraint.id === annotation.id);
        const Icon = CONSTRAINT_CATALOG[annotation.constraint.type]?.icon;
        const constraintError = constraintErrors.get(annotation.id);
        return (
          <div
            key={annotation.id}
            className="sketch-annotation"
            role="button"
            tabIndex={0}
            aria-label={`${annotation.text}. ${constraintError ?? t('constraint.editValue')}`}
            data-active={selectedConstraints.has(annotation.id) ? 'true' : undefined}
            data-driven={isFormula(authored?.value) ? 'true' : undefined}
            data-dimmed={isDimmed(annotation) ? 'true' : undefined}
            data-error={constraintError ? 'true' : undefined}
            data-testid={`sketch-annotation-${annotation.id}`}
            style={{ left: position.x, top: position.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              selectConstraint(soleConstraintId === annotation.id ? null : annotation.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEdit(annotation);
            }}
            onContextMenu={(event) => {
              if (editing) return;
              event.stopPropagation();
              openConstraintMenu(annotation, event);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              selectConstraint(soleConstraintId === annotation.id ? null : annotation.id);
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="sketch-annotation-input"
                value={draft}
                inputMode="decimal"
                autoFocus
                onChange={(event) => {
                  step.current = wheelStep(event.target.value);
                  setDraft(event.target.value);
                }}
                onFocus={(event) => {
                  // A freshly created dimension opens before its label has a
                  // measured position, so the input mounts later than the
                  // request; autoFocus lands there, and the whole value is
                  // selected so typing replaces it.
                  event.currentTarget.select();
                  event.currentTarget.scrollLeft = 0;
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onBlur={() => void commit(annotation, draft)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    cancelApplyGesture();
                    cancelled.current = true;
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <Tooltip
                content={constraintError ?? t('constraint.editValue')}
                delay={constraintError ? 150 : undefined}
              >
                <span className="sketch-annotation-content">
                  {Icon ? (
                    <span className="sketch-annotation-icon" aria-hidden="true">
                      <Icon size={12} />
                    </span>
                  ) : null}
                  <span>{annotation.text}</span>
                </span>
              </Tooltip>
            )}
          </div>
        );
      })}
      {references.map((reference: ReferenceAnnotation) => {
        const position = positions[reference.id];
        if (!position) return null;
        return (
          <div
            key={reference.id}
            className="sketch-annotation sketch-reference"
            data-testid={`sketch-reference-${reference.id}`}
            style={{ left: position.x, top: position.y }}
          >
            <span>{reference.text}</span>
          </div>
        );
      })}
    </div>
  );
}
