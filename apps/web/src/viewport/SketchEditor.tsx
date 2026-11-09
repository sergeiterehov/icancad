import { createId, type Project, type SketchEntity, type SketchFeature } from '@icancad/model';
import {
  datumFrame,
  entityControlPointRefs,
  moveEntityControlPoint,
  translateEntity,
  type Point2,
} from '@icancad/sketch';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { solveSketch } from '../sketch/client';
import { autoConstraintsForEntity, isNearAxis, snapHighlightIds } from '../sketch/autoConstraints';
import { diagnoseSketch } from '../sketch/constraintModel';
import type { SketchSnap } from '../sketch/snap';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { getViewport } from './handle';

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function gridPoint(point: Point2): Point2 {
  return [Math.round(point[0] * 2) / 2, Math.round(point[1] * 2) / 2];
}

interface DraftPoint {
  point: Point2;
  snap: SketchSnap | null;
}

interface DragState {
  mode: 'point' | 'entity';
  entityId: string;
  pointIndex: number | null;
  startPoint: Point2;
  startX: number;
  startY: number;
  originalEntity: SketchEntity;
  original: SketchFeature;
  before: Project;
  active: boolean;
  version: number;
}

export function SketchEditor() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const selectionIds = useUiStore((state) => state.sketchSelectionIds);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const selectedConstraintId = useUiStore((state) => state.sketchConstraintId);
  const selectSketchConstraint = useUiStore((state) => state.selectSketchConstraint);
  const setSketchFrozen = useUiStore((state) => state.setSketchFrozen);
  const setSketchAutoHighlight = useUiStore((state) => state.setSketchAutoHighlight);
  const magnetEnabled = useUiStore((state) => state.sketchMagnetEnabled);
  const tool = useUiStore((state) => state.sketchTool);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const preview = useDocumentStore((state) => state.preview);
  const commitPreview = useDocumentStore((state) => state.commitPreview);
  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.id === activeSketchId && feature.type === 'sketch',
  );
  const frame = sketch
    ? sketch.plane.type === 'datum'
      ? datumFrame(sketch.plane.plane, sketch.plane.offset)
      : (sketch.plane.frame ?? datumFrame('XY', 0))
    : null;

  const [draft, setDraft] = useState<DraftPoint[]>([]);
  const [hover, setHover] = useState<Point2 | null>(null);
  const [hoverSnap, setHoverSnap] = useState<SketchSnap | null>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  const highlightKey = useRef('');
  const commitQueue = useRef<Promise<void>>(Promise.resolve());

  const applyAutoHighlight = (ids: string[]) => {
    const key = ids.join('|');
    if (highlightKey.current === key) return;
    highlightKey.current = key;
    setSketchAutoHighlight(ids);
  };

  useEffect(() => {
    setDraft([]);
    setHover(null);
    setHoverSnap(null);
    applyAutoHighlight([]);
  }, [activeSketchId, tool]);

  useEffect(() => {
    if (activeSketchId && !sketch) setActiveSketch(null);
  }, [activeSketchId, sketch, setActiveSketch]);

  useEffect(() => {
    if (!sketch) {
      setSketchFrozen([]);
      return;
    }
    const timer = setTimeout(() => {
      if (!drag.current?.active) void diagnoseSketch(sketch);
    }, 200);
    return () => clearTimeout(timer);
  }, [activeSketchId, sketch?.constraints, sketch?.entities]);

  useEffect(() => {
    if (!activeSketchId || !frame) return;
    const viewport = getViewport();
    const camera = viewport?.getCameraState() ?? null;
    viewport?.alignSketch(frame);
    return () => {
      if (camera) viewport?.setCameraState(camera);
    };
  }, [activeSketchId]);

  useEffect(() => {
    getViewport()?.setSketchOverlay(null, []);
    return () => getViewport()?.setSketchOverlay(null, []);
  }, [activeSketchId]);

  const mergeEntity = (entity: SketchEntity) => {
    const latest = useDocumentStore
      .getState()
      .project.features.find(
        (feature): feature is SketchFeature =>
          feature.id === sketch?.id && feature.type === 'sketch',
      );
    if (!latest) return;
    const entities = latest.entities.some((candidate) => candidate.id === entity.id)
      ? latest.entities.map((candidate) => (candidate.id === entity.id ? entity : candidate))
      : [...latest.entities, entity];
    apply({ type: 'feature/replace', feature: { ...latest, entities } });
  };

  const commitNewEntityNow = async (entity: SketchEntity, snaps: (SketchSnap | null)[]) => {
    if (!sketch) return;
    const latest = useDocumentStore
      .getState()
      .project.features.find(
        (feature): feature is SketchFeature =>
          feature.id === sketch.id && feature.type === 'sketch',
      );
    if (!latest) return;
    const entities = [...latest.entities, entity];
    const auto = magnetEnabled
      ? autoConstraintsForEntity(entity, snaps)
      : { constraints: [], snapConstraints: [], highlightIds: [] };
    if (auto.constraints.length === 0) {
      mergeEntity(entity);
      applyAutoHighlight([]);
      return;
    }

    const attempts =
      auto.snapConstraints.length === auto.constraints.length
        ? [auto.constraints]
        : [auto.constraints, auto.snapConstraints];
    for (const constraints of attempts) {
      if (constraints.length === 0) continue;
      try {
        const result = await solveSketch(entities, [...latest.constraints, ...constraints], [], {
          diagnose: true,
        });
        if (result.conflicting.length > 0 || result.redundant.length > 0) continue;
        const solved = result.entities.find((candidate) => candidate.id === entity.id);
        if (!solved) continue;
        const current = useDocumentStore
          .getState()
          .project.features.find(
            (feature): feature is SketchFeature =>
              feature.id === sketch.id && feature.type === 'sketch',
          );
        if (!current) return;
        const currentEntities = current.entities.some((candidate) => candidate.id === entity.id)
          ? current.entities.map((candidate) => (candidate.id === entity.id ? solved : candidate))
          : [...current.entities, solved];
        const appliedConstraints = constraints.filter(
          (constraint) => !current.constraints.some((candidate) => candidate.id === constraint.id),
        );
        apply({
          type: 'feature/replace',
          feature: {
            ...current,
            entities: currentEntities,
            constraints: [...current.constraints, ...appliedConstraints],
          },
        });
        setSketchFrozen(result.frozenEntityIds);
        applyAutoHighlight(auto.highlightIds);
        return;
      } catch {
        // Try the next fallback below.
      }
    }
    mergeEntity(entity);
    applyAutoHighlight([]);
  };

  const commitNewEntity = (entity: SketchEntity, snaps: (SketchSnap | null)[]) => {
    commitQueue.current = commitQueue.current
      .then(() => commitNewEntityNow(entity, snaps))
      .catch(() => undefined);
  };

  const finishBezier = () => {
    if (draft.length >= 2) {
      const entity: SketchEntity = {
        id: createId('entity'),
        type: 'bezier',
        construction: false,
        points: draft.map(({ point }) => [point[0], point[1]] as [number, number]),
      };
      void commitNewEntity(
        entity,
        draft.map(({ snap }) => snap),
      );
    }
    setDraft([]);
    setHoverSnap(null);
  };

  const addPoint = (point: Point2, snap: SketchSnap | null) => {
    if (tool === 'point') {
      const entity: SketchEntity = {
        id: createId('entity'),
        type: 'point',
        construction: false,
        x: point[0],
        y: point[1],
      };
      void commitNewEntity(entity, [snap]);
      return;
    }
    if (tool === 'bezier') {
      setDraft([...draft, { point, snap }]);
      return;
    }
    if (tool === 'line') {
      if (draft.length === 0) setDraft([{ point, snap }]);
      else {
        const entity: SketchEntity = {
          id: createId('entity'),
          type: 'line',
          construction: false,
          x1: draft[0]!.point[0],
          y1: draft[0]!.point[1],
          x2: point[0],
          y2: point[1],
        };
        void commitNewEntity(entity, [draft[0]!.snap, snap]);
        setDraft([]);
        setHoverSnap(null);
      }
      return;
    }
    if (tool === 'circle') {
      if (draft.length === 0) setDraft([{ point, snap }]);
      else {
        const radius = distance(draft[0]!.point, point);
        if (radius > 0.01) {
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'circle',
            construction: false,
            cx: draft[0]!.point[0],
            cy: draft[0]!.point[1],
            r: radius,
          };
          void commitNewEntity(entity, [draft[0]!.snap, null]);
        }
        setDraft([]);
        setHoverSnap(null);
      }
      return;
    }
    if (tool === 'arc') {
      if (draft.length < 2) setDraft([...draft, { point, snap }]);
      else {
        const [origin, start] = draft;
        const radius = distance(origin!.point, start!.point);
        if (radius > 0.01) {
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'arc',
            construction: false,
            cx: origin!.point[0],
            cy: origin!.point[1],
            r: radius,
            startAngle: Math.atan2(
              start!.point[1] - origin!.point[1],
              start!.point[0] - origin!.point[0],
            ),
            endAngle: Math.atan2(point[1] - origin!.point[1], point[0] - origin!.point[0]),
          };
          void commitNewEntity(entity, [origin!.snap, start!.snap, snap]);
        }
        setDraft([]);
        setHoverSnap(null);
      }
      return;
    }
    if (tool === 'ellipse') {
      if (draft.length === 0) setDraft([{ point, snap }]);
      else {
        const rx = Math.abs(point[0] - draft[0]!.point[0]);
        const ry = Math.abs(point[1] - draft[0]!.point[1]);
        if (rx > 0.01 && ry > 0.01) {
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'ellipse',
            construction: false,
            cx: draft[0]!.point[0],
            cy: draft[0]!.point[1],
            rx,
            ry,
            rotation: 0,
          };
          void commitNewEntity(entity, [draft[0]!.snap, null]);
        }
        setDraft([]);
        setHoverSnap(null);
      }
    }
  };

  useEffect(() => {
    if (!activeSketchId || !sketch) return;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewport-canvas"]');
    if (!canvas) return;
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDown.current = { x: event.clientX, y: event.clientY };
      if (tool !== 'select' || !sketch) return;
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
      if (!pick?.entityId) return;
      const entity = sketch.entities.find((candidate) => candidate.id === pick.entityId);
      if (!entity) return;
      const pointIndex = pick.pointIndex ?? (entity.type === 'point' ? 0 : null);
      const key = pointIndex === null ? entity.id : `${entity.id}#${pointIndex}`;
      if (!additive) setSketchSelection([key]);
      drag.current = {
        mode: pointIndex === null ? 'entity' : 'point',
        entityId: entity.id,
        pointIndex,
        startPoint: pick.point,
        startX: event.clientX,
        startY: event.clientY,
        originalEntity: entity,
        original: sketch,
        before: useDocumentStore.getState().project,
        active: false,
        version: 0,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (tool === 'select') {
        const activeDrag = drag.current;
        if (!activeDrag) return;
        if (!activeDrag.active) {
          if (
            Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY) <= 3
          ) {
            return;
          }
          activeDrag.active = true;
        }
        const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
        if (!pick) return;
        const state = useDocumentStore.getState();
        const current = state.project.features.find(
          (feature): feature is SketchFeature =>
            feature.id === activeDrag.original.id && feature.type === 'sketch',
        );
        if (!current) return;
        const point: Point2 = [pick.point[0], pick.point[1]];
        const currentEntity =
          current.entities.find((entity) => entity.id === activeDrag.entityId) ??
          activeDrag.originalEntity;
        const moved =
          activeDrag.mode === 'point'
            ? moveEntityControlPoint(currentEntity, activeDrag.pointIndex ?? 0, point)
            : translateEntity(
                activeDrag.originalEntity,
                point[0] - activeDrag.startPoint[0],
                point[1] - activeDrag.startPoint[1],
              );
        const entities = current.entities.map((entity) =>
          entity.id === activeDrag.entityId ? moved : entity,
        );
        const pinned =
          activeDrag.mode === 'point'
            ? [{ entityId: activeDrag.entityId, pointIndex: activeDrag.pointIndex ?? 0 }]
            : entityControlPointRefs(activeDrag.originalEntity);
        const next = { ...current, entities };
        preview({ type: 'feature/replace', feature: next });
        const version = ++activeDrag.version;
        void solveSketch(entities, current.constraints, pinned)
          .then((result) => {
            if (drag.current !== activeDrag || activeDrag.version !== version) return;
            const latest = useDocumentStore
              .getState()
              .project.features.find(
                (feature): feature is SketchFeature =>
                  feature.id === activeDrag.original.id && feature.type === 'sketch',
              );
            if (!latest) return;
            preview({ type: 'feature/replace', feature: { ...latest, entities: result.entities } });
          })
          .catch(() => undefined);
        return;
      }
      const snap = getViewport()?.snapSketch(event.clientX, event.clientY);
      if (!snap) {
        setHover(null);
        setHoverSnap(null);
        return;
      }
      const point = magnetEnabled
        ? (snap.pointSnap?.point ?? snap.curveSnap?.point ?? gridPoint(snap.point))
        : gridPoint(snap.point);
      setHover(point);
      setHoverSnap(magnetEnabled ? snap : null);
    };
    const finishDrag = () => {
      const activeDrag = drag.current;
      drag.current = null;
      if (!activeDrag?.active) return;
      const latest = useDocumentStore
        .getState()
        .project.features.find(
          (feature): feature is SketchFeature =>
            feature.id === activeDrag.original.id && feature.type === 'sketch',
        );
      if (!latest) {
        preview({ type: 'feature/replace', feature: activeDrag.original });
        return;
      }
      const pinned =
        activeDrag.mode === 'point'
          ? [{ entityId: activeDrag.entityId, pointIndex: activeDrag.pointIndex ?? 0 }]
          : entityControlPointRefs(activeDrag.originalEntity);
      const version = ++activeDrag.version;
      void solveSketch(latest.entities, latest.constraints, pinned, { diagnose: true })
        .then((result) => {
          if (activeDrag.version !== version) return;
          if (result.conflicting.length > 0 || result.redundant.length > 0) {
            preview({ type: 'feature/replace', feature: activeDrag.original });
            useUiStore.getState().showToast('constraint.conflict', 'error');
            return;
          }
          preview({
            type: 'feature/replace',
            feature: { ...activeDrag.original, entities: result.entities },
          });
          setSketchFrozen(result.frozenEntityIds);
          commitPreview(activeDrag.before);
        })
        .catch(() => {
          preview({ type: 'feature/replace', feature: activeDrag.original });
          useUiStore.getState().showToast('constraint.failed', 'error');
        });
    };
    const onClick = (event: MouseEvent) => {
      const down = pointerDown.current;
      pointerDown.current = null;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      if (tool === 'select') {
        const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
        if (!pick) return;
        const key = pick.entityId
          ? pick.pointIndex !== null
            ? `${pick.entityId}#${pick.pointIndex}`
            : pick.entityId
          : null;
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        if (!key) {
          if (!additive) setSketchSelection([]);
        } else if (!additive) {
          setSketchSelection([key]);
        } else {
          setSketchSelection(
            selectionIds.includes(key)
              ? selectionIds.filter((candidate) => candidate !== key)
              : [...selectionIds, key],
          );
        }
        return;
      }
      const snap = getViewport()?.snapSketch(event.clientX, event.clientY);
      if (!snap) return;
      const point = magnetEnabled
        ? (snap.pointSnap?.point ?? snap.curveSnap?.point ?? gridPoint(snap.point))
        : gridPoint(snap.point);
      addPoint(point, magnetEnabled ? snap : null);
    };
    const onDoubleClick = () => {
      if (tool === 'bezier') finishBezier();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('pointerup', finishDrag);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointerup', finishDrag);
    };
  }, [
    activeSketchId,
    tool,
    draft,
    sketch,
    selectionIds,
    setSketchSelection,
    preview,
    commitPreview,
    magnetEnabled,
  ]);

  const previewEntity = (): SketchEntity | null => {
    if (!hover) return null;
    if (tool === 'line' && draft[0]) {
      const start = draft[0].point;
      return {
        id: 'preview',
        type: 'line',
        construction: false,
        x1: start[0],
        y1: start[1],
        x2: hover[0],
        y2: hover[1],
      };
    }
    if (tool === 'circle' && draft[0]) {
      return {
        id: 'preview',
        type: 'circle',
        construction: false,
        cx: draft[0].point[0],
        cy: draft[0].point[1],
        r: distance(draft[0].point, hover),
      };
    }
    if (tool === 'arc' && draft[0]) {
      const origin = draft[0].point;
      const second = draft[1]?.point ?? hover;
      const radius = distance(origin, second);
      return {
        id: 'preview',
        type: 'arc',
        construction: false,
        cx: origin[0],
        cy: origin[1],
        r: Math.max(radius, 0.01),
        startAngle: Math.atan2(second[1] - origin[1], second[0] - origin[0]),
        endAngle: Math.atan2(hover[1] - origin[1], hover[0] - origin[0]),
      };
    }
    if (tool === 'ellipse' && draft[0]) {
      return {
        id: 'preview',
        type: 'ellipse',
        construction: false,
        cx: draft[0].point[0],
        cy: draft[0].point[1],
        rx: Math.max(Math.abs(hover[0] - draft[0].point[0]), 0.01),
        ry: Math.max(Math.abs(hover[1] - draft[0].point[1]), 0.01),
        rotation: 0,
      };
    }
    if (tool === 'bezier' && draft.length > 0) {
      return {
        id: 'preview',
        type: 'bezier',
        construction: false,
        points: [...draft.map(({ point }) => point), hover].map(
          (point) => [point[0], point[1]] as [number, number],
        ),
      };
    }
    return null;
  };

  const previewAuto =
    magnetEnabled &&
    (draft.some(({ snap }) => Boolean(snap?.pointSnap ?? snap?.curveSnap)) ||
      Boolean(hoverSnap?.pointSnap ?? hoverSnap?.curveSnap) ||
      (tool === 'line' &&
        draft[0] !== undefined &&
        hover !== null &&
        isNearAxis({
          id: 'preview',
          type: 'line',
          construction: false,
          x1: draft[0].point[0],
          y1: draft[0].point[1],
          x2: hover[0],
          y2: hover[1],
        })));

  useEffect(() => {
    if (!activeSketchId) return;
    getViewport()?.setSketchOverlay(
      previewEntity(),
      draft.map(({ point }) => point),
      previewAuto,
    );
  }, [activeSketchId, tool, draft, hover, previewAuto]);

  useEffect(() => {
    if (!magnetEnabled || tool === 'select') {
      applyAutoHighlight([]);
      return;
    }
    applyAutoHighlight(snapHighlightIds(hoverSnap));
  }, [hoverSnap, magnetEnabled, tool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'Escape') {
        setDraft([]);
        setHover(null);
        setSketchSelection([]);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedConstraintId && sketch) {
          const next = {
            ...sketch,
            constraints: sketch.constraints.filter(
              (constraint) => constraint.id !== selectedConstraintId,
            ),
          };
          apply({ type: 'feature/replace', feature: next });
          selectSketchConstraint(null);
          void diagnoseSketch(next);
          return;
        }
        const entityIds = selectionIds.filter((key) => !key.includes('#'));
        if (entityIds.length > 0 && sketch) {
          const next = {
            ...sketch,
            entities: sketch.entities.filter((entity) => !entityIds.includes(entity.id)),
          };
          apply({ type: 'feature/replace', feature: next });
          setSketchSelection([]);
          void diagnoseSketch(next);
        }
      }
      if (event.key === 'Enter' && tool === 'bezier') finishBezier();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!sketch || !activeSketchId) return null;

  const hint =
    tool === 'line'
      ? draft.length === 0
        ? t('sketch.startLine')
        : t('sketch.finishLine')
      : tool === 'circle'
        ? draft.length === 0
          ? t('sketch.centerCircle')
          : t('sketch.radiusCircle')
        : tool === 'arc'
          ? draft.length === 0
            ? t('sketch.centerArc')
            : draft.length === 1
              ? t('sketch.startArc')
              : t('sketch.endArc')
          : tool === 'ellipse'
            ? draft.length === 0
              ? t('sketch.centerEllipse')
              : t('sketch.cornerEllipse')
            : tool === 'bezier'
              ? draft.length > 0
                ? t('sketch.finishBezier')
                : t('sketch.addBezier')
              : '';

  return (
    <div className="sketch-overlay">
      <div className="sketch-hint">
        {hint || (sketch.entities.length === 0 ? t('sketch.empty') : '')}
      </div>
    </div>
  );
}
