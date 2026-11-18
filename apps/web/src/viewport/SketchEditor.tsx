import {
  activeModel,
  collectFormulas,
  createId,
  type Project,
  type Resolved,
  type ResolvedModel,
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
import { arcDraftEndAngle, arcStartAngle } from '../sketch/arcDraft';
import { solveSketch } from '../sketch/client';
import { rebuildScene } from '../kernel/rebuild';
import { autoConstraintsForEntity, isNearAxis, snapHighlightIds } from '../sketch/autoConstraints';
import {
  buildConstraintActions,
  constraintsSatisfied,
  diagnoseSketch,
  removeSketchEntities,
  uniqueConstraints,
} from '../sketch/constraintModel';
import {
  SKETCH_CONSTRUCTION_SHORTCUT,
  shortcutLetter,
  sketchToolFromShortcut,
} from '../sketch/tool';
import { toggleConstruction } from '../sketch/construction';
import {
  dragAnchors,
  dragCreates,
  dragEndsChain,
  isTap,
  TAP_SLOP_PX,
} from '../sketch/createGesture';
import { useApplyConstraintAction } from '../sketch/useConstraintActions';
import { resolveConstraintShortcut } from '../ui/constraintCatalog';
import { isAdditiveClick } from '../ui/listSelection';
import { canEditSketch, faceBoundsInFrame, sketchFrameOf } from '../sketch/sectionPlane';
import { solveDrag } from '../sketch/dragSolve';
import { liveMeasures, measureInfo } from '../sketch/measure';
import { sketchPickKey } from '../sketch/pickKey';
import {
  isProjectedEntity,
  projectionEntityIds,
  resolveSketchProjections,
} from '../sketch/projection';
import { referenceMenuItems } from '../sketch/referenceMenu';
import { resolveSketchPoint, snapModeFor } from '../sketch/resolvePoint';
import { constraintsForSolve, sketchHasFormulaError } from '../sketch/resolvedConstraints';
import type { SketchSnap, SketchSnapInput } from '../sketch/snap';
import type { SketchTool } from '../sketch/tool';
import { useDocumentStore } from '../stores/documentStore';
import {
  expressionErrors,
  resolvedFeatureFor,
  resolvedModel,
  useFormulaStore,
} from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from '../ui/ContextMenu';
import { isKeylessPointer, lastPointerType } from './inputProfile';
import { emptyTapClearsSelectionCount } from './selectionPick';
import { isDoubleTap, type TapMark } from './doubleTap';
import { getViewport, type ViewportCamera } from './handle';

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

interface DraftPoint {
  point: Point2;
  input: SketchSnapInput;
}

/**
 * Entities offered to picking and snapping: the stored geometry plus the
 * fundamental origin and axes, which every sketch has a priori.
 */
function currentSketchEntities(sketchId: string | null): readonly SketchEntity[] {
  if (!sketchId) return [];
  const feature = activeModel(useDocumentStore.getState().project).features.find(
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
  /** Newest pointer position while a solve is still running. */
  target: Point2 | null;
  solving: boolean;
  /** Solve attempt that worked last time, so the drag starts from it. */
  attempt: string | null;
  /** Pointer position the current preview was solved for. */
  solvedPoint: Point2 | null;
  /** A drag may move from one pinned axis to the other only once. */
  switchedAxis: boolean;
}

/** The sketch with the dragged entity moved to where the pointer asks. */
function dragEntities(drag: DragState, point: Point2, entities: SketchEntity[]): SketchEntity[] {
  // Building the target from the last solved geometry keeps the solver on the
  // branch the user already sees. Rebuilding it from the pre-drag entity makes
  // every frame jump back to the original configuration and lets the solver
  // flip between branches.
  const base = entities.find((entity) => entity.id === drag.entityId) ?? drag.originalEntity;
  const moved =
    drag.mode === 'point'
      ? moveEntityControlPoint(base, drag.pointIndex ?? 0, point)
      : translateEntity(
          base,
          point[0] - (drag.solvedPoint ?? drag.startPoint)[0],
          point[1] - (drag.solvedPoint ?? drag.startPoint)[1],
        );
  return entities.map((entity) => (entity.id === drag.entityId ? moved : entity));
}

/** Whether any constraint can move this entity, and with it, the rest. */
function isDraggedEntityConstrained(constraints: SketchConstraint[], entityId: string): boolean {
  return constraints.some((constraint) => constraint.refs.some((ref) => ref.entityId === entityId));
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
  const project = activeModel(useDocumentStore((state) => state.project));
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
  const formulaRevision = useFormulaStore((state) => state.resolution?.revision ?? 0);
  const frame = useMemo(() => {
    if (!sketch) return null;
    const driven = resolvedFeatureFor(sketch) ?? sketch;
    // The rebuild at the sketch's own place in the history freezes its face
    // frame. Recomputing that frame from the live body mesh lets a rebuild of
    // the sketch's own result move the whole sketch under the pointer.
    return sketchFrameOf(driven, sketchFrames[sketch.id]);
  }, [sketch, sketchFrames, formulaRevision]);
  // A sketch placed on a face should open with the whole face visible, not
  // just its own wireframe. The four bounding corners are enough for framing
  // and stay cheap even on a dense mesh.
  const faceOutline = useMemo((): Point2[] => {
    if (!sketch || sketch.plane.type !== 'face' || !frame) return [];
    const mesh = sketch.plane.bodyId ? meshes[sketch.plane.bodyId] : undefined;
    const faceId = sketch.plane.topoId === undefined ? NaN : Number(sketch.plane.topoId);
    return faceBoundsInFrame(mesh, faceId, frame);
  }, [meshes, sketch, frame]);
  const { run: runConstraintAction } = useApplyConstraintAction(sketch);
  const drivenSketches = useFormulaStore((state) => state.resolution?.drivenSketches);
  const drag = useRef<DragState | null>(null);

  // Driven dimensions resolve to numbers, but the solver is what moves the
  // geometry: solving here writes the solved entities back, so the editor shows
  // the sketch the formulas describe instead of the last stored snapshot.
  useEffect(() => {
    if (!sketch || !activeSketchReady || !drivenSketches?.has(sketch.id)) return;
    if (sketchHasFormulaError(sketch.id)) return;
    // The drag solver owns the geometry while the pointer moves. A driven
    // solve in the same frame would pull the preview towards the formula
    // solution and back, which reads as the sketch shaking under the pointer.
    if (drag.current?.active) return;
    const resolved = resolvedFeatureFor(sketch);
    if (!resolved || resolved.type !== 'sketch') return;
    // A formula that computes the value the sketch already has changes
    // nothing; re-solving it would only expose unrelated solver limitations.
    if (constraintsSatisfied(resolved.constraints, resolved.entities)) return;
    let cancelled = false;
    void solveSketch(resolved.entities, resolved.constraints, [], {
      derived: [...projectionEntityIds(resolved)],
    })
      .then((result) => {
        if (cancelled || result.conflicting.length > 0) return;
        const state = useDocumentStore.getState();
        const current = activeModel(state.project).features.find(
          (candidate): candidate is SketchFeature =>
            candidate.id === sketch.id && candidate.type === 'sketch',
        );
        if (!current) return;
        if (JSON.stringify(current.entities) === JSON.stringify(result.entities)) return;
        state.apply({
          type: 'feature/replace',
          feature: { ...current, entities: result.entities },
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sketch, activeSketchReady, drivenSketches, formulaRevision]);

  const [draft, setDraft] = useState<DraftPoint[]>([]);
  // The ref mirrors the draft synchronously, so a tool switch can clear it
  // before the next click even if React has not rendered the reset yet.
  const draftRef = useRef<DraftPoint[]>([]);
  // The third arc point is stored unwrapped, so crossing the -π branch cut
  // continues the same sweep instead of flipping the arc.
  const draftArcEnd = useRef<number | null>(null);
  const updateDraft = (next: DraftPoint[]) => {
    if (next.length === 0) draftArcEnd.current = null;
    draftRef.current = next;
    setDraft(next);
  };
  const [hover, setHover] = useState<Point2 | null>(null);
  const [hoverSnap, setHoverSnap] = useState<SketchSnap | null>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  // A finger drops a set it built with a second tap in the same empty place.
  const lastEmptyTap = useRef<TapMark | null>(null);
  // A press that may become a stretch, and the tap it must not also send.
  const createPress = useRef<{
    tool: SketchTool;
    pointerId: number;
    x: number;
    y: number;
    point: DraftPoint;
    active: boolean;
  } | null>(null);
  const skipClick = useRef(false);
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
  const cameraBeforeSketch = useRef<{ modelId: string; pose: ViewportCamera } | null>(null);
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
    if (!activeSketchId || !activeSketchReady) return;
    if (!sketch || !canEditSketch(sketch, featureErrors)) setActiveSketch(null);
  }, [activeSketchId, activeSketchReady, sketch, featureErrors, setActiveSketch]);

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
    if (sketchHasFormulaError(activeSketchId)) {
      setActiveSketchReady(true);
      return () => useDocumentStore.getState().endFeatureEdit();
    }
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    let unsubscribeFormula: () => void = () => undefined;
    const startVersion = useKernelStore.getState().sceneVersion;
    if (useKernelStore.getState().status !== 'ready') {
      setActiveSketchReady(true);
    } else {
      // Trigger the rebuild and wait until the kernel publishes the preview of
      // this sketch. A rebuild that was already running for an older state does
      // not satisfy this condition.
      const rebuild = () => {
        const resolved = resolvedModel();
        if (!resolved) return false;
        // The formula resolution is one render behind a plane edit. A sketch
        // without formulas is its own resolved copy, so substituting the
        // authored feature keeps the entry rebuild from using the plane the
        // sketch just left.
        const authored = activeModel(useDocumentStore.getState().project).features.find(
          (candidate): candidate is SketchFeature =>
            candidate.id === activeSketchId && candidate.type === 'sketch',
        );
        const model: ResolvedModel =
          authored && collectFormulas(authored, authored.id).length === 0
            ? {
                ...resolved,
                features: resolved.features.map((feature) =>
                  feature.id === authored.id ? (authored as Resolved<SketchFeature>) : feature,
                ),
              }
            : resolved;
        void rebuildScene(model, i18n.t('status.rebuild'), {
          expressionErrors: expressionErrors(),
          drivenSketches: useFormulaStore.getState().resolution?.drivenSketches,
        }).catch(() => undefined);
        return true;
      };
      if (!rebuild()) {
        // Entering before the first resolution exists must not wedge the
        // editor: rebuild as soon as the model is there.
        unsubscribeFormula = useFormulaStore.subscribe((state) => {
          if (!state.resolution?.model) return;
          unsubscribeFormula();
          rebuild();
        });
      }
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
      unsubscribeFormula();
      useDocumentStore.getState().endFeatureEdit();
    };
  }, [activeSketchId, setActiveSketchReady, i18n]);

  // A formula can break while the sketch is already open. There is no preview
  // to wait for then: keep the last solved geometry on screen and let the user
  // fix the formula.
  useEffect(() => {
    if (!activeSketchId || activeSketchReady) return;
    if (sketchHasFormulaError(activeSketchId)) setActiveSketchReady(true);
  }, [activeSketchId, activeSketchReady, formulaRevision, setActiveSketchReady]);

  // Re-solve once on entry so sketches saved with a violated constraint get
  // repaired before the user starts dragging.
  useEffect(() => {
    if (!activeSketchId) return;
    const feature = currentSketch();
    if (!feature || feature.constraints.length === 0) return;
    if (sketchHasFormulaError(feature.id)) return;
    // A driven sketch is solved by the formula effect below with the resolved
    // numbers; the authored feature here still holds formula objects.
    if (useFormulaStore.getState().resolution?.drivenSketches?.has(feature.id)) return;
    const resolved = resolvedFeatureFor(feature);
    if (!resolved || resolved.type !== 'sketch') return;
    // An under-constrained sketch has many valid solutions. Solving a valid
    // sketch would move it along that freedom, and the resulting document
    // change can start the effect again: the sketch drifts on its own and the
    // project keeps saving. Only repair geometry that actually violates a
    // constraint.
    if (constraintsSatisfied(resolved.constraints, resolved.entities)) return;
    void solveSketch(resolved.entities, resolved.constraints, [], {
      derived: [...projectionEntityIds(resolved)],
    })
      .then((result) => {
        if (result.conflicting.length > 0) return;
        // An under-constrained sketch has no unique solution. A free solve
        // would pick an arbitrary point on its remaining freedom, and applying
        // that on entry moves a perfectly valid sketch every time the effect
        // runs. Only a fully constrained sketch has a repair to apply; a
        // redundant one has no unambiguous repair either.
        if (result.dof > 0 || result.redundant.length > 0) return;
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
  }, [activeSketchId, formulaRevision]);

  // Projected geometry follows the bodies it was taken from. The stored
  // entities are the snapshot; as soon as the scene has a current body the
  // snapshot is refreshed so the editor, the solver and the profile agree.
  useEffect(() => {
    if (!sketch || !frame || (sketch.projections?.length ?? 0) === 0) return;
    const resolved = resolveSketchProjections(sketch, frame, (bodyId) => meshes[bodyId]);
    const ids = projectionEntityIds(sketch);
    const current = sketch.entities.filter((entity) => ids.has(entity.id));
    const next = resolved.entities.filter((entity) => ids.has(entity.id));
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    preview({ type: 'feature/replace', feature: { ...sketch, entities: resolved.entities } });
  }, [sketch, frame, meshes, preview]);

  useEffect(() => {
    if (!sketch) {
      setSketchFrozen([]);
      return;
    }
    const timer = setTimeout(() => {
      if (!drag.current?.active && !sketchHasFormulaError(sketch.id)) void diagnoseSketch(sketch);
    }, 200);
    return () => clearTimeout(timer);
  }, [activeSketchId, sketch?.constraints, sketch?.entities, formulaRevision]);

  // The view before the first sketch is remembered across sketch switches and
  // restored once editing finishes. Preparing the editor runs once per entry;
  // frame changes only re-align the camera.
  useEffect(() => {
    if (!activeSketchId || !activeSketchReady) return;
    if (!cameraBeforeSketch.current) {
      const pose = getViewport()?.getCameraState();
      // The model is remembered with the pose: a view belongs to a model, and a
      // switch to another one is not the exit that gives it back.
      const modelId = useDocumentStore.getState().project.activeSuperObjectId;
      if (pose) cameraBeforeSketch.current = { modelId, pose };
    }
    // While the sketch is open the inspector shows the operation being edited:
    // its placement, composition and constraints.
    editedSketch.current = activeSketchId;
    useDocumentStore.getState().select({ kind: 'feature', id: activeSketchId });
  }, [activeSketchId, activeSketchReady]);

  useEffect(() => {
    if (!activeSketchId || !frame || !activeSketchReady) return;
    const key = `${frameKeyOf(frame)}|${faceOutline.length}`;
    if (alignedFrame.current === key) return;
    alignedFrame.current = key;
    getViewport()?.alignSketch(frame, sketch?.entities ?? [], faceOutline);
  }, [activeSketchId, frame, faceOutline, sketch?.entities, activeSketchReady]);

  useEffect(() => {
    if (activeSketchId) return;
    const saved = cameraBeforeSketch.current;
    cameraBeforeSketch.current = null;
    // The reserved view returns to the model it was taken from. A sketch left by
    // switching models gives nothing back: the new model opens at its own view.
    if (saved && saved.modelId === useDocumentStore.getState().project.activeSuperObjectId) {
      getViewport()?.setCameraState(saved.pose);
    }
    // Finishing hands the inspector back to the finished sketch object.
    const finished = editedSketch.current;
    editedSketch.current = null;
    if (
      finished &&
      activeModel(useDocumentStore.getState().project).features.some((item) => item.id === finished)
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
    const latest = activeModel(useDocumentStore.getState().project).features.find(
      (feature): feature is SketchFeature => feature.id === sketch?.id && feature.type === 'sketch',
    );
    if (!latest) return;
    const entities = latest.entities.some((candidate) => candidate.id === entity.id)
      ? latest.entities.map((candidate) => (candidate.id === entity.id ? entity : candidate))
      : [...latest.entities, entity];
    preview({ type: 'feature/replace', feature: { ...latest, entities } });
  };

  const currentSketch = (): SketchFeature | undefined =>
    activeModel(useDocumentStore.getState().project).features.find(
      (feature): feature is SketchFeature => feature.id === sketch?.id && feature.type === 'sketch',
    );

  const applyAutoConstraintsNow = async (
    entity: SketchEntity,
    inputs: SketchSnapInput[],
    extra: SketchConstraint[] = [],
  ) => {
    if (!sketch || sketchHasFormulaError(sketch.id)) {
      applyAutoHighlight([]);
      return;
    }
    const auto = magnetEnabled
      ? autoConstraintsForEntity(entity, inputs)
      : { constraints: [], snapConstraints: [], highlightIds: [] };
    const currentFeature = currentSketch();
    if (!currentFeature) return;
    const entitiesMap = sketchEntityIndex(currentFeature.entities);
    // A snap and the polyline join can both produce the same coincidence; a
    // constraint the sketch already has must not be added a second time.
    const base = uniqueConstraints(
      [...auto.constraints, ...extra],
      currentFeature.constraints,
      entitiesMap,
    );
    const attempts: SketchConstraint[][] = [base];
    if (auto.snapConstraints.length > 0) {
      const fallback = uniqueConstraints(
        [...auto.snapConstraints, ...extra],
        currentFeature.constraints,
        entitiesMap,
      );
      if (fallback.length !== base.length) attempts.push(fallback);
    }
    if (attempts.every((candidate) => candidate.length === 0)) {
      applyAutoHighlight([]);
      return;
    }
    for (const constraints of attempts) {
      if (constraints.length === 0) continue;
      const latest = currentSketch();
      if (!latest) return;
      try {
        const result = await solveSketch(
          latest.entities,
          [...constraintsForSolve(latest), ...constraints],
          [],
          { diagnose: true, derived: [...projectionEntityIds(latest)] },
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
  ): Promise<SketchFeature | undefined> => {
    const before = useDocumentStore.getState().project;
    mergeEntity(entity);
    const committed = commitQueue.current
      .then(() => applyAutoConstraintsNow(entity, inputs, extra))
      .then(() => currentSketch())
      .catch(() => currentSketch());
    commitQueue.current = committed
      .then(() => commitPreview(before))
      .catch(() => commitPreview(before));
    return committed;
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
      const placed = commitNewEntity(entity, [currentDraft[0]!.input, input], extra);
      polylineTail.current = entity.id;
      // The end of this segment becomes the start of the next one. Clear the
      // hover so the committed segment does not leave a zero-length preview.
      const nextStart: DraftPoint[] = [{ point, input }];
      updateDraft(nextStart);
      setHover(null);
      setHoverSnap(null);
      // A coincidence can move the endpoint the solver just placed. The next
      // segment must start where the committed one actually ends, not where the
      // pointer was, or the preview grows out of thin air until the next solve.
      void placed.then((solvedFeature) => {
        if (draftRef.current !== nextStart || polylineTail.current !== entity.id) return;
        const solved = solvedFeature?.entities.find((candidate) => candidate.id === entity.id);
        if (solved?.type !== 'line') return;
        updateDraft([{ point: [solved.x2, solved.y2], input }]);
      });
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
      if (currentDraft.length < 2) {
        const next = [...currentDraft, { point, input }];
        if (next.length === 2) {
          draftArcEnd.current = arcStartAngle(next[0]!.point, point);
        }
        updateDraft(next);
      } else {
        const [origin, start] = currentDraft;
        const radius = distance(origin!.point, start!.point);
        if (radius > 0.01) {
          const startAngle = arcStartAngle(origin!.point, start!.point);
          const endAngle = arcDraftEndAngle(
            origin!.point,
            start!.point,
            point,
            draftArcEnd.current,
          );
          const entity: SketchEntity = {
            id: createId('entity'),
            type: 'arc',
            construction: false,
            cx: origin!.point[0],
            cy: origin!.point[1],
            r: radius,
            startAngle,
            endAngle,
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

    /**
     * The point a click or a finger gives the current tool: the neighbour the
     * magnet found, or the nearest half millimetre. One place decides it, so a
     * tap and the end of a stretch cannot land on different points.
     */
    const createPointAt = (
      clientX: number,
      clientY: number,
      forTool: SketchTool,
    ): DraftPoint | null => {
      const draft = draftToolRef.current === forTool ? draftRef.current : [];
      const mode = snapModeFor(forTool, draft.length);
      const snap = getViewport()?.snapSketch(
        clientX,
        clientY,
        10,
        currentSketchEntities(activeSketchId),
      );
      if (!snap) return null;
      return resolveSketchPoint({
        raw: snap.point,
        snap,
        tool: forTool,
        mode,
        magnet: magnetEnabled,
        anchor: forTool === 'line' && draft.length === 1 ? (draft[0]?.point ?? null) : null,
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      skipClick.current = false;
      pointerDown.current = { x: event.clientX, y: event.clientY };
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool !== 'select') {
        // A finger that travels stretches the next primitive from where it came
        // down, so the press point has to be kept before the first move.
        createPress.current = null;
        // A second finger pans and zooms the view; it must not also place a point.
        if (activeTool === 'project' || !sketch || !event.isPrimary) return;
        const press = createPointAt(event.clientX, event.clientY, activeTool);
        if (!press) return;
        createPress.current = {
          tool: activeTool,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          point: press,
          active: false,
        };
        return;
      }
      if (!sketch) return;
      const additive = isAdditiveClick(event);
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
      else if (isKeylessPointer(event.pointerType)) {
        // A finger or a pen has no key to hold and no hover to read: its tap is
        // taken here, on the press, and the click the browser sends after the
        // release must not read the same tap a second time. This is what makes
        // a selection grow press by press on a tablet.
        skipClick.current = true;
        setSketchSelection(
          selectionIds.includes(key)
            ? selectionIds.filter((candidate) => candidate !== key)
            : [...selectionIds, key],
        );
      }
      // Projected geometry is derived: it can be selected and detached, but the
      // next rebuild would overwrite whatever a drag does to it.
      if (isProjectedEntity(sketch, entity.id)) return;
      // Geometry without degrees of freedom has nowhere to go; solving it would
      // only let an unrelated free branch of the sketch wander.
      if (useUiStore.getState().sketchFrozenEntityIds.includes(entity.id)) return;
      // A sketch with a formula error keeps its last solved geometry until the
      // formula is fixed; no solver may move it meanwhile.
      if (sketchHasFormulaError(sketch.id)) return;
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
        target: null,
        solving: false,
        attempt: null,
        solvedPoint: null,
        switchedAxis: false,
      };
    };
    // One solve at a time, always for the newest pointer position: a queue of
    // solves would reach the sketch long after the pointer left, which reads as
    // the geometry jumping around.
    const pumpDrag = async (activeDrag: DragState) => {
      if (activeDrag.solving) return;
      activeDrag.solving = true;
      try {
        while (drag.current === activeDrag && activeDrag.target) {
          const point = activeDrag.target;
          activeDrag.target = null;
          const current = activeModel(useDocumentStore.getState().project).features.find(
            (feature): feature is SketchFeature =>
              feature.id === activeDrag.original.id && feature.type === 'sketch',
          );
          if (!current || sketchHasFormulaError(current.id)) return;
          const previousPoint = activeDrag.solvedPoint ?? activeDrag.startPoint;
          const delta = Math.hypot(point[0] - previousPoint[0], point[1] - previousPoint[1]);
          const axisHint =
            Math.abs(point[0] - previousPoint[0]) >= Math.abs(point[1] - previousPoint[1])
              ? 'x'
              : 'y';
          const solved = await solveDrag({
            entities: dragEntities(activeDrag, point, current.entities),
            constraints: constraintsForSolve(current),
            pinSets: dragPinSets(activeDrag),
            derived: [...projectionEntityIds(current)],
            prefer: activeDrag.attempt,
            previous: current.entities,
            movedEntityId: activeDrag.entityId,
            maxMove: 1.5 + 5 * delta,
            allowAxisSwitch: !activeDrag.switchedAxis,
            axisHint,
          });
          if (drag.current !== activeDrag) return;
          if (!solved) continue;
          if (
            (activeDrag.attempt === 'one:x' && solved.attempt === 'one:y') ||
            (activeDrag.attempt === 'one:y' && solved.attempt === 'one:x')
          ) {
            activeDrag.switchedAxis = true;
          }
          activeDrag.attempt = solved.attempt;
          activeDrag.solvedPoint = point;
          const latest = activeModel(useDocumentStore.getState().project).features.find(
            (feature): feature is SketchFeature =>
              feature.id === activeDrag.original.id && feature.type === 'sketch',
          );
          if (!latest) return;
          preview({
            type: 'feature/replace',
            feature: { ...latest, entities: solved.result.entities },
          });
        }
      } finally {
        activeDrag.solving = false;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const activeTool = useUiStore.getState().sketchTool;
      // The projection tool aims at the 3D scene, so the sketch has no hover.
      if (activeTool === 'project') return;
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
          // A tap never drags: a finger or a pen lands where it aims, and it
          // wanders further than a mouse does before it means to move anything.
          const slop = isKeylessPointer(event.pointerType) ? TAP_SLOP_PX : 3;
          if (
            Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY) <= slop
          ) {
            return;
          }
          activeDrag.active = true;
        }
        const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
        if (!pick) return;
        const state = useDocumentStore.getState();
        const current = activeModel(state.project).features.find(
          (feature): feature is SketchFeature =>
            feature.id === activeDrag.original.id && feature.type === 'sketch',
        );
        if (!current) return;
        const point: Point2 = [pick.point[0], pick.point[1]];
        activeDrag.target = point;
        // Nothing depends on a free entity, so it can follow the pointer right
        // away instead of waiting for a round trip.
        if (!isDraggedEntityConstrained(current.constraints, activeDrag.entityId)) {
          preview({
            type: 'feature/replace',
            feature: { ...current, entities: dragEntities(activeDrag, point, current.entities) },
          });
          activeDrag.solvedPoint = point;
          return;
        }
        void pumpDrag(activeDrag);
        return;
      }
      // A press that travels becomes a stretch: the press point becomes the
      // first point of the primitive and everything below previews from it.
      const press = createPress.current;
      const draftLength = draftToolRef.current === activeTool ? draftRef.current.length : 0;
      if (press && press.pointerId === event.pointerId && press.tool === activeTool) {
        if (
          !press.active &&
          dragCreates(event.pointerType, event.clientX - press.x, event.clientY - press.y)
        ) {
          press.active = true;
          if (dragAnchors(activeTool, draftLength)) updateDraft([press.point]);
        }
      }
      const draft = draftToolRef.current === activeTool ? draftRef.current : [];
      const mode = snapModeFor(activeTool, draft.length);
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
      const resolved = resolveSketchPoint({
        raw: snap.point,
        snap,
        tool: activeTool,
        mode,
        magnet: magnetEnabled,
        anchor: activeTool === 'line' && draft.length === 1 ? (draft[0]?.point ?? null) : null,
      });
      if (activeTool === 'arc' && draft.length >= 2) {
        draftArcEnd.current = arcDraftEndAngle(
          draft[0]!.point,
          draft[1]!.point,
          resolved.point,
          draftArcEnd.current,
        );
      }
      setHover(resolved.point);
      setHoverSnap(resolved.input.snap);
    };
    /**
     * A stretch ends where the finger lifts. That point is the one the next click
     * would have given, so the tools keep their own idea of what the points mean
     * and only the number of gestures changes.
     */
    const finishCreate = (event: PointerEvent) => {
      const press = createPress.current;
      if (!press) return;
      createPress.current = null;
      if (!press.active) return;
      // The tap the browser sends after the stretch must not add the point twice.
      skipClick.current = true;
      const release = createPointAt(event.clientX, event.clientY, press.tool);
      if (!release) return;
      addPoint(release.point, release.input);
      // A line and a curve name both ends with the gesture, so they end here
      // instead of waiting for the next click to continue the chain.
      if (dragEndsChain(press.tool)) {
        if (press.tool === 'line') finishLine();
        else finishBezier();
      }
      setHover(null);
      setHoverSnap(null);
    };
    const finishDrag = () => {
      const activeDrag = drag.current;
      drag.current = null;
      if (!activeDrag?.active) return;
      const latest = activeModel(useDocumentStore.getState().project).features.find(
        (feature): feature is SketchFeature =>
          feature.id === activeDrag.original.id && feature.type === 'sketch',
      );
      if (!latest) {
        preview({ type: 'feature/replace', feature: activeDrag.original });
        return;
      }
      if (sketchHasFormulaError(latest.id)) {
        preview({ type: 'feature/replace', feature: activeDrag.original });
        return;
      }
      // The last pointer position may still be waiting for its solve.
      const entities = activeDrag.target
        ? dragEntities(activeDrag, activeDrag.target, latest.entities)
        : latest.entities;
      const finalPoint = activeDrag.target ?? activeDrag.solvedPoint ?? activeDrag.startPoint;
      const previousPoint = activeDrag.solvedPoint ?? activeDrag.startPoint;
      const delta = Math.hypot(finalPoint[0] - previousPoint[0], finalPoint[1] - previousPoint[1]);
      const axisHint =
        Math.abs(finalPoint[0] - previousPoint[0]) >= Math.abs(finalPoint[1] - previousPoint[1])
          ? 'x'
          : 'y';
      activeDrag.target = null;
      void solveDrag({
        entities,
        constraints: constraintsForSolve(latest),
        pinSets: dragPinSets(activeDrag),
        derived: [...projectionEntityIds(latest)],
        prefer: activeDrag.attempt,
        previous: latest.entities,
        movedEntityId: activeDrag.entityId,
        maxMove: 1.5 + 5 * delta,
        allowAxisSwitch: !activeDrag.switchedAxis,
        axisHint,
      })
        .then((solved) => {
          const result = solved?.result ?? null;
          if (!result) {
            // A frame that would have jumped the sketch leaves the last good
            // solution in place instead of undoing the whole drag.
            if (activeDrag.solvedPoint) {
              commitPreview(activeDrag.before);
              return;
            }
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
      // A stretch already placed this point; the tap is its echo, not a second
      // point in the same place.
      if (skipClick.current) {
        skipClick.current = false;
        return;
      }
      if (down && !isTap(event.clientX - down.x, event.clientY - down.y)) return;
      const activeTool = useUiStore.getState().sketchTool;
      if (activeTool === 'project') return;
      if (activeTool === 'select') {
        const pick = getViewport()?.pickSketch(
          event.clientX,
          event.clientY,
          currentSketchEntities(activeSketchId),
        );
        if (!pick?.entityId) {
          const tap: TapMark = {
            time: performance.now(),
            x: event.clientX,
            y: event.clientY,
          };
          // A finger drops a set it built tap by tap only on a second tap in the
          // same empty place; one object still goes at once, as it does in 3D.
          if (!emptyTapClearsSelectionCount(selectionIds.length, lastPointerType())) {
            if (isDoubleTap(lastEmptyTap.current, tap)) {
              lastEmptyTap.current = null;
              setSketchSelection([]);
            } else {
              lastEmptyTap.current = tap;
            }
            return;
          }
          lastEmptyTap.current = null;
          setSketchSelection([]);
          return;
        }
        lastEmptyTap.current = null;
        const pickEntity = pick.entityId
          ? sketchEntityIndex(sketch.entities).get(pick.entityId)
          : undefined;
        const key = sketchPickKey(pick, pickEntity);
        const additive = isAdditiveClick(event);
        if (!key) {
          // A pick that names nothing, such as a construction marker, is no more
          // a row to toggle than empty space is.
          setSketchSelection([]);
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
      const point = createPointAt(event.clientX, event.clientY, activeTool);
      if (!point) return;
      addPoint(point.point, point.input);
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

    // A gesture the browser takes away, such as a call from outside the page,
    // leaves nothing behind: the stretch is dropped, not committed at its last
    // known place.
    const onPointerCancel = () => {
      createPress.current = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointerup', finishCreate);
    return () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointerup', finishCreate);
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
    if (tool === 'point') {
      // A point is the primitive that follows a finger: it is drawn where the
      // finger is and is placed where the finger lifts.
      return { id: 'preview', type: 'point', construction: false, x: hover[0], y: hover[1] };
    }
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
        startAngle: arcStartAngle(origin, second),
        endAngle: arcDraftEndAngle(origin, second, hover, draftArcEnd.current),
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
      if (
        sketch &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        shortcutLetter(event) === SKETCH_CONSTRUCTION_SHORTCUT
      ) {
        const next = toggleConstruction(sketch, selectionIds);
        if (next) {
          event.preventDefault();
          apply({ type: 'feature/replace', feature: next });
          return;
        }
      }
      if (event.key === 'Enter' && activeTool === 'bezier') finishBezier();
      if (event.key === 'Enter' && activeTool === 'line') finishLine();
      const shortcutAction = sketch
        ? resolveConstraintShortcut(buildConstraintActions(sketch, selectionIds), event)
        : null;
      if (shortcutAction) {
        event.preventDefault();
        closeContextMenu();
        void runConstraintAction(shortcutAction);
        return;
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
              : tool === 'project'
                ? t('sketch.projectionPickHint')
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
