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
  isFundamentalEntityId,
  curveEndIndices,
  entityEndpoints,
  moveEntityControlPoint,
  sketchEntityIndex,
  withFundamentalEntities,
  type OffsetJoin,
  type Point2,
} from '@icancad/sketch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { arcDraftEndAngle, arcStartAngle } from '../sketch/arcDraft';
import { draftMarkers } from '../sketch/draftMarkers';
import { draftGuides } from '../sketch/draftGuides';
import {
  ellipseFrame,
  ellipticalArcEndAngle,
  ellipticalArcFrame,
  ellipticalArcPoint,
} from '../sketch/ellipticalArcDraft';
import { solveSketch } from '../sketch/client';
import { faceIdByName } from '../kernel/topologyLookup';
import { rebuildScene } from '../kernel/rebuild';
import {
  autoConstraintsForEntity,
  hasMagnetTarget,
  snapHighlightIds,
} from '../sketch/autoConstraints';
import { applyAutoConstraints } from '../sketch/autoApply';
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
import {
  dragPinSets as pinsForDrag,
  movableEntities,
  isSelectionConstrained,
  moveDraggedEntities,
} from '../sketch/dragSelection';
import { liveMeasures, measureInfo, formatMeasure } from '../sketch/measure';
import { sketchPickKey } from '../sketch/pickKey';
import {
  commitExtend,
  extendTargets,
  planExtend,
  extendPreviewEntities,
  type ExtendFailure,
} from '../sketch/sketchExtend';
import { POLYGON_DRAFT_SIDES, polygonGeometry, polygonHint } from '../sketch/sketchPolygon';
import {
  commitFillet,
  filletPreviewEntities,
  planFillet,
  type FilletFailure,
} from '../sketch/sketchFillet';
import {
  commitSplit,
  planSplit,
  splitPreviewEntities,
  type SplitFailure,
} from '../sketch/sketchSplit';
import {
  commitTrim,
  planTrim,
  trimPreviewEntities,
  type TrimFailure,
} from '../sketch/sketchTrim';
import {
  commitOffsetSolved,
  offsetPreviewEntities,
  planOffset,
  type OffsetPlanError,
  type OffsetTool,
} from '../sketch/sketchOffset';
import {
  isProjectedEntity,
  projectionEntityIds,
  resolveSketchProjections,
  sketchProjectionSources,
} from '../sketch/projection';
import { entitiesInMarquee, marqueeMode, marqueeRect } from '../sketch/regionSelect';
import { referenceMenuItems } from '../sketch/referenceMenu';
import { resolveSketchPoint, snapModeFor } from '../sketch/resolvePoint';
import { constraintsForSolve, sketchHasFormulaError } from '../sketch/resolvedConstraints';
import type { SketchSnap, SketchSnapInput } from '../sketch/snap';
import type { SketchTool } from '../sketch/tool';
import { useDocumentStore } from '../stores/documentStore';
import { liveProject, useLiveEditStore } from '../stores/liveEditStore';
import {
  expressionErrors,
  resolvedFeatureFor,
  resolvedModel,
  useFormulaStore,
} from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';
import { useUiStore } from '../stores/uiStore';
import { useContextMenuStore } from '../ui/ContextMenu';
import { isKeylessPointer, lastPointerType, primaryInputProfile } from './inputProfile';
import { emptyTapClearsSelectionCount } from './selectionPick';
import { isDoubleTap, type TapMark } from './doubleTap';
import { getViewport, type ViewportCamera } from './handle';

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * How far from a curve the scissors still take it: one band of screen pixels on
 * each side of the curve. The reach is a band, not a distance in the sketch, so a
 * cut is as easy to aim at when the view is zoomed out as when it is close in.
 */
const TRIM_REACH_PX = 10;

/** The sketch length the scissors reach over, in the units of the sketch plane. */
function trimReach(): number {
  return getViewport()?.sketchLength(TRIM_REACH_PX) ?? Number.POSITIVE_INFINITY;
}

/** The message a failed offset or contour shows. */
function filletErrorKey(error: FilletFailure): string {
  switch (error) {
    case 'selection':
    case 'not-connected':
      return 'sketch.filletSelect';
    default:
      return 'sketch.filletFailed';
  }
}

function splitErrorKey(error: SplitFailure): string {
  switch (error) {
    case 'selection':
      return 'sketch.splitSelect';
    case 'end':
      return 'sketch.splitAtEnd';
    default:
      return 'sketch.splitFailed';
  }
}

function extendErrorKey(error: ExtendFailure): string {
  switch (error) {
    case 'selection':
      return 'sketch.extendSelect';
    case 'inside':
      return 'sketch.extendInside';
    default:
      return 'sketch.extendFailed';
  }
}

function trimErrorKey(error: TrimFailure): string {
  switch (error) {
    case 'selection':
      return 'sketch.trimSelect';
    case 'distance':
      return 'sketch.trimFar';
    default:
      return 'sketch.trimFailed';
  }
}

function offsetErrorKey(error: OffsetPlanError): string {
  switch (error) {
    case 'empty':
      return 'sketch.offsetSelect';
    case 'branching':
      return 'sketch.offsetBranching';
    case 'distance':
      return 'sketch.offsetFailed';
    case 'too-close':
      return 'sketch.offsetDistance';
    default:
      return 'sketch.offsetFailed';
  }
}

/** A curve the stretch has taken hold of, and the end of it that will grow. */
interface ExtendGrip {
  entityId: string;
  end: 'start' | 'end';
}

/** Where a pointer or a click stands; both ask the view what is under them. */
type PointerAt = Pick<PointerEvent, 'clientX' | 'clientY'>;

/**
 * The entity at the pointer's own grid points, with every magnet target
 * ignored. If the snap cannot become a constraint, the geometry must not stay
 * exactly on the target: it would look attached while a drag pulls it away.
 */
function unsnappedEntity(entity: SketchEntity, inputs: readonly SketchSnapInput[]): SketchEntity {
  let result = entity;
  inputs.forEach((input, index) => {
    if (!input.snap || !input.fallback) return;
    result = moveEntityControlPoint(result, index, input.fallback);
  });
  return result;
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
  /** Every entity the pointer moves; one curve unless several are selected. */
  movedIds: string[];
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

/** The sketch with the dragged entities moved to where the pointer asks. */
function dragEntities(drag: DragState, point: Point2, entities: SketchEntity[]): SketchEntity[] {
  // Building the target from the last solved geometry keeps the solver on the
  // branch the user already sees. Rebuilding it from the pre-drag entity makes
  // every frame jump back to the original configuration and lets the solver
  // flip between branches.
  return moveDraggedEntities({
    entities,
    grabbed: {
      id: drag.entityId,
      mode: drag.mode,
      pointIndex: drag.pointIndex,
      original: drag.originalEntity,
    },
    movedIds: drag.mode === 'point' ? [drag.entityId] : drag.movedIds,
    target: point,
    reference: drag.solvedPoint ?? drag.startPoint,
  });
}

function dragPinSets(drag: DragState): SketchConstraintRef[][] {
  return pinsForDrag({
    grabbed: {
      id: drag.entityId,
      mode: drag.mode,
      pointIndex: drag.pointIndex,
      original: drag.originalEntity,
    },
    movedIds: drag.mode === 'point' ? [drag.entityId] : drag.movedIds,
    startPoint: drag.startPoint,
    entities: drag.original.entities,
  });
}

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  base: string[];
  additive: boolean;
  active: boolean;
}

interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
  crossing: boolean;
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
    const faceId = faceIdByName(mesh, sketch.plane.name);
    return faceId === null ? [] : faceBoundsInFrame(mesh, faceId, frame);
  }, [meshes, sketch, frame]);
  const { run: runConstraintAction } = useApplyConstraintAction(sketch);
  const drivenSketches = useFormulaStore((state) => state.resolution?.drivenSketches);
  const drag = useRef<DragState | null>(null);
  const marquee = useRef<MarqueeState | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<MarqueeBox | null>(null);

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
  // The whole resolution of the hovered step, so the preview can promise
  // exactly the alignment the commit will create.
  const [hoverInput, setHoverInput] = useState<SketchSnapInput | null>(null);
  const setHoverPreview = (snap: SketchSnap | null, input: SketchSnapInput | null = null) => {
    setHoverSnap(snap);
    setHoverInput(input);
  };
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
  // The curve a stretch took hold of, and the end of it: the first click picks
  // the curve, the second ends the stretch. The ref carries the same choice into
  // the pointer handlers, which are set up outside the render.
  const [extendGrip, setExtendGrip] = useState<ExtendGrip | null>(null);
  const extendGripRef = useRef<ExtendGrip | null>(null);
  const chooseExtendGrip = (grip: ExtendGrip | null) => {
    extendGripRef.current = grip;
    setExtendGrip(grip);
  };
  const skipClick = useRef(false);
  /**
   * The object a finger pressed, kept until it lifts. Its tap is applied on the
   * release, so a press that travels is a drag of the set and not a toggle that
   * takes the object out of it.
   */
  const pendingTap = useRef<{ key: string; pointerId: number } | null>(null);
  /**
   * Where a finger came down with the scissors in hand, and the last place the
   * preview stood. A finger has no hover to read before it lands, so the cut it
   * means is the one its drag has been showing, and the release is what commits
   * it — the browser sends no click after a finger that travelled.
   */
  const trimPress = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const trimAim = useRef<Point2 | null>(null);
  const highlightKey = useRef('');
  const commitQueue = useRef<Promise<void>>(Promise.resolve());
  // Last line of a polyline, so the next segment can be joined to it.
  const polylineTail = useRef<string | null>(null);
  // The tool that produced the current draft. A tool switch must not reuse it.
  const draftToolRef = useRef<SketchTool>(tool);
  // Round corners are the default of the offset and contour tools; Shift turns
  // them into sharp ones while the distance is being set.
  const [offsetJoin, setOffsetJoin] = useState<OffsetJoin>('round');
  const offsetJoinRef = useRef<OffsetJoin>('round');
  // A polygon takes its radius to the corners; Shift says the same distance is
  // the one its edges stand at instead. The key is read while the radius is
  // being set, and the click that sets it keeps the answer: letting go of Shift
  // afterwards must not turn the figure inside out.
  const [polygonInternal, setPolygonInternal] = useState(false);
  const polygonInternalRef = useRef(false);
  const polygonGripInternal = useRef(false);
  // The tools that change what is already drawn ignore construction curves
  // unless Shift asks for them: a helper drawn across a part must not be what
  // the scissors or the split take.
  const [pointerConstruction, setPointerConstruction] = useState(false);
  const pointerConstructionRef = useRef(false);
  // The tools that read the selection and take their number from the pointer:
  // the two offsets, the corner radius of a fillet, the piece a trim cuts and
  // the point a split adds — and the stretch, which reads only the pointer.
  const pointerTool =
    tool === 'offset' ||
    tool === 'outline' ||
    tool === 'fillet' ||
    tool === 'trim' ||
    tool === 'split' ||
    tool === 'extend';
  const offsetTool = tool === 'offset' || tool === 'outline';

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
    setHoverPreview(null);
    polylineTail.current = null;
    // A stretch belongs to the tool that began it.
    extendGripRef.current = null;
    setExtendGrip(null);
    polygonInternalRef.current = false;
    polygonGripInternal.current = false;
    setPolygonInternal(false);
    draftToolRef.current = tool;
    offsetJoinRef.current = 'round';
    setOffsetJoin('round');
    pointerConstructionRef.current = false;
    setPointerConstruction(false);
    applyAutoHighlight([]);
    setSketchHover([]);
  }, [activeSketchId, tool, sketchToolNonce]);

  // The scissors, the split and the stretch work on the geometry the part is
  // made of. Shift says the construction curves are part of it too, and the
  // preview answers at once.
  useEffect(() => {
    if (tool !== 'trim' && tool !== 'split' && tool !== 'extend') return;
    const update = (event: KeyboardEvent) => {
      if (pointerConstructionRef.current === event.shiftKey) return;
      pointerConstructionRef.current = event.shiftKey;
      setPointerConstruction(event.shiftKey);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
    };
  }, [tool]);

  // A cut, a split or a stretch is a direct act on what is under the pointer, so
  // a selection left over from before would only be a promise it does not keep.
  useEffect(() => {
    if (tool === 'trim' || tool === 'split' || tool === 'extend') setSketchSelection([]);
  }, [tool]);

  // Shift says the distance a polygon is drawn to is the one its edges stand at
  // rather than the one its corners reach, and the preview follows at once.
  useEffect(() => {
    if (tool !== 'polygon') return;
    const update = (event: KeyboardEvent) => {
      if (polygonInternalRef.current === event.shiftKey) return;
      polygonInternalRef.current = event.shiftKey;
      setPolygonInternal(event.shiftKey);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
    };
  }, [tool]);

  // Shift switches the corners of the offset and contour tools between round
  // and sharp while the distance is being set, and the preview follows at once.
  useEffect(() => {
    if (!offsetTool) return;
    const update = (event: KeyboardEvent) => {
      const join: OffsetJoin = event.shiftKey ? 'miter' : 'round';
      if (offsetJoinRef.current === join) return;
      offsetJoinRef.current = join;
      setOffsetJoin(join);
    };
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
    };
  }, [offsetTool]);

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
    const model = activeModel(useDocumentStore.getState().project);
    const sketchSource = sketchProjectionSources(
      model.features.filter((feature): feature is SketchFeature => feature.type === 'sketch'),
      (feature) => sketchFrameOf(resolvedFeatureFor(feature) ?? feature, sketchFrames[feature.id]),
    );
    const resolved = resolveSketchProjections(
      sketch,
      frame,
      (bodyId) => meshes[bodyId],
      sketchSource,
    );
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
    activeModel(liveProject()).features.find(
      (feature): feature is SketchFeature => feature.id === sketch?.id && feature.type === 'sketch',
    );

  /**
   * Commits what the pointer currently describes — an offset, a contour or a
   * rounded corner. The whole result, geometry and its dimensions, lands as one
   * edit, and the fresh geometry takes over the selection so the next step
   * starts from it.
   */
  const offsetCommitPending = useRef(false);
  // The preview stands where the committed geometry will be, so it has to go the
  // moment the click lands: a ghost that outlives the click reads as a tool that
  // is still working on something.
  const [offsetCommitting, setOffsetCommitting] = useState(false);
  const commitPointerToolAt = (point: Point2) => {
    const activeTool = useUiStore.getState().sketchTool;
    const isFillet = activeTool === 'fillet';
    const isTrim = activeTool === 'trim';
    const isSplit = activeTool === 'split';
    // A cut or a split leaves the tool where it is: the next piece is one click
    // away.
    const staysOn = isTrim || isSplit;
    if (
      activeTool !== 'offset' &&
      activeTool !== 'outline' &&
      !isFillet &&
      !isTrim &&
      !isSplit
    ) {
      return;
    }
    if (offsetCommitPending.current) return;
    const current = currentSketch();
    if (!current) return;
    offsetCommitPending.current = true;
    setOffsetCommitting(true);
    const settling = isFillet
      ? commitFillet(current, selectionIds, point).then((result) =>
          result.ok
            ? {
                ok: true as const,
                feature: result.commit.feature,
                selection: result.commit.arcIds,
              }
            : { ok: false as const, message: filletErrorKey(result.error) },
        )
      : isTrim
        ? commitTrim(current, point, {
            construction: pointerConstructionRef.current,
            tolerance: trimReach(),
          }).then((result) =>
            result.ok
              ? {
                  ok: true as const,
                  feature: result.commit.feature,
                  selection: null,
                }
              : { ok: false as const, message: trimErrorKey(result.error) },
          )
        : isSplit
          ? commitSplit(current, point, { construction: pointerConstructionRef.current }).then(
              (result) =>
                result.ok
                  ? {
                      ok: true as const,
                      feature: result.commit.feature,
                      selection: null,
                    }
                  : { ok: false as const, message: splitErrorKey(result.error) },
            )
        : commitOffsetSolved(current, selectionIds, point, {
            tool: activeTool,
            join: offsetJoinRef.current,
          }).then((result) =>
            result.ok
              ? {
                  ok: true as const,
                  feature: result.commit.feature,
                  selection: result.commit.createdIds,
                }
              : { ok: false as const, message: offsetErrorKey(result.error) },
          );
    void settling
      .then((result) => {
        if (!result.ok) {
          useUiStore.getState().showToast(result.message, 'error');
          return;
        }
        apply({ type: 'feature/replace', feature: result.feature });
        if (result.selection) setSketchSelection(result.selection);
        void diagnoseSketch(result.feature);
        if (!staysOn) setSketchTool('select');
      })
      .catch(() =>
        useUiStore
          .getState()
          .showToast(
            isFillet
              ? 'sketch.filletFailed'
              : isTrim
                ? 'sketch.trimFailed'
                : isSplit
                  ? 'sketch.splitFailed'
                  : 'sketch.offsetFailed',
            'error',
          ),
      )
      .finally(() => {
        offsetCommitPending.current = false;
        setOffsetCommitting(false);
      });
  };

  /**
   * Commits a stretch: the curve the first click took hold of, grown to where
   * the second click stands. `ended` runs when the stretch is over, so the tool
   * goes back to asking for a curve; a stretch that could not be made keeps the
   * curve it took, and the next click is another try.
   */
  const extendCommitPending = useRef(false);
  const commitExtendAt = (
    aim: { point: Point2; snapTo: string | null },
    grip: ExtendGrip,
    ended: () => void,
  ) => {
    const current = currentSketch();
    if (!current || extendCommitPending.current) return;
    extendCommitPending.current = true;
    void commitExtend(current, aim.point, {
      construction: pointerConstructionRef.current,
      grip,
      snapTo: aim.snapTo ?? undefined,
    })
      .then((result) => {
        if (!result.ok) {
          useUiStore.getState().showToast(extendErrorKey(result.error), 'error');
          return;
        }
        apply({ type: 'feature/replace', feature: result.commit.feature });
        void diagnoseSketch(result.commit.feature);
        ended();
      })
      .catch(() => useUiStore.getState().showToast('sketch.extendFailed', 'error'))
      .finally(() => {
        extendCommitPending.current = false;
      });
  };

  const applyAutoConstraintsNow = async (
    entity: SketchEntity,
    inputs: SketchSnapInput[],
    extra: SketchConstraint[] = [],
    fallback: SketchEntity = entity,
  ) => {
    if (!sketch || sketchHasFormulaError(sketch.id)) {
      applyAutoHighlight([]);
      return;
    }
    const auto = magnetEnabled
      ? autoConstraintsForEntity(entity, inputs)
      : { constraints: [], snapConstraints: [], alignmentConstraints: [], highlightIds: [] };
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
    if (auto.alignmentConstraints.length > 0) {
      // The step promised an alignment. The snap may be the part that cannot be
      // kept, but dropping the alignment silently would leave a line that only
      // looked straight while it was drawn.
      const aligned = uniqueConstraints(
        [...auto.alignmentConstraints, ...extra],
        currentFeature.constraints,
        entitiesMap,
      );
      if (aligned.length !== base.length) attempts.push(aligned);
    } else if (auto.snapConstraints.length > 0) {
      const snapOnly = uniqueConstraints(
        [...auto.snapConstraints, ...extra],
        currentFeature.constraints,
        entitiesMap,
      );
      if (snapOnly.length !== base.length) attempts.push(snapOnly);
    }
    if (attempts.every((candidate) => candidate.length === 0)) {
      applyAutoHighlight([]);
      return;
    }
    for (const constraints of attempts) {
      if (constraints.length === 0) continue;
      const latest = currentSketch();
      if (!latest) return;
      const applied = await applyAutoConstraints({
        entities: latest.entities,
        constraints: constraintsForSolve(latest),
        added: constraints,
        derived: [...projectionEntityIds(latest)],
      }).catch(() => null);
      if (!applied || applied.conflicting.length > 0) continue;
      if (!applied.entities.some((candidate) => candidate.id === entity.id)) continue;
      const current = currentSketch();
      if (!current) return;
      // The solver may also move existing geometry to satisfy the new
      // constraint, so the whole solution has to be merged back.
      const solvedById = new Map(applied.entities.map((candidate) => [candidate.id, candidate]));
      const currentEntities = current.entities.map(
        (candidate) => solvedById.get(candidate.id) ?? candidate,
      );
      for (const candidate of applied.entities) {
        if (!currentEntities.some((existing) => existing.id === candidate.id)) {
          currentEntities.push(candidate);
        }
      }
      const redundant = new Set(applied.removed);
      preview({
        type: 'feature/replace',
        feature: {
          ...current,
          entities: currentEntities,
          constraints: [
            ...current.constraints.filter((constraint) => !redundant.has(constraint.id)),
            ...applied.added.filter(
              (constraint) =>
                !current.constraints.some((existing) => existing.id === constraint.id),
            ),
          ],
        },
      });
      setSketchFrozen(applied.frozenEntityIds);
      setSketchProblems([...new Set(applied.conflicting)]);
      applyAutoHighlight(auto.highlightIds);
      return;
    }
    // No attempt could keep the magnet target attached. Leave the geometry
    // where the pointer was instead of at a point it is not constrained to.
    mergeEntity(fallback);
    applyAutoHighlight([]);
    if (inputs.some((input) => input.snap)) {
      useUiStore.getState().showToast('constraint.snapFailed', 'error');
    }
  };

  const commitNewEntity = (
    entity: SketchEntity,
    inputs: SketchSnapInput[],
    extra: SketchConstraint[] = [],
  ): Promise<SketchFeature | undefined> => {
    const before = useDocumentStore.getState().project;
    mergeEntity(entity);
    const fallback = unsnappedEntity(entity, inputs);
    const committed = commitQueue.current
      .then(() => applyAutoConstraintsNow(entity, inputs, extra, fallback))
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
    setHoverPreview(null);
  };

  // Ends a polyline but keeps the line tool active for the next chain.
  const finishLine = () => {
    updateDraft([]);
    setHoverPreview(null);
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
      setHoverPreview(null);
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
              auto: true,
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
      setHoverPreview(null);
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
        setHoverPreview(null);
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
        setHoverPreview(null);
      }
      return;
    }
    if (activeTool === 'polygon') {
      if (currentDraft.length < 2) {
        // The click that names the radius settles what the radius means, and the
        // rest of the figure is drawn to it.
        if (currentDraft.length === 1) polygonGripInternal.current = polygonInternalRef.current;
        updateDraft([...currentDraft, { point, input }]);
        return;
      }
      // The figure is a set of lines and a circle, not one entity, and every
      // one of them is exact: it lands as a single edit rather than through the
      // one-at-a-time path a drawn segment takes.
      const geometry = polygonGeometry({
        centre: currentDraft[0]!.point,
        corner: currentDraft[1]!.point,
        cursor: point,
        internal: polygonGripInternal.current,
        inputs: [currentDraft[0]!.input, currentDraft[1]!.input],
      });
      updateDraft([]);
      setHoverPreview(null);
      const latest = currentSketch();
      if (!geometry || !latest) return;
      const next: SketchFeature = {
        ...latest,
        entities: [...latest.entities, ...geometry.entities],
        constraints: [...latest.constraints, ...geometry.constraints],
      };
      apply({ type: 'feature/replace', feature: next });
      void diagnoseSketch(next);
      return;
    }
    if (activeTool === 'elliptical-arc') {
      if (currentDraft.length < 4) {
        const next = [...currentDraft, { point, input }];
        if (next.length === 4) draftArcEnd.current = null;
        updateDraft(next);
        return;
      }
      const frame = ellipticalArcFrame(
        currentDraft[0]!.point,
        currentDraft[1]!.point,
        currentDraft[2]!.point,
        currentDraft[3]!.point,
      );
      if (frame) {
        const entity: SketchEntity = {
          id: createId('entity'),
          type: 'elliptical-arc',
          construction: false,
          cx: frame.cx,
          cy: frame.cy,
          rx: frame.rx,
          ry: frame.ry,
          rotation: (frame.rotation * 180) / Math.PI,
          startAngle: frame.startAngle,
          endAngle: ellipticalArcEndAngle(frame, point, draftArcEnd.current),
        };
        void commitNewEntity(entity, [
          currentDraft[0]!.input,
          currentDraft[1]!.input,
          currentDraft[2]!.input,
          currentDraft[3]!.input,
          input,
        ]);
      }
      updateDraft([]);
      setHoverPreview(null);
      return;
    }
    if (activeTool === 'ellipse') {
      if (currentDraft.length < 2) {
        updateDraft([...currentDraft, { point, input }]);
        return;
      }
      const frame = ellipseFrame(currentDraft[0]!.point, currentDraft[1]!.point, point);
      if (frame) {
        const entity: SketchEntity = {
          id: createId('entity'),
          type: 'ellipse',
          construction: false,
          cx: frame.cx,
          cy: frame.cy,
          rx: frame.rx,
          ry: frame.ry,
          rotation: (frame.rotation * 180) / Math.PI,
        };
        void commitNewEntity(entity, [currentDraft[0]!.input, currentDraft[1]!.input, input]);
      }
      updateDraft([]);
      setHoverPreview(null);
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
    canvas.style.cursor =
      tool === 'select' || tool === 'extend'
        ? hovering
          ? 'pointer'
          : 'default'
        : 'crosshair';

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

    /**
     * The box the pointer has swept: left to right takes only what fits in it,
     * right to left everything it touches.
     */
    const updateMarquee = (state: MarqueeState) => {
      const from = getViewport()?.sketchPointAt(state.startX, state.startY);
      const to = getViewport()?.sketchPointAt(state.currentX, state.currentY);
      if (!from || !to) return;
      const rect = marqueeRect(from, to);
      const mode = marqueeMode(state.startX, state.currentX);
      const hits = entitiesInMarquee(currentSketchEntities(activeSketchId), rect, mode);
      setSketchSelection(state.additive ? [...new Set([...state.base, ...hits])] : hits);
      const box = canvas.getBoundingClientRect();
      setMarqueeBox({
        left: Math.min(state.startX, state.currentX) - box.left,
        top: Math.min(state.startY, state.currentY) - box.top,
        width: Math.abs(state.currentX - state.startX),
        height: Math.abs(state.currentY - state.startY),
        crossing: mode === 'crossing',
      });
    };
    /**
     * The curve the pointer stands on, and the end of it the pointer is
     * nearest. Hovering says what a click would take hold of; nothing under the
     * pointer means nothing to stretch.
     */
    const extendGripAt = (event: PointerAt): ExtendGrip | null => {
      if (!sketch) return null;
      const entities = currentSketchEntities(activeSketchId);
      const targets = extendTargets(sketch, { construction: pointerConstructionRef.current });
      if (targets.length === 0) return null;
      const byId = new Map(targets.map((entity) => [entity.id, entity]));
      // The pointer takes what it stands on; failing that, the curve it came
      // close to. The axes and the origin are not curves to stretch, so a line
      // drawn over one of them is still the line under the pointer.
      const pick = getViewport()?.pickSketch(event.clientX, event.clientY, entities);
      const snap = getViewport()?.snapSketch(event.clientX, event.clientY, 16, entities);
      const grabbed =
        (pick?.entityId ? byId.get(pick.entityId) : undefined) ??
        (snap?.curveSnap ? byId.get(snap.curveSnap.entityId) : undefined);
      if (!grabbed) return null;
      const ends = entityEndpoints(grabbed);
      if (!ends || !curveEndIndices(grabbed)) return null;
      const near = pick?.point ?? snap?.point;
      if (!near) return null;
      const end =
        Math.hypot(near[0] - ends[0][0], near[1] - ends[0][1]) <=
        Math.hypot(near[0] - ends[1][0], near[1] - ends[1][1])
          ? ('start' as const)
          : ('end' as const);
      return { entityId: grabbed.id, end };
    };
    /**
     * Where the new end goes: the pointer, taken to the magnet's target when
     * there is one. The end of a curve is a point of the sketch like any other,
     * so it snaps — but not to the curve being stretched, whose own foot would
     * pull the pointer back onto it. The curve the magnet names is handed on, so
     * the end can meet it exactly instead of nearly.
     */
    const extendAimAt = (
      event: PointerAt,
      grip: ExtendGrip | null,
    ): { point: Point2; snapTo: string | null } | null => {
      const snap = getViewport()?.snapSketch(
        event.clientX,
        event.clientY,
        magnetEnabled ? 12 : 0,
        currentSketchEntities(activeSketchId),
      );
      if (!snap) return null;
      const away = <T extends { entityId: string }>(candidate: T | null) =>
        candidate && candidate.entityId !== grip?.entityId ? candidate : null;
      const pointSnap = away(snap.pointSnap);
      const curveSnap = away(snap.curveSnap);
      const midpointSnap = away(snap.midpointSnap);
      const target = pointSnap ?? curveSnap ?? midpointSnap;
      const aim = target?.point ?? snap.point;
      return {
        point: [aim[0], aim[1]],
        snapTo: curveSnap && target === curveSnap ? curveSnap.entityId : null,
      };
    };
    const onPointerDown = (event: PointerEvent) => {
      // A second finger takes the gesture for the camera; the box it interrupts
      // must not keep growing under a pinch, and the set that box had already
      // built goes back to what it was before the pinch began.
      if (!event.isPrimary) {
        const interrupted = marquee.current;
        marquee.current = null;
        setMarqueeBox(null);
        pendingTap.current = null;
        if (interrupted?.active) setSketchSelection(interrupted.base);
        // A pinch is a camera gesture: the geometry a first finger had begun to
        // drag goes back where it was instead of following that finger, and a
        // cut that finger had lined up is not made when it lifts.
        trimPress.current = null;
        trimAim.current = null;
        const interruptedDrag = drag.current;
        drag.current = null;
        if (interruptedDrag?.active) {
          useLiveEditStore.getState().finish(false);
        }
        if (interrupted?.active) {
          // The gesture became a pinch, so the tap the browser sends when the
          // fingers lift belongs to the camera, not to the canvas.
          skipClick.current = true;
        }
        // Only the first finger of a gesture can start a box or a drag: the
        // second one is the camera's.
        return;
      }
      if (event.button !== 0) return;
      skipClick.current = false;
      marquee.current = null;
      pointerDown.current = { x: event.clientX, y: event.clientY };
      const activeTool = useUiStore.getState().sketchTool;
      // The offset, contour, fillet and trim tools read the selection and the
      // pointer distance; a press starts neither a draft nor a selection box.
      // A stretch is chosen and ended by clicks, so it has nothing to start
      // either.
      if (
        activeTool === 'offset' ||
        activeTool === 'outline' ||
        activeTool === 'fillet' ||
        activeTool === 'trim' ||
        activeTool === 'split' ||
        activeTool === 'extend'
      ) {
        // A finger has no hover to read before it lands, so with the scissors in
        // hand the press only remembers where it began: the drag that follows
        // shows the cut, and the release makes it.
        if (activeTool === 'trim' && isKeylessPointer(event.pointerType)) {
          trimPress.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
          trimAim.current = null;
        }
        return;
      }
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
      if (!pick?.entityId) {
        marquee.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          currentX: event.clientX,
          currentY: event.clientY,
          base: selectionIds,
          additive: isAdditiveClick(event),
          active: false,
        };
        return;
      }
      const entity = sketchEntityIndex(sketch.entities).get(pick.entityId);
      if (!entity) return;
      // Fundamental geometry is fixed: it can be selected but not dragged.
      if (isFundamentalEntityId(entity.id)) return;
      setSketchHover([]);
      const pointIndex = pick.pointIndex ?? (entity.type === 'point' ? 0 : null);
      const key = pointIndex === null ? entity.id : `${entity.id}#${pointIndex}`;
      // Pressing one object of a set keeps the set: the drag moves all of it.
      const keyless = isKeylessPointer(event.pointerType);
      const inSelection = selectionIds.includes(key);
      const preservesSelection = (keyless || !additive) && selectionIds.length > 1 && inSelection;
      if (keyless) {
        // A finger or a pen has no key to hold and no hover to read, so its tap
        // is the additive one: it toggles the object it lands on. That tap is
        // taken when the pointer lifts, not when it lands — otherwise pressing
        // one member of a set to drag it would take that member out of the set
        // first and the rest would stay behind.
        skipClick.current = true;
        pendingTap.current = { key, pointerId: event.pointerId };
      } else if (!additive && !preservesSelection) {
        setSketchSelection([key]);
      }
      // Projected geometry is derived: it can be selected and detached, but the
      // next rebuild would overwrite whatever a drag does to it.
      if (isProjectedEntity(sketch, entity.id)) return;
      // Geometry without degrees of freedom has nowhere to go; solving it would
      // only let an unrelated free branch of the sketch wander.
      const frozenIds = useUiStore.getState().sketchFrozenEntityIds;
      if (frozenIds.includes(entity.id)) return;
      // A sketch with a formula error keeps its last solved geometry until the
      // formula is fixed; no solver may move it meanwhile.
      if (sketchHasFormulaError(sketch.id)) return;
      // A frozen member of the selection keeps its place: it has no degree of
      // freedom to spend, and translating it would only last until the next
      // solve.
      const selectedEntityIds = preservesSelection
        ? movableEntities(
            selectionIds.filter((candidate) => !isFundamentalEntityId(candidate.split('#')[0]!)),
            frozenIds,
          )
        : [];
      drag.current = {
        mode: pointIndex === null ? 'entity' : 'point',
        entityId: entity.id,
        movedIds:
          pointIndex === null && preservesSelection
            ? [...new Set([entity.id, ...selectedEntityIds])]
            : [entity.id],
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
      // A drag writes to the live copy: the document is touched once, when the
      // pointer lets go, instead of once per frame for the whole interface.
      useLiveEditStore.getState().begin('sketch', sketch.id);
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
          const current = activeModel(liveProject()).features.find(
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
            movedEntityIds:
              activeDrag.mode === 'point' ? [activeDrag.entityId] : activeDrag.movedIds,
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
          const latest = activeModel(liveProject()).features.find(
            (feature): feature is SketchFeature =>
              feature.id === activeDrag.original.id && feature.type === 'sketch',
          );
          if (!latest) return;
          useLiveEditStore.getState().preview({
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
      // The stretch is chosen and ended by clicks, so the pointer is free to
      // say what it would take hold of and where the end would go. The geometry
      // it would take is painted the accent the editor already uses for "this
      // is what the tool means", and no point is drawn under the pointer until
      // a curve is chosen: nothing is being placed yet.
      if (activeTool === 'extend') {
        const grip = extendGripRef.current;
        const candidate = grip ?? extendGripAt(event);
        applyAutoHighlight(candidate ? [candidate.entityId] : []);
        canvas.style.cursor = candidate ? 'pointer' : 'default';
        const aim = extendAimAt(event, grip);
        if (aim) setHover(aim.point);
        return;
      }
      if (
        activeTool === 'offset' ||
        activeTool === 'outline' ||
        activeTool === 'fillet' ||
        activeTool === 'trim' ||
        activeTool === 'split'
      ) {
        // These tools measure from the raw pointer — the distance to the chain,
        // the radius around a corner — so the magnet must not pull the number
        // towards the geometry.
        const point = getViewport()?.sketchPointAt(event.clientX, event.clientY);
        if (point) setHover(point);
        // The scissors remember the last place their preview stood, so a finger
        // that lifts cuts what it was shown, not where it stopped being read.
        if (activeTool === 'trim') trimAim.current = point ?? null;
        setSketchHover([]);
        return;
      }
      if (activeTool === 'select') {
        const activeMarquee = marquee.current;
        if (activeMarquee) {
          if (activeMarquee.pointerId !== event.pointerId) return;
          const slop = isKeylessPointer(event.pointerType) ? TAP_SLOP_PX : 3;
          if (
            !activeMarquee.active &&
            Math.hypot(
              event.clientX - activeMarquee.startX,
              event.clientY - activeMarquee.startY,
            ) <= slop
          ) {
            return;
          }
          if (!activeMarquee.active) {
            activeMarquee.active = true;
            canvas.setPointerCapture(event.pointerId);
            setSketchHover([]);
          }
          activeMarquee.currentX = event.clientX;
          activeMarquee.currentY = event.clientY;
          updateMarquee(activeMarquee);
          return;
        }
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
          const pending = pendingTap.current;
          pendingTap.current = null;
          // A finger that travels is moving, not tapping: an object it pressed
          // outside the set becomes the set, and a member it pressed keeps the
          // set it belongs to, which is what the drag carries.
          if (pending && !selectionIds.includes(pending.key)) setSketchSelection([pending.key]);
        }
        const pick = getViewport()?.pickSketch(event.clientX, event.clientY);
        if (!pick) return;
        const current = activeModel(liveProject()).features.find(
          (feature): feature is SketchFeature =>
            feature.id === activeDrag.original.id && feature.type === 'sketch',
        );
        if (!current) return;
        const point: Point2 = [pick.point[0], pick.point[1]];
        activeDrag.target = point;
        // Nothing depends on a free entity, so it can follow the pointer right
        // away instead of waiting for a round trip.
        if (
          !isSelectionConstrained(
            current.constraints,
            activeDrag.mode === 'point' ? [activeDrag.entityId] : activeDrag.movedIds,
          )
        ) {
          useLiveEditStore.getState().preview({
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
        setHoverPreview(null);
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
      if (activeTool === 'elliptical-arc' && draft.length >= 4) {
        const frame = ellipticalArcFrame(
          draft[0]!.point,
          draft[1]!.point,
          draft[2]!.point,
          draft[3]!.point,
        );
        if (frame) {
          draftArcEnd.current = ellipticalArcEndAngle(frame, resolved.point, draftArcEnd.current);
        }
      }
      setHover(resolved.point);
      setHoverPreview(resolved.input.snap, resolved.input);
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
      setHoverPreview(null);
    };
    const finishDrag = () => {
      const pending = pendingTap.current;
      pendingTap.current = null;
      const activeDrag = drag.current;
      drag.current = null;
      if (!activeDrag?.active) {
        // The pointer never travelled: a finger's tap, which toggles the object
        // it landed on, exactly as a click with a modifier does.
        if (pending) {
          const current = useUiStore.getState().sketchSelectionIds;
          setSketchSelection(
            current.includes(pending.key)
              ? current.filter((candidate) => candidate !== pending.key)
              : [...current, pending.key],
          );
        }
        return;
      }
      const latest = activeModel(liveProject()).features.find(
        (feature): feature is SketchFeature =>
          feature.id === activeDrag.original.id && feature.type === 'sketch',
      );
      if (!latest) {
        useLiveEditStore.getState().finish(false);
        return;
      }
      if (sketchHasFormulaError(latest.id)) {
        useLiveEditStore.getState().finish(false);
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
        movedEntityIds: activeDrag.mode === 'point' ? [activeDrag.entityId] : activeDrag.movedIds,
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
              useLiveEditStore.getState().finish(true);
              return;
            }
            useLiveEditStore.getState().finish(false);
            useUiStore.getState().showToast('constraint.conflict', 'error');
            return;
          }
          useLiveEditStore.getState().preview({
            type: 'feature/replace',
            feature: { ...activeDrag.original, entities: result.entities },
          });
          setSketchFrozen(result.frozenEntityIds);
          setSketchProblems([...new Set([...result.conflicting, ...result.redundant])]);
          useLiveEditStore.getState().finish(true);
        })
        .catch(() => {
          useLiveEditStore.getState().finish(false);
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
      // The first click takes hold of a curve, the second one ends the stretch:
      // the pointer says which curve and how far, and neither needs a press.
      if (activeTool === 'extend') {
        const grip = extendGripRef.current;
        if (!grip) {
          const candidate = extendGripAt(event);
          if (candidate) chooseExtendGrip(candidate);
          return;
        }
        const aim = extendAimAt(event, grip);
        if (aim) commitExtendAt(aim, grip, () => chooseExtendGrip(null));
        return;
      }
      if (
        activeTool === 'offset' ||
        activeTool === 'outline' ||
        activeTool === 'fillet' ||
        activeTool === 'trim' ||
        activeTool === 'split'
      ) {
        const point = getViewport()?.sketchPointAt(event.clientX, event.clientY);
        if (point) commitPointerToolAt(point);
        return;
      }
      if (activeTool === 'select') {
        const pick = getViewport()?.pickSketch(
          event.clientX,
          event.clientY,
          currentSketchEntities(activeSketchId),
        );
        if (!pick?.entityId) {
          // With the multi-select key held an empty click adds nothing and
          // takes nothing away: it must not drop the set being built. A finger
          // has no key to hold and keeps its own empty-tap rule below.
          if (event.shiftKey || event.metaKey || event.ctrlKey) return;
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
          // a row to toggle than empty space is: a multi-select click leaves the
          // set alone there too.
          if (!(event.shiftKey || event.metaKey || event.ctrlKey)) setSketchSelection([]);
        } else if (!additive) {
          // A click on one object of a set leaves the set alone, so the next
          // drag still moves all of it. A click on another object takes over.
          if (!(selectionIds.length > 1 && selectionIds.includes(key))) {
            setSketchSelection([key]);
          }
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
      const leaving = useUiStore.getState().sketchTool;
      if (leaving === 'select' || leaving === 'extend') canvas.style.cursor = 'default';
    };

    // A gesture the browser takes away, such as a call from outside the page,
    // leaves nothing behind: the stretch is dropped, not committed at its last
    // known place.
    const onPointerCancel = () => {
      // A gesture the browser takes away leaves nothing behind: the live copy of
      // the sketch is dropped, never written into the document.
      useLiveEditStore.getState().finish(false);
      drag.current = null;
      createPress.current = null;
      marquee.current = null;
      pendingTap.current = null;
      trimPress.current = null;
      trimAim.current = null;
      setMarqueeBox(null);
    };
    /**
     * A finger that dragged the scissors cuts on the release: the browser sends
     * no click after a pointer that travelled, and the piece it means is the one
     * the preview has been showing. A press that stayed put is a tap, and the
     * click that follows still makes that cut.
     */
    const finishTrim = (event: PointerEvent) => {
      const press = trimPress.current;
      trimPress.current = null;
      if (!press || press.pointerId !== event.pointerId) return;
      const aim = trimAim.current;
      trimAim.current = null;
      if (useUiStore.getState().sketchTool !== 'trim') return;
      const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (!aim || travelled <= TAP_SLOP_PX) return;
      // The cut is made here, so the click that may still arrive is its echo.
      skipClick.current = true;
      commitPointerToolAt(aim);
    };
    const finishMarquee = () => {
      const active = marquee.current;
      marquee.current = null;
      setMarqueeBox(null);
      if (!active?.active) return;
      // The tap the browser sends after the sweep must not clear the set.
      skipClick.current = true;
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
    window.addEventListener('pointerup', finishMarquee);
    window.addEventListener('pointerup', finishTrim);
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
      window.removeEventListener('pointerup', finishMarquee);
      window.removeEventListener('pointerup', finishTrim);
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
      const center = draft[0].point;
      const frame = ellipseFrame(center, draft[1]?.point ?? hover, hover);
      if (frame) {
        return {
          id: 'preview',
          type: 'ellipse',
          construction: false,
          cx: frame.cx,
          cy: frame.cy,
          rx: frame.rx,
          ry: frame.ry,
          rotation: (frame.rotation * 180) / Math.PI,
        };
      }
      // The first radius is the pointer distance; the second one has no other
      // source yet, so a half of it shows the ellipse the click is starting.
      const rx = Math.max(distance(center, hover), 0.01);
      return {
        id: 'preview',
        type: 'ellipse',
        construction: false,
        cx: center[0],
        cy: center[1],
        rx,
        ry: rx * 0.5,
        rotation: (Math.atan2(hover[1] - center[1], hover[0] - center[0]) * 180) / Math.PI,
      };
    }
    // Until both ends are named there is no arc yet: the ellipse it will be cut
    // from is the dotted guide, and only the arc itself is drawn solid.
    if (tool === 'elliptical-arc' && draft.length >= 4) {
      const frame = ellipticalArcFrame(
        draft[0]!.point,
        draft[1]!.point,
        draft[2]!.point,
        draft[3]!.point,
      );
      if (frame) {
        return {
          id: 'preview',
          type: 'elliptical-arc',
          construction: false,
          cx: frame.cx,
          cy: frame.cy,
          rx: frame.rx,
          ry: frame.ry,
          rotation: (frame.rotation * 180) / Math.PI,
          startAngle: frame.startAngle,
          endAngle: ellipticalArcEndAngle(frame, hover, draftArcEnd.current),
        };
      }
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

  // The polygon's ghost: the figure the next click will leave behind, drawn
  // over the circle of the radius it is being drawn to. A polygon is not one
  // entity, so the overlay gets the lines and the circle comes along as a guide.
  const polygonPreview = useMemo(() => {
    if (tool !== 'polygon' || !hover) return null;
    const centre = draft[0]?.point;
    if (!centre) return null;
    const corner = draft[1]?.point;
    // Before the radius is named the figure is a guess — five corners, the way
    // an ellipse is drawn half as tall as it is long until its own second axis
    // is picked — and the pointer is the corner it is being drawn through.
    const geometry = polygonGeometry({
      centre,
      corner: corner ?? hover,
      cursor: hover,
      sides: corner ? undefined : POLYGON_DRAFT_SIDES,
      // Once the radius is clicked the mode is the one that click saved, so the
      // ghost cannot disagree with what the next click will build.
      internal: corner ? polygonGripInternal.current : polygonInternal,
    });
    if (!geometry) return null;
    // The dotted circle is the radius that was pointed at: the corners lie on it
    // when the figure stands inside it, and it sits inside the figure when Shift
    // made that distance the one the edges stand at.
    const radius = distance(centre, corner ?? hover);
    const guide: SketchEntity = {
      id: 'polygon-radius',
      type: 'circle',
      construction: true,
      cx: centre[0],
      cy: centre[1],
      r: radius,
    };
    return { entities: geometry.lines, guides: [guide], radius, sides: geometry.sides };
  }, [tool, draft, hover, polygonInternal]);

  // Purple means "a constraint will be created". Alignment counts only when the
  // resolution actually planned it, never because the pointer is merely near an
  // axis: a magnet target a few degrees off cannot keep both constraints. Such
  // a step keeps its purple target, but its line is not painted as aligned.
  const pointerPreview = useMemo(() => {
    type Preview = { entities: SketchEntity[]; replaced: string[]; points: Point2[] };
    const none: Preview = { entities: [], replaced: [], points: [] };
    if (!pointerTool || !sketch || !hover || offsetCommitting) return none;
    if (tool === 'fillet') {
      const plan = planFillet(sketch, selectionIds, hover);
      if (!plan.ok) return none;
      // The corner stands where the trimmed lines meet, so the ghost shows the
      // result only if the source lines stand aside while it is up.
      return {
        entities: filletPreviewEntities(plan.plan),
        replaced: plan.plan.lines.map((line) => line.id),
        points: [],
      };
    }
    if (tool === 'trim') {
      const plan = planTrim(sketch, hover, {
        construction: pointerConstruction,
        tolerance: trimReach(),
      });
      if (!plan.ok) return none;
      // The cut curve stands aside so the piece that goes is seen as a gap, and
      // the pieces that stay take its place before the click.
      return {
        entities: trimPreviewEntities(plan.plan),
        replaced: [plan.plan.cut.source.id],
        points: [],
      };
    }
    if (tool === 'split') {
      const plan = planSplit(sketch, hover, { construction: pointerConstruction });
      if (!plan.ok) return none;
      // The curve stands aside for its own two pieces, and the point it gains
      // is drawn where the click will put it.
      return {
        entities: splitPreviewEntities(plan.plan),
        replaced: [plan.plan.source.id],
        points: [plan.plan.at.point],
      };
    }
    if (tool === 'extend') {
      // Nothing is shown until a curve is chosen: what a stretch would do is
      // only known once the curve and its end are, and hovering says which
      // curve that would be by highlighting it.
      if (!extendGrip) return none;
      const plan = planExtend(sketch, hover, {
        construction: pointerConstruction,
        grip: extendGrip,
      });
      if (!plan.ok) return none;
      // The curve stands aside for its own stretched self, so the ghost is the
      // whole result and not a second curve on top of the first.
      return {
        entities: extendPreviewEntities(plan.plan),
        replaced: [plan.plan.source.id],
        points: [],
      };
    }
    return {
      entities: offsetPreviewEntities(
        planOffset(sketch, selectionIds, hover, {
          tool: tool as OffsetTool,
          join: offsetJoin,
        }),
      ),
      replaced: [],
      points: [],
    };
  }, [
    pointerTool,
    tool,
    sketch,
    hover,
    selectionIds,
    offsetJoin,
    offsetCommitting,
    pointerConstruction,
    extendGrip,
  ]);
  const previewShape = previewEntity();
  const previewAlignment = Boolean(hoverInput?.alignment);
  // A segment turns into the accent only when it is about to be ruled
  // horizontal or vertical: that is the promise the colour stands for. A snap
  // to another curve is shown by the magnet's own highlight and the cursor dot,
  // not by painting the whole segment as if a rule were being added.
  const previewAuto = magnetEnabled && previewAlignment;

  // A creating tool names its points one click at a time, and an arc or an
  // ellipse preview carries no marker of its own until the shape exists. The
  // point the next click would place is drawn under the pointer, in the magnet
  // colour when it comes from a snap, so both the point and the snap are seen
  // before the click.
  const markers = useMemo(
    () =>
      draftMarkers(
        tool,
        draft.map(({ point }) => point),
        hover,
      ),
    [tool, draft, hover],
  );
  const cursorMarker =
    hover &&
    markers.cursorAtPointer &&
    tool !== 'select' &&
    tool !== 'project' &&
    // The scissors cut what is already drawn and place nothing, so a point under
    // the pointer would promise a point that no click will make.
    tool !== 'trim' &&
    // A stretch places nothing until a curve is chosen; before that the pointer
    // only says what it would take, and a point under it would say otherwise.
    (tool !== 'extend' || extendGrip !== null)
      ? { point: hover, snapped: magnetEnabled && hasMagnetTarget(hoverInput ?? undefined) }
      : null;

  useEffect(() => {
    if (!activeSketchId) return;
    const midpointMarker =
      magnetEnabled && hoverSnap?.midpointSnap ? hoverSnap.midpointSnap.point : null;
    const previewGuides = draftGuides(tool, markers.markers, hover, () => createId('guide'));
    getViewport()?.setSketchOverlay(
      pointerTool ? pointerPreview.entities : (polygonPreview?.entities ?? previewEntity()),
      pointerTool ? [...markers.markers, ...pointerPreview.points] : markers.markers,
      previewAuto,
      midpointMarker,
      [...previewGuides, ...(polygonPreview?.guides ?? [])],
      cursorMarker,
      pointerTool ? pointerPreview.replaced : [],
    );
  }, [
    activeSketchId,
    tool,
    draft,
    hover,
    previewAuto,
    hoverSnap,
    magnetEnabled,
    hoverInput,
    markers,
    cursorMarker,
    pointerTool,
    pointerPreview,
    polygonPreview,
  ]);

  useEffect(() => {
    // The stretch paints its own highlight: the curve it would take hold of.
    if (tool === 'extend') return;
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
          setHoverPreview(null);
          setSketchSelection([]);
          polylineTail.current = null;
          return;
        }
        // A chosen curve is progress too: the first Escape lets it go, the next
        // one leaves the tool.
        if (extendGripRef.current) {
          chooseExtendGrip(null);
          setHover(null);
          setSketchHover([]);
          return;
        }
        // A selection is taken away first: the Select tool would otherwise leave
        // the sketch on the same press and throw the set away with it.
        if (activeTool !== 'select') {
          setSketchSelection([]);
          setSketchTool('select');
          return;
        }
        if (selectedConstraintIds.length > 0 || selectionIds.length > 0) {
          selectSketchConstraint(null);
          setSketchSelection([]);
          setHover(null);
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
      // The keyboard can commit the offset the pointer has already described.
      if (
        event.key === 'Enter' &&
        hover &&
        (activeTool === 'offset' ||
          activeTool === 'outline' ||
          activeTool === 'fillet' ||
          activeTool === 'trim' ||
          activeTool === 'split')
      ) {
        commitPointerToolAt(hover);
      }
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

  // A finger and a pen have no key to hold: a hint must not ask for one, and a
  // step they take is a drag or a tap rather than a click.
  const keylessInput =
    isKeylessPointer(lastPointerType()) || primaryInputProfile() === 'touch';

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
              : draft.length === 1
                ? t('sketch.majorEllipse')
                : t('sketch.minorEllipse')
            : tool === 'elliptical-arc'
              ? draft.length === 0
                ? t('sketch.centerEllipseArc')
                : draft.length === 1
                  ? t('sketch.majorEllipseArc')
                  : draft.length === 2
                    ? t('sketch.minorEllipseArc')
                    : draft.length === 3
                      ? t('sketch.startEllipseArc')
                      : t('sketch.endEllipseArc')
              : tool === 'bezier'
                ? draft.length > 0
                  ? t('sketch.finishBezier')
                  : t('sketch.addBezier')
                : tool === 'polygon'
                  ? t(polygonHint(draft.length, keylessInput))
                : tool === 'project'
                  ? t('sketch.projectionPickHint')
                  : tool === 'fillet'
                    ? t('sketch.filletHint')
                    : tool === 'trim'
                      ? t(keylessInput ? 'sketch.trimHintTouch' : 'sketch.trimHint')
                      : tool === 'split'
                        ? t('sketch.splitHint')
                        : tool === 'extend'
                          ? extendGrip
                            ? t('sketch.extendHintGrow')
                            : t('sketch.extendHint')
                          : tool === 'offset'
                            ? t('sketch.offsetHint')
                            : tool === 'outline'
                              ? t('sketch.outlineHint')
                              : '';

  const liveMeasure = (() => {
    if (tool === 'fillet') {
      if (!hover || !frame || !sketch) return null;
      const plan = planFillet(sketch, selectionIds, hover);
      if (!plan.ok) return null;
      // The pointer rides the arc, so the chip shows the radius it describes.
      const projected = getViewport()?.projectSketchPoint(frame, hover);
      return {
        text: formatMeasure('length', plan.plan.radius, locale, 'mm'),
        x: projected?.x ?? null,
        y: projected?.y ?? null,
      };
    }
    if (offsetTool) {
      if (!hover || !frame || !sketch) return null;
      const plan = planOffset(sketch, selectionIds, hover, {
        tool: tool as OffsetTool,
        join: offsetJoin,
      });
      if (!plan.ok) return null;
      // The pointer sets one distance for every chain of the selection, so the
      // chip reads it the same way the driving dimension will.
      const projected = getViewport()?.projectSketchPoint(frame, hover);
      const value = Math.abs(plan.loops[0]?.distance ?? 0);
      return {
        text: formatMeasure('length', value, locale, 'mm'),
        x: projected?.x ?? null,
        y: projected?.y ?? null,
      };
    }
    if (tool === 'polygon') {
      if (!polygonPreview || !frame || !hover) return null;
      const projected = getViewport()?.projectSketchPoint(frame, hover);
      // A step reads only the number it sets: the radius while the pointer names
      // it, and how many corners there are once the radius is fixed.
      return {
        text:
          draft.length < 2
            ? formatMeasure('length', polygonPreview.radius, locale, 'mm')
            : t('sketch.polygonCorners', { count: polygonPreview.sides }),
        x: projected?.x ?? null,
        y: projected?.y ?? null,
      };
    }
    if (!previewShape || !frame) return null;
    const infos = liveMeasures(previewShape)
      .map((measure) => measureInfo(previewShape, measure, locale, 'mm'))
      .filter((info): info is NonNullable<typeof info> => info !== null);
    if (infos.length === 0) return null;
    const anchor = liveAnchor(previewShape);
    const projected = anchor ? getViewport()?.projectSketchPoint(frame, anchor) : null;
    return {
      text: infos.map((info) => info.text).join(' · '),
      x: projected?.x ?? null,
      y: projected?.y ?? null,
    };
  })();

  return (
    <div className="sketch-overlay" data-sketch-hover={sketchHoverIds.join(' ') || undefined}>
      {marqueeBox && (
        <div
          className="sketch-marquee"
          data-mode={marqueeBox.crossing ? 'crossing' : 'window'}
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
        />
      )}
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
    case 'elliptical-arc': {
      const mid = (entity.startAngle + entity.endAngle) / 2;
      return ellipticalArcPoint(
        {
          cx: entity.cx,
          cy: entity.cy,
          rx: entity.rx,
          ry: entity.ry,
          rotation: (entity.rotation * Math.PI) / 180,
          startAngle: entity.startAngle,
        },
        mid,
      );
    }
    case 'bezier': {
      const last = entity.points[entity.points.length - 1];
      return last ?? null;
    }
    default:
      return null;
  }
}
