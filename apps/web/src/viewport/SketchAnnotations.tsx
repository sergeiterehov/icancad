import type { SketchFeature } from '@icancad/model';
import { datumFrame } from '@icancad/sketch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyConstraintValue, ConstraintSolveError } from '../sketch/constraintModel';
import { dimensionAnnotations, type DimensionAnnotation } from '../sketch/dimensions';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
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
  const selectionKeys = useUiStore((state) => state.sketchSelectionIds);
  const selectedConstraintId = useUiStore((state) => state.sketchConstraintId);
  const selectConstraint = useUiStore((state) => state.selectSketchConstraint);
  const showToast = useUiStore((state) => state.showToast);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  const feature = project.features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === activeSketchId && candidate.type === 'sketch',
  );
  const frame = useMemo(() => {
    if (!feature) return null;
    return feature.plane.type === 'datum'
      ? datumFrame(feature.plane.plane, feature.plane.offset)
      : (feature.plane.frame ?? datumFrame('XY', 0));
  }, [feature]);
  const annotations = useMemo(
    () => (feature ? dimensionAnnotations(feature, locale) : []),
    [feature, locale],
  );
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

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
      for (const annotation of annotationsRef.current) {
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

  if (!feature) return null;

  const selectedEntityIds = new Set(
    selectionKeys.map((key) => key.split('#')[0]).filter((id): id is string => Boolean(id)),
  );
  const activeConstraint = feature.constraints.find(
    (constraint) => constraint.id === selectedConstraintId,
  );

  const isDimmed = (annotation: DimensionAnnotation) => {
    if (activeConstraint) return activeConstraint.id !== annotation.id;
    if (selectedEntityIds.size === 0) return false;
    return ![...selectedEntityIds].some((id) => annotation.entityIds.has(id));
  };

  const beginEdit = (annotation: DimensionAnnotation) => {
    cancelled.current = false;
    setEditingId(annotation.id);
    setDraft(String(annotation.constraint.value ?? 0));
    selectConstraint(annotation.id);
  };

  const commit = async (annotation: DimensionAnnotation) => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const value = Number(draft.replace(',', '.'));
    setEditingId(null);
    if (!Number.isFinite(value) || value === annotation.constraint.value) return;
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
    }
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
        return (
          <div
            key={annotation.id}
            className="sketch-annotation"
            role="button"
            tabIndex={0}
            aria-label={`${annotation.text}. ${t('constraint.editValue')}`}
            data-active={activeConstraint?.id === annotation.id ? 'true' : undefined}
            data-dimmed={isDimmed(annotation) ? 'true' : undefined}
            data-testid={`sketch-annotation-${annotation.id}`}
            style={{ left: position.x, top: position.y }}
            title={t('constraint.editValue')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              selectConstraint(activeConstraint?.id === annotation.id ? null : annotation.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              beginEdit(annotation);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              selectConstraint(activeConstraint?.id === annotation.id ? null : annotation.id);
            }}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="sketch-annotation-input"
                value={draft}
                inputMode="decimal"
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) => {
                  event.currentTarget.scrollLeft = 0;
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onBlur={() => void commit(annotation)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    cancelled.current = true;
                    setEditingId(null);
                  }
                }}
              />
            ) : (
              <span>{annotation.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
