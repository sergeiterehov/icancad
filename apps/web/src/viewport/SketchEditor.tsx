import {
  createId,
  type Project,
  type SketchConstraint,
  type SketchConstraintRef,
  type SketchEntity,
  type SketchFeature,
  type SketchFrame,
} from '@icancad/model';
import {
  entityControlPointRefs,
  entityControlPoints,
  isFundamentalEntityId,
  moveEntityControlPoint,
  sketchEntityIndex,
  translateEntity,
  withFundamentalEntities,
  type Point2,
} from '@icancad/sketch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { solveSketch } from '../sketch/client';
import { rebuildScene } from '../kernel/rebuild';
import { autoConstraintsForEntity, isNearAxis, snapHighlightIds } from '../sketch/autoConstraints';
import { buildConstraintActions, diagnoseSketch, removeSketchEntities } from '../sketch/constraintModel';
import { sketchToolFromShortcut } from '../sketch/tool';
import { useApplyConstraintAction } from '../sketch/useConstraintActions';
import { constraintFromShortcut } from '../ui/constraintCatalog';
import { canEditSketch, computeSketchFrame, sketchFrameOf } from '../sketch/sectionPlane';
import { solveDrag } from '../sketch/dragSolve';
import { liveMeasures, measureInfo } from '../sketch/measure';
import { sketchPickKey } from '../sketch/pickKey';
import { referenceMenuItems } from '../sketch/referenceMenu';
import type { SketchSnap, SketchSnapInput, SketchSnapMode } from '../sketch/snap';
import type { SketchTool } from '../sketch/tool';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from '../ui/ContextMenu';
import { getViewport, type ViewportCamera } from './handle';

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function gridPoint(point: Point2): Point2 {
  return [Math.round(point[0] * 2) / 2, Math.round(point[1] * 2) / 2];
}

interface DraftPoint {
  point: Point2;
  input: SketchSnapInput;
}

function snapModeFor(tool: string, draftLength: number): SketchSnapMode {
  if (tool === 'circle') return draftLength === 0 ? 'free' : 'curve-only';
  if (tool === 'arc') return draftLength === 0 ? 'free' : draftLength === 1 ? 'curve-only' : 'free';
  if (tool === 'ellipse') return draftLength === 0 ? 'free' : 'none';
  return 'free';
}

function snapTargetPoint(snap: SketchSnap | null, mode: SketchSnapMode): Point2 | null {
  if (!snap || mode === 'none') return null;
  if (mode === 'curve-only') return snap.curveSnap?.point ?? null;
  return snap.pointSnap?.point ?? snap.midpointSnap?.point ?? snap.curveSnap?.point ?? null;
}

/**
 * Entities offered to picking and snapping: the stored geometry plus the
 * fundamental origin and axes, which every sketch has a priori.
 */
