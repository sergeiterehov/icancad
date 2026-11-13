import type { SketchFeature } from '@icancad/model';
import { MousePointer2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { CONSTRAINT_CATALOG } from '../ui/constraintCatalog';
import { useContextMenuStore } from '../ui/ContextMenu';
import { useWheelStep } from '../ui/Controls';
import { formatStep, parseNumber, steppedValue, wheelStep } from '../ui/numberStep';
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
  const openMenu = useContextMenuStore((state) => state.open);
  const showToast = useUiStore((state) => state.showToast);
  const project = useDocumentStore((state) => state.project);
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
  const frame = useMemo(
    () =>
      feature
        ? computeSketchFrame(
            feature,
            feature.plane.type === 'face' ? meshes[feature.plane.bodyId ?? ''] : undefined,
          )
        : null,
    [feature, meshes],
  );
  const annotations = useMemo(
    () => (feature ? dimensionAnnotations(feature, locale) : []),
    [feature, locale],
  );
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
    const tick = () => {
      const viewport = getViewport();
      if (!viewport) {
        frameId = requestAnimationFrame(tick);
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
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [frame]);

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

  // A wheel step applies right away but keeps the value open for the next notch.
  useWheelStep(
    inputRef,
    (direction) => {
      if (!editingId || solving.current) return;
      const annotation = annotations.find((candidate) => candidate.id === editingId);
      if (!annotation || draft.trim() === '') return;
      const parsed = parseNumber(draft);
      if (!Number.isFinite(parsed)) return;
      const next = steppedValue(parsed, step.current, direction);
      if (next === parsed) return;
      // The whole scroll is one undo step, like a handle drag.
      beginWheelGesture();
      setDraft(formatStep(next, step.current));
      void applyValue(annotation, next);
    },
    editingId !== null,
  );

  if (!feature || !activeSketchReady) return null;

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
    const text = String(annotation.constraint.value ?? 0);
    step.current = wheelStep(text);
    setDraft(text);
    selectConstraint(annotation.id);
  };

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
    const value = parseNumber(raw);
    setEditingId(null);
    if (!Number.isFinite(value) || value === annotation.constraint.value) return;
    await applyValue(annotation, value);
  };

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
        const Icon = CONSTRAINT_CATALOG[annotation.constraint.type]?.icon;
        return (
          <div
            key={annotation.id}
            className="sketch-annotation"
            role="button"
            tabIndex={0}
            aria-label={`${annotation.text}. ${t('constraint.editValue')}`}
            data-active={selectedConstraints.has(annotation.id) ? 'true' : undefined}
            data-dimmed={isDimmed(annotation) ? 'true' : undefined}
            data-testid={`sketch-annotation-${annotation.id}`}
            style={{ left: position.x, top: position.y }}
            title={t('constraint.editValue')}
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
                onChange={(event) => {
                  step.current = wheelStep(event.target.value);
                  setDraft(event.target.value);
                }}
                onFocus={(event) => {
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
              <>
                {Icon ? (
                  <span className="sketch-annotation-icon" aria-hidden="true">
                    <Icon size={12} />
                  </span>
                ) : null}
                <span>{annotation.text}</span>
              </>
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