function currentSketchEntities(sketchId: string | null): readonly SketchEntity[] {
  if (!sketchId) return [];
  const feature = useDocumentStore
    .getState()
    .project.features.find(
      (candidate): candidate is SketchFeature =>
        candidate.id === sketchId && candidate.type === 'sketch',
    );
  return withFundamentalEntities(feature?.entities ?? []);
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

function dragPinSets(drag: DragState): SketchConstraintRef[][] {
  if (drag.mode === 'point') {
    return [[{ entityId: drag.entityId, pointIndex: drag.pointIndex ?? 0 }]];
  }
  const refs = entityControlPointRefs(drag.originalEntity);
  if (refs.length <= 1) return [refs];
  let nearest = refs[0]!;
  let best = Number.POSITIVE_INFINITY;
  for (const ref of refs) {
    const point = refPointOnEntity(drag.originalEntity, ref.pointIndex ?? 0);
    if (!point) continue;
    const distanceToGrab = Math.hypot(point[0] - drag.startPoint[0], point[1] - drag.startPoint[1]);
    if (distanceToGrab < best) {
      best = distanceToGrab;
      nearest = ref;
    }
  }
  return [refs, [nearest], []];
}

function refPointOnEntity(entity: SketchEntity, index: number): Point2 | null {
  return entityControlPoints(entity)[index] ?? null;
}

const frameKeyOf = (value: SketchFrame) =>
  [...value.origin, ...value.xAxis, ...value.yAxis].join(',');

export function SketchEditor() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const openContextMenu = useContextMenuStore((state) => state.open);
  const closeContextMenu = useContextMenuStore((state) => state.close);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const setSketchTool = useUiStore((state) => state.setSketchTool);
  const sketchToolNonce = useUiStore((state) => state.sketchToolNonce);
  const selectionIds = useUiStore((state) => state.sketchSelectionIds);
  const setSketchSelection = useUiStore((state) => state.setSketchSelection);
  const selectedConstraintIds = useUiStore((state) => state.sketchConstraintIds);
  const selectSketchConstraint = useUiStore((state) => state.selectSketchConstraint);
  const selectSketchConstraints = useUiStore((state) => state.selectSketchConstraints);
  const setSketchFrozen = useUiStore((state) => state.setSketchFrozen);
  const setSketchAutoHighlight = useUiStore((state) => state.setSketchAutoHighlight);
  const setSketchHover = useUiStore((state) => state.setSketchHover);
  const sketchHoverIds = useUiStore((state) => state.sketchHoverIds);
  const setSketchProblems = useUiStore((state) => state.setSketchProblems);
  const magnetEnabled = useUiStore((state) => state.sketchMagnetEnabled);
  const tool = useUiStore((state) => state.sketchTool);
  const activeSketchReady = useUiStore((state) => state.activeSketchReady);
  const setActiveSketchReady = useUiStore((state) => state.setActiveSketchReady);
  const project = useDocumentStore((state) => state.project);
  const apply = useDocumentStore((state) => state.apply);
  const preview = useDocumentStore((state) => state.preview);
  const commitPreview = useDocumentStore((state) => state.commitPreview);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const sketchFrames = useKernelStore((state) => state.sketchFrames);
  const meshes = useKernelStore((state) => state.meshes);
  const sketch = project.features.find(
    (feature): feature is SketchFeature =>
      feature.id === activeSketchId && feature.type === 'sketch',
  );
  const frame = useMemo(
    () =>
      sketch
        ? activeSketchReady
          ? computeSketchFrame(
              sketch,
              sketch.plane.type === 'face' ? meshes[sketch.plane.bodyId ?? ''] : undefined,
            )
          : sketchFrameOf(sketch, sketchFrames[sketch.id])
        : null,
    [sketch, activeSketchReady, meshes, sketchFrames],
  );
  const { run: runConstraintAction } = useApplyConstraintAction(sketch);

  const [draft, setDraft] = useState<DraftPoint[]>([]);
  // The ref mirrors the draft synchronously, so a tool switch can clear it
  // before the next click even if React has not rendered the reset yet.
  const draftRef = useRef<DraftPoint[]>([]);
  const updateDraft = (next: DraftPoint[]) => {
    draftRef.current = next;
    setDraft(next);
  };
  const [hover, setHover] = useState<Point2 | null>(null);
  const [hoverSnap, setHoverSnap] = useState<SketchSnap | null>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  const highlightKey = useRef('');
  const commitQueue = useRef<Promise<void>>(Promise.resolve());
  // Last line of a polyline, so the next segment can be joined to it.
  const polylineTail = useRef<string | null>(null);
  // The tool that produced the current draft. A tool switch must not reuse it.
  const draftToolRef = useRef<SketchTool>(tool);

  const applyAutoHighlight = (ids: string[]) => {
    const key = ids.join('|');
    if (highlightKey.current === key) return;
    highlightKey.current = key;
    setSketchAutoHighlight(ids);
  };

  // The view before the first sketch is remembered across sketch switches and
  // restored once editing finishes. The frame is only aligned after the
  // rebuild at the sketch's timeline position has finished.
  const cameraBeforeSketch = useRef<ViewportCamera | null>(null);
  const editedSketch = useRef<string | null>(null);
  const alignedFrame = useRef('');

  useEffect(() => {
    updateDraft([]);
    setHover(null);
    setHoverSnap(null);
    polylineTail.current = null;
    draftToolRef.current = tool;
    applyAutoHighlight([]);
    setSketchHover([]);
  }, [activeSketchId, tool, sketchToolNonce]);

  useEffect(() => {
    if (!activeSketchId) return;
    if (!sketch || !canEditSketch(sketch, featureErrors)) setActiveSketch(null);
  }, [activeSketchId, sketch, featureErrors, setActiveSketch]);

  // Editing a sketch happens at its own place in the timeline: the cursor moves
  // in front of the sketch, so the model is exactly its input, and the sketch
  // itself is drawn from the operation preview. The camera and sketch are
  // oriented only after that rebuild has been applied.
  useEffect(() => {
    if (!activeSketchId) return;
    // The sketch editor is an operation edit: the cursor rolls in front of the
    // sketch and is restored when the sketch is finished.
    useDocumentStore.getState().beginFeatureEdit(activeSketchId);
    alignedFrame.current = '';
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    const startVersion = useKernelStore.getState().sceneVersion;
    if (useKernelStore.getState().status !== 'ready') {
      setActiveSketchReady(true);
    } else {
      // Trigger the rebuild and wait until the kernel publishes the preview of
      // this sketch. A rebuild that was already running for an older state does
      // not satisfy this condition.
      void rebuildScene(useDocumentStore.getState().project, i18n.t('status.rebuild')).catch(
        () => undefined,
      );
      unsubscribe = useKernelStore.subscribe((state) => {
        if (state.sceneVersion > startVersion && state.preview?.featureId === activeSketchId) {
          unsubscribe();
          if (!cancelled) setActiveSketchReady(true);
        }
      });
    }
    return () => {
      cancelled = true;
      unsubscribe();
      useDocumentStore.getState().endFeatureEdit();
    };
  }, [activeSketchId, setActiveSketchReady, i18n]);

  // Re-solve once on entry so sketches saved with a violated constraint get
  // repaired before the user starts dragging.
  useEffect(() => {
    if (!activeSketchId) return;
    const feature = currentSketch();
    if (!feature || feature.constraints.length === 0) return;
    void solveSketch(feature.entities, feature.constraints, [])
      .then((result) => {
        if (result.conflicting.length > 0) return;
        const current = currentSketch();
        if (!current) return;
        const solvedById = new Map(result.entities.map((candidate) => [candidate.id, candidate]));
        const entities = current.entities.map(
          (candidate) => solvedById.get(candidate.id) ?? candidate,
        );
        if (JSON.stringify(entities) === JSON.stringify(current.entities)) return;
        preview({ type: 'feature/replace', feature: { ...current, entities } });
      })
      .catch(() => undefined);
  }, [activeSketchId]);

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

  // The view before the first sketch is remembered across sketch switches and
  // restored once editing finishes. Preparing the editor runs once per entry;
  // frame changes only re-align the camera.
  useEffect(() => {
    if (!activeSketchId || !activeSketchReady) return;
    cameraBeforeSketch.current ??= getViewport()?.getCameraState() ?? null;
    // While the sketch is open the inspector shows the operation being edited:
    // its placement, composition and constraints.
    editedSketch.current = activeSketchId;
    useDocumentStore.getState().select({ kind: 'feature', id: activeSketchId });
  }, [activeSketchId, activeSketchReady]);

  useEffect(() => {
    if (!activeSketchId || !frame || !activeSketchReady) return;
    const key = frameKeyOf(frame);
    if (alignedFrame.current === key) return;
    alignedFrame.current = key;
    getViewport()?.alignSketch(frame, sketch?.entities ?? []);
  }, [activeSketchId, frame, sketch?.entities, activeSketchReady]);

  useEffect(() => {
    if (activeSketchId) return;
    const saved = cameraBeforeSketch.current;
    cameraBeforeSketch.current = null;
    if (saved) getViewport()?.setCameraState(saved);
    // Finishing hands the inspector back to the finished sketch object.
    const finished = editedSketch.current;
    editedSketch.current = null;
    if (
      finished &&
      useDocumentStore.getState().project.features.some((item) => item.id === finished)
    ) {
      useDocumentStore.getState().select({ kind: 'sketch', id: finished });
    }
  }, [activeSketchId]);

  useEffect(() => {
    getViewport()?.setSketchOverlay(null, []);
    return () => getViewport()?.setSketchOverlay(null, []);
  }, [activeSketchId]);

  // Geometry is inserted without a history entry, so the entity and its
  // automatic constraints end up as a single undoable operation.
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
    preview({ type: 'feature/replace', feature: { ...latest, entities } });
  };

  const currentSketch = (): SketchFeature | undefined =>
    useDocumentStore
      .getState()
      .project.features.find(
        (feature): feature is SketchFeature =>
          feature.id === sketch?.id && feature.type === 'sketch',
      );

  const applyAutoConstraintsNow = async (
    entity: SketchEntity,
    inputs: SketchSnapInput[],
    extra: SketchConstraint[] = [],
  ) => {
    if (!sketch) {
      applyAutoHighlight([]);
      return;
    }
    const auto = magnetEnabled
      ? autoConstraintsForEntity(entity, inputs)
      : { constraints: [], snapConstraints: [], highlightIds: [] };
    const base = [...auto.constraints, ...extra];
    if (base.length === 0) {
      applyAutoHighlight([]);
      return;
    }
    const attempts: SketchConstraint[][] = [base];
    if (auto.snapConstraints.length > 0) {
      const fallback = [...auto.snapConstraints, ...extra];
      if (fallback.length !== base.length) attempts.push(fallback);
    }
    for (const constraints of attempts) {
      if (constraints.length === 0) continue;
      const latest = currentSketch();
      if (!latest) return;
      try {
        const result = await solveSketch(
          latest.entities,
          [...latest.constraints, ...constraints],
          [],
          { diagnose: true },
        );
        if (result.conflicting.length > 0 || result.redundant.length > 0) continue;
        if (!result.entities.some((candidate) => candidate.id === entity.id)) continue;
        const current = currentSketch();
        if (!current) return;
        // The solver may also move existing geometry to satisfy the new
        // constraint, so the whole solution has to be merged back.
        const solvedById = new Map(result.entities.map((candidate) => [candidate.id, candidate]));
        const currentEntities = current.entities.map(
          (candidate) => solvedById.get(candidate.id) ?? candidate,
        );
        for (const candidate of result.entities) {
          if (!currentEntities.some((existing) => existing.id === candidate.id)) {
            currentEntities.push(candidate);
          }
        }
        const appliedConstraints = constraints.filter(
          (constraint) => !current.constraints.some((candidate) => candidate.id === constraint.id),
        );
        preview({
          type: 'feature/replace',
          feature: {
            ...current,
            entities: currentEntities,
            constraints: [...current.constraints, ...appliedConstraints],
          },
        });
        setSketchFrozen(result.frozenEntityIds);
        setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
        applyAutoHighlight(auto.highlightIds);
        return;
      } catch {
        // Try the next fallback below.
      }
    }
    applyAutoHighlight([]);
  };

  const commitNewEntity = (
    entity: SketchEntity,
    inputs: SketchSnapInput[],
    extra: SketchConstraint[] = [],
  ) => {
    const before = useDocumentStore.getState().project;
    mergeEntity(entity);
    commitQueue.current = commitQueue.current
      .then(() => applyAutoConstraintsNow(entity, inputs, extra))
      .then(() => commitPreview(before))
      .catch(() => commitPreview(before));
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
        draft.map(({ input }) => input),
      );
    }
    updateDraft([]);
    setHoverSnap(null);
  };

  // Ends a polyline but keeps the line tool active for the next chain.
  const finishLine = () => {
    updateDraft([]);
    setHoverSnap(null);
    polylineTail.current = null;
  };

  const addPoint = (point: Point2, input: SketchSnapInput) => {
    const activeTool = useUiStore.getState().sketchTool;
    const toolChanged = draftToolRef.current !== activeTool;
    const currentDraft = toolChanged ? [] : draftRef.current;
    if (toolChanged) {
      draftToolRef.current = activeTool;
      updateDraft([]);
      setHover(null);
      setHoverSnap(null);
      polylineTail.current = null;
    }
    if (activeTool === 'point') {
      const entity: SketchEntity = {
        id: createId('entity'),
        type: 'point',
        construction: false,
        x: point[0],
        y: point[1],
      };
      void commitNewEntity(entity, [input]);
      return;
    }
    if (activeTool === 'bezier') {
      updateDraft([...currentDraft, { point, input }]);
      return;
    }
    if (activeTool === 'line') {
      if (currentDraft.length === 0) {
        polylineTail.current = null;
        updateDraft([{ point, input }]);
        return;
      }
      if (distance(currentDraft[0]!.point, point) <= 0.01) return;
      const entity: SketchEntity = {
        id: createId('entity'),
        type: 'line',
        construction: false,
        x1: currentDraft[0]!.point[0],
        y1: currentDraft[0]!.point[1],
        x2: point[0],
        y2: point[1],
      };
      // Consecutive segments share a vertex, so the solver must keep them
      // joined instead of letting the next drag pull them apart.
      const extra: SketchConstraint[] = polylineTail.current
        ? [
            {
              id: createId('con'),
              type: 'coincident',
              refs: [
                { entityId: polylineTail.current, pointIndex: 1 },
                { entityId: entity.id, pointIndex: 0 },
              ],
            },
          ]
        : [];
      void commitNewEntity(entity, [currentDraft[0]!.input, input], extra);
      polylineTail.current = entity.id;
      // The end of this segment becomes the start of the next one. Clear the
      // hover so the committed segment does not leave a zero-length preview.
      updateDraft([{ point, input }]);
      setHover(null);
      setHoverSnap(null);
      return;
    }
    if (activeTool === 'circle') {
      if (currentDraft.length === 0) updateDraft([{ point, input }]);
      else {
        const radius = distance(currentDraft[0]!.point, point);
        if (radius > 0.01) {
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'circle',
            construction: false,
            cx: currentDraft[0]!.point[0],
            cy: currentDraft[0]!.point[1],
            r: radius,
          };
          void commitNewEntity(entity, [currentDraft[0]!.input, input]);
        }
        updateDraft([]);
        setHoverSnap(null);
      }
      return;
    }
    if (activeTool === 'arc') {
      if (currentDraft.length < 2) updateDraft([...currentDraft, { point, input }]);
      else {
        const [origin, start] = currentDraft;
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
          void commitNewEntity(entity, [origin!.input, start!.input, input]);
        }
        updateDraft([]);
        setHoverSnap(null);
      }
      return;
    }
    if (activeTool === 'ellipse') {
      if (currentDraft.length === 0) updateDraft([{ point, input }]);
      else {
        const rx = Math.abs(point[0] - currentDraft[0]!.point[0]);
        const ry = Math.abs(point[1] - currentDraft[0]!.point[1]);
        if (rx > 0.01 && ry > 0.01) {
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'ellipse',
            construction: false,
            cx: currentDraft[0]!.point[0],
            cy: currentDraft[0]!.point[1],
            rx,
            ry,
            rotation: 0,
          };
          void commitNewEntity(entity, [currentDraft[0]!.input, input]);
        }
        updateDraft([]);
        setHoverSnap(null);
      }
    }
  };

  useEffect(() => {
    if (!activeSketchId || !sketch) return;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewport-canvas"]');
    if (!canvas) return;
    // The listener effect is rebuilt whenever the document or a tool changes,
    // so it restores the cursor from the current hover instead of the tool
    // alone: a late commit must not drop the pointer over geometry.
    const hovering = useUiStore.getState().sketchHoverIds.length > 0;
    canvas.style.cursor = tool === 'select' ? (hovering ? 'pointer' : 'default') : 'crosshair';

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDown.current = { x: event.clientX, y: event.clientY };
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool !== 'select' || !sketch) return;
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      const pick = getViewport()?.pickSketch(
        event.clientX,
        event.clientY,
        currentSketchEntities(activeSketchId),
      );
      if (!pick?.entityId) return;
      const entity = sketchEntityIndex(sketch.entities).get(pick.entityId);
      if (!entity) return;
      // Fundamental geometry is fixed: it can be selected but not dragged.
      if (isFundamentalEntityId(entity.id)) return;
      setSketchHover([]);
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
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool === 'select') {
        const activeDrag = drag.current;
        if (!activeDrag) {
          // Preview what a click would take. A tool that creates geometry has
          // its own magnet feedback, so this hover is selection-only.
          const hoverPick = getViewport()?.pickSketch(
            event.clientX,
            event.clientY,
            currentSketchEntities(activeSketchId),
          );
          const hoverEntity = hoverPick?.entityId
            ? sketchEntityIndex(sketch.entities).get(hoverPick.entityId)
            : undefined;
          const hoverKey = sketchPickKey(hoverPick ?? null, hoverEntity);
          setSketchHover(hoverKey ? [hoverKey] : []);
          canvas.style.cursor = hoverKey ? 'pointer' : 'default';
          return;
        }
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
        const next = { ...current, entities };
        preview({ type: 'feature/replace', feature: next });
        const version = ++activeDrag.version;
        void solveDrag({
          entities,
          constraints: current.constraints,
          pinSets: dragPinSets(activeDrag),
        })
          .then((result) => {
            if (!result) return;
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
      const draftLength = draftToolRef.current === activeTool ? draftRef.current.length : 0;
      const mode = snapModeFor(activeTool, draftLength);
      const snap = getViewport()?.snapSketch(
        event.clientX,
        event.clientY,
        10,
        currentSketchEntities(activeSketchId),
      );
      if (!snap) {
        setHover(null);
        setHoverSnap(null);
        return;
      }
      const target = magnetEnabled ? snapTargetPoint(snap, mode) : null;
      setHover(target ?? gridPoint(snap.point));
      setHoverSnap(magnetEnabled && target ? snap : null);
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
      const version = ++activeDrag.version;
      void solveDrag({
        entities: latest.entities,
        constraints: latest.constraints,
        pinSets: dragPinSets(activeDrag),
      })
        .then((result) => {
          if (activeDrag.version !== version) return;
          if (!result) {
            preview({ type: 'feature/replace', feature: activeDrag.original });
            useUiStore.getState().showToast('constraint.conflict', 'error');
            return;
          }
          preview({
            type: 'feature/replace',
            feature: { ...activeDrag.original, entities: result.entities },
          });
          setSketchFrozen(result.frozenEntityIds);
          setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
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
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool === 'select') {
        const pick = getViewport()?.pickSketch(
          event.clientX,
          event.clientY,
          currentSketchEntities(activeSketchId),
        );
        if (!pick) return;
        const pickEntity = pick.entityId
          ? sketchEntityIndex(sketch.entities).get(pick.entityId)
          : undefined;
        const key = sketchPickKey(pick, pickEntity);
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
      const draftLength = draftToolRef.current === activeTool ? draftRef.current.length : 0;
      const mode = snapModeFor(activeTool, draftLength);
      const snap = getViewport()?.snapSketch(
        event.clientX,
        event.clientY,
        10,
        currentSketchEntities(activeSketchId),
      );
      if (!snap) return;
      const target = magnetEnabled ? snapTargetPoint(snap, mode) : null;
      addPoint(target ?? gridPoint(snap.point), {
        snap: magnetEnabled && target ? snap : null,
        mode: magnetEnabled && target ? mode : 'none',
      });
    };
    const onDoubleClick = () => {
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool === 'bezier') finishBezier();
      else if (activeTool === 'line') finishLine();
    };

    const onContextMenu = (event: globalThis.MouseEvent) => {
      if (useUiStore.getState().sketchTool !== 'select') return;
      const current = currentSketch();
      if (!current) return;
      const pick = getViewport()?.pickSketch(
        event.clientX,
        event.clientY,
        currentSketchEntities(current.id),
      );
      if (!pick?.entityId) return;
      event.preventDefault();
      const entityId = pick.entityId;
      const entityIds = selectionIds.map((key) => key.split('#')[0]!).filter(Boolean);
      openContextMenu(
        event.clientX,
        event.clientY,
        referenceMenuItems(
          current,
          entityId,
          (key) => t(key as never),
          locale,
          (next) => apply({ type: 'feature/replace', feature: next }),
          {
            selectedEntityIds: entityIds.includes(entityId) ? entityIds : [entityId],
            onSelectConstraints: (ids) => selectSketchConstraints(ids),
            onDelete: (ids) => {
              const next = removeSketchEntities(current, ids);
              apply({ type: 'feature/replace', feature: next });
              setSketchSelection([]);
              void diagnoseSketch(next);
            },
          },
        ),
      );
    };

    const onPointerLeave = () => {
      setSketchHover([]);
      if (useUiStore.getState().sketchTool === 'select') canvas.style.cursor = 'default';
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerup', finishDrag);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerup', finishDrag);
    };
  }, [
    activeSketchId,
    tool,
    draft,
    sketch,
    selectionIds,
    setSketchSelection,
    selectSketchConstraints,
    preview,
    commitPreview,
    magnetEnabled,
    locale,
    openContextMenu,
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
    (draft.some(({ input }) => Boolean(input.snap)) ||
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
    const midpointMarker =
      magnetEnabled && hoverSnap?.midpointSnap ? hoverSnap.midpointSnap.point : null;
    getViewport()?.setSketchOverlay(
      previewEntity(),
      draft.map(({ point }) => point),
      previewAuto,
      midpointMarker,
    );
  }, [activeSketchId, tool, draft, hover, previewAuto, hoverSnap, magnetEnabled]);

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
      const activeTool = useUiStore.getState().sketchTool;
      if (event.key === 'Escape') {
        // While a tool has progress, Escape only rewinds it. With no progress
        // it returns to Select, and Select itself finishes the sketch.
        if (draftRef.current.length > 0) {
          updateDraft([]);
          setHover(null);
          setHoverSnap(null);
          setSketchSelection([]);
          polylineTail.current = null;
          return;
        }
        setSketchSelection([]);
        if (activeTool !== 'select') {
          setSketchTool('select');
          return;
        }
        setActiveSketch(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedConstraintIds.length > 0 && sketch) {
          const removed = new Set(selectedConstraintIds);
          const next = {
            ...sketch,
            constraints: sketch.constraints.filter((constraint) => !removed.has(constraint.id)),
          };
          apply({ type: 'feature/replace', feature: next });
          selectSketchConstraint(null);
          void diagnoseSketch(next);
          return;
        }
        const entityIds = selectionIds.filter(
          (key) => !key.includes('#') && !isFundamentalEntityId(key),
        );
        if (entityIds.length > 0 && sketch) {
          const next = removeSketchEntities(sketch, entityIds);
          apply({ type: 'feature/replace', feature: next });
          setSketchSelection([]);
          void diagnoseSketch(next);
        }
      }
      if (event.key === 'Enter' && activeTool === 'bezier') finishBezier();
      if (event.key === 'Enter' && activeTool === 'line') finishLine();
      const shortcutConstraint = constraintFromShortcut(event);
      if (shortcutConstraint) {
        const action = sketch
          ? buildConstraintActions(sketch, selectionIds).find(
              (candidate) => candidate.type === shortcutConstraint,
            )
          : undefined;
        if (action) {
          event.preventDefault();
          closeContextMenu();
          void runConstraintAction(action);
          return;
        }
      }
      const shortcutTool = sketchToolFromShortcut(event);
      if (shortcutTool) {
        event.preventDefault();
        closeContextMenu();
        setSketchTool(shortcutTool);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!sketch || !activeSketchId || !activeSketchReady) return null;

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

  const liveMeasure = (() => {
    const preview = previewEntity();
    if (!preview || !frame) return null;
    const infos = liveMeasures(preview)
      .map((measure) => measureInfo(preview, measure, locale, 'mm'))
      .filter((info): info is NonNullable<typeof info> => info !== null);
    if (infos.length === 0) return null;
    const anchor = liveAnchor(preview);
    const projected = anchor ? getViewport()?.projectSketchPoint(frame, anchor) : null;
    return {
      text: infos.map((info) => info.text).join(' · '),
      x: projected?.x ?? null,
      y: projected?.y ?? null,
    };
  })();

  return (
    <div className="sketch-overlay" data-sketch-hover={sketchHoverIds.join(' ') || undefined}>
      {liveMeasure && liveMeasure.x !== null && liveMeasure.y !== null && (
        <div
          className="sketch-live-measure"
          data-testid="sketch-live-measure"
          style={{ left: liveMeasure.x, top: liveMeasure.y }}
        >
          {liveMeasure.text}
        </div>
      )}
      <div className="sketch-hint">
        {hint || (sketch.entities.length === 0 ? t('sketch.empty') : '')}
      </div>
    </div>
  );
}

function liveAnchor(entity: SketchEntity): Point2 | null {
  switch (entity.type) {
    case 'line':
      return [(entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2];
    case 'circle':
      return [entity.cx + entity.r * 0.7071, entity.cy + entity.r * 0.7071];
    case 'arc':
      return [
        entity.cx + Math.cos(entity.startAngle) * entity.r,
        entity.cy + Math.sin(entity.startAngle) * entity.r,
      ];
    case 'ellipse':
      return [entity.cx + entity.rx, entity.cy + entity.ry];
    case 'bezier': {
      const last = entity.points[entity.points.length - 1];
      return last ?? null;
    }
    default:
      return null;
  }
}
