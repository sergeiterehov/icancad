import type { TessellationResult } from '@icancad/kernel';
import { House, Eye, Rotate3d, ScanBox, ScanSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { retryKernel } from '../kernel/client';
import {
  activeFeatureIds,
  activeModel,
  BODY_COLORS,
  bodiesInHistory,
  objectColor,
  objectShowConstruction,
  objectVisible,
  resolveBody,
  SKETCH_COLOR,
  sketchObjectId,
  type ExtrudeFeature,
  type PrimitiveFeature,
  type Resolved,
  type SketchEntity,
  type SketchFeature,
  type Vec3,
} from '@icancad/model';
import { faceFrame, sketchTopology } from '@icancad/sketch';
import { constraintsGeometryIds } from '../sketch/constraintModel';
import { problemGeometryIds } from '../sketch/problems';
import { sketchHasFormulaError } from '../sketch/resolvedConstraints';
import {
  computeSketchFrame,
  faceFrameByName,
  flipNormal,
  resolveSectionPlane,
  sectionFaceFrame,
  sectionPlaneActive,
  sketchFrameOf,
  sketchPlaneReady,
  sketchSectionPlane,
} from '../sketch/sectionPlane';
import { useStartupProgress } from '../hooks/useStartupProgress';
import { useDocumentStore, useViewModel } from '../stores/documentStore';
import { resolvedFeatureFor, useFormulaStore } from '../stores/formulaStore';
import { bootFormulaEngine, resetFormulaEngine } from '../formula/client';
import { useUiStore } from '../stores/uiStore';
import { isModelRebuilding, useKernelStore } from '../stores/kernelStore';
import {
  directBodyIds,
  drilledBodyIds,
  linkedBodyIds,
  parseBodyFaceId,
  selectedSketchDetailId,
  selectedSketchEdges,
} from '../stores/selection';
import { useThemeStore } from '../stores/themeStore';
import { Button } from '../ui/Controls';
import { CameraHint } from '../ui/CameraHint';
import { showContextMenu, useContextMenuStore, type ContextMenuItem } from '../ui/ContextMenu';
import {
  colorMenuItem,
  deleteMenuItem,
  exportMenuItem,
  objectMenuTargets,
  transformMenuItem,
  visibilityMenuItem,
} from '../ui/objectMenu';
import { SkeletonStage } from '../ui/Skeleton';
import { GeometryTooltip } from '../ui/GeometryTooltip';
import { Tooltip } from '../ui/Tooltip';
import { CAMERA_SCHEMES, ORBIT_STYLES, cameraScheme } from './cameraControls';
import { INPUT_PREFERENCES, primaryInputProfile, resolvedPointerKind } from './inputProfile';
import {
  cameraOf,
  loadCameraBook,
  saveCameraBook,
  withCamera,
  type CameraBook,
  type CameraHome,
} from './modelCameras';
import { VIEW_ELEMENTS } from './viewElements';
import { NavCube, type NavFace } from './NavCube';
import { useNavCubeLift } from './useNavCubeLift';
import {
  operationHandles,
  type OperationHandle,
  type OperationHandleDrag,
} from '../quick/operationHandles';
import { primitivePreview } from '../primitive/preview';
import { primitiveParamsAreFinite } from '../primitive/params';
import { faceIdByName, resolveEdgeRef } from '../kernel/topologyLookup';
import { edgeTreatmentEdgeRef, edgeTreatmentFaceRef } from '../quick/edgeTreatment';
import { outwardNormal } from '../quick/geometry';
import { sketchRegionPlane } from '../sketch/regionPlane';
import { shellFaceRef } from '../quick/shell';
import { findBoundExtrude, quickTargetFromSelection } from '../quick/target';
import { fixedPointIds } from '../sketch/fixedPoints';
import { bodyEdgeAxisRef } from '../sketch/revolveAxis';
import { formatNumber } from '../ui/format';
import { SceneController, type SceneBody } from './SceneController';
import { featureOfHit, featureOfPick } from './featurePick';
import { isKeylessPointer } from './inputProfile';
import { emptyTapClearsSelection, resolveSelectionHit } from './selectionPick';
import { SketchAnnotations } from './SketchAnnotations';
import { SketchEditor } from './SketchEditor';
import {
  addProjectionToSketch,
  projectionEntityIds,
  resolveSketchProjections,
  sketchProjectionSources,
  type ProjectionPick,
} from '../sketch/projection';
import { getViewport, registerViewport, type ScenePick } from './handle';

const AXIS_HINTS: Record<string, { text: string; color: string }> = {
  right: { text: '+X', color: '#d48282' },
  left: { text: '−X', color: '#d48282' },
  back: { text: '+Y', color: '#82b482' },
  front: { text: '−Y', color: '#82b482' },
  top: { text: '+Z', color: '#84a4e4' },
  bottom: { text: '−Z', color: '#84a4e4' },
};

/** What a projection click in the 3D view needs: the sketch to add to and its source. */
function projectionTarget(sketchId: string, pick: ScenePick) {
  const store = useDocumentStore.getState();
  const feature = activeModel(store.project).features.find(
    (candidate): candidate is SketchFeature =>
      candidate.id === sketchId && candidate.type === 'sketch',
  );
  if (!feature) return null;
  const kernel = useKernelStore.getState();
  if (pick.kind === 'body' || pick.kind === 'mesh') return null;
  const driven = resolvedFeatureFor(feature) ?? feature;
  const frame = computeSketchFrame(
    driven,
    driven.plane.type === 'face' ? kernel.meshes[driven.plane.bodyId ?? ''] : undefined,
  );
  let projectionPick: ProjectionPick | null = null;
  if (pick.kind === 'sketch-edge') {
    // The scene is the state before this sketch, so a curve of another sketch is
    // one of its edges; the sketch being edited is the one thing it cannot take.
    if (pick.sketchId === sketchId) return null;
    projectionPick = { kind: 'sketch-edge', sketchId: pick.sketchId, entityId: pick.entityId };
  } else if (pick.kind === 'face') {
    // A region of another sketch stands for the curves that bound it.
    if (pick.sketchId === sketchId) return null;
    projectionPick = { kind: 'sketch-face', sketchId: pick.sketchId, faceId: pick.faceId };
  } else if (pick.kind === 'body-vertex') {
    projectionPick = {
      kind: 'vertex',
      bodyId: pick.bodyId,
      elementId: pick.elementId,
      position: pick.position,
    };
  } else if (pick.kind === 'body-edge') {
    projectionPick = { kind: 'edge', bodyId: pick.bodyId, edgeId: pick.edgeId };
  } else if (pick.kind === 'body-face') {
    projectionPick = { kind: 'face', bodyId: pick.bodyId, faceId: pick.faceId };
  }
  if (!projectionPick) return null;
  const model = activeModel(store.project);
  const sketchOf = sketchProjectionSources(
    model.features.filter((candidate): candidate is SketchFeature => candidate.type === 'sketch'),
    (candidate) => {
      const source = resolvedFeatureFor(candidate) ?? candidate;
      return computeSketchFrame(
        source,
        source.plane.type === 'face' ? kernel.meshes[source.plane.bodyId ?? ''] : undefined,
      );
    },
  );
  const mesh =
    pick.kind === 'body-vertex' || pick.kind === 'body-edge' || pick.kind === 'body-face'
      ? kernel.meshes[pick.bodyId]
      : undefined;
  return { feature, frame, pick: projectionPick, mesh, sketchOf };
}

/** Turns a click in the 3D view into projected sketch geometry. */
function projectPickIntoSketch(sketchId: string, pick: ScenePick | null): void {
  if (!pick) return;
  const target = projectionTarget(sketchId, pick);
  if (!target) return;
  const next = addProjectionToSketch(
    target.feature,
    target.frame,
    target.mesh,
    target.pick,
    target.sketchOf,
  );
  if (next) useDocumentStore.getState().apply({ type: 'feature/replace', feature: next });
}

/** The curves the pick under the pointer would add: the preview of a projection. */
function projectionPreviewFor(pick: ScenePick): readonly SketchEntity[] | null {
  const sketchId = useUiStore.getState().activeSketchId;
  if (!sketchId) return null;
  const target = projectionTarget(sketchId, pick);
  if (!target) return null;
  const before = new Set(target.feature.entities.map((entity) => entity.id));
  const next = addProjectionToSketch(
    target.feature,
    target.frame,
    target.mesh,
    target.pick,
    target.sketchOf,
  );
  return next ? next.entities.filter((entity) => !before.has(entity.id)) : null;
}

/** What the drag chip says: the extrude method or the edge treatment side. */
function chipLabel(drag: OperationHandleDrag, translate: (key: never) => string): string {
  if (drag.op) return translate(`quick.${drag.op}` as never);
  if (drag.kind) return translate(`edgeTreatment.${drag.kind}` as never);
  if (drag.label) return drag.label;
  if (drag.unit === 'angle') return translate('quick.angle' as never);
  return '';
}

/** How long the view must rest before its camera is written down. */
const CAMERA_SAVE_DELAY_MS = 400;

/**
 * The mesh a pick was made on. While an operation is open its result is a
 * preview and the published meshes belong to the model before it, so the input
 * the pick really hit is read from the preview instead.
 */
function meshOfPick(bodyId: string | undefined): TessellationResult | undefined {
  if (!bodyId) return undefined;
  const kernelState = useKernelStore.getState();
  const mark = kernelState.preview?.bodies.find((candidate) => candidate.id === bodyId);
  return mark?.baseMesh ?? kernelState.meshes[bodyId];
}

export function Viewport() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navCubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useNavCubeLift(navRef);
  const controllerRef = useRef<SceneController | null>(null);
  const navCubeRef = useRef<NavCube | null>(null);
  const previousCount = useRef(0);
  /** Bodies the scene has already shown; a body coming back is not new. */
  const seenBodyIds = useRef(new Set<string>());
  const activeModelId = useDocumentStore((state) => state.project.activeSuperObjectId);
  // A model id names a model inside its project only: the pair names one camera.
  const projectId = useDocumentStore((state) => state.project.id);
  // Null on the first render, so the open model is taken as an arrival.
  const lastModelId = useRef<string | null>(null);
  /**
   * The model already arrived on this controller. A remount builds a new one, and
   * a fresh scene has seen no model yet: the arrival belongs to the instance.
   */
  const arrivedIn = useRef<SceneController | null>(null);
  /**
   * The first bodies of a model ask for a fit, but a build delivers them one at a
   * time: the camera waits until the kernel has finished, or it frames a corner
   * of what is still coming.
   */
  const fitPending = useRef(false);
  /**
   * The camera of every model, kept by the app rather than by the project: a view
   * belongs to the machine it was set on, so it does not travel in the document.
   */
  const cameraBook = useRef<CameraBook>(loadCameraBook());
  /** The model on screen, and so the model the viewport's camera belongs to. */
  const cameraHome = useRef<CameraHome | null>(null);
  const cameraSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The arriving model opened at a camera it was left with, so it needs no fit. */
  const restoredPose = useRef(false);
  /** Whether the model on screen had a remembered pose when it opened. */
  const modelHasSavedPose = useRef(false);
  /** True until the model's first build has published a finished scene. */
  const firstBuildPending = useRef(true);
  /** Scene counter the model started from, so a previous scene cannot finish it. */
  const modelSceneStart = useRef(0);
  const rebuilding = useKernelStore((state) => isModelRebuilding(state));
  const longOperation = useKernelStore((state) => state.longOperation);
  const interimSceneVersion = useKernelStore((state) => state.interimSceneVersion);
  const sceneVersion = useKernelStore((state) => state.sceneVersion);
  const viewElements = useUiStore((state) => state.viewElements);
  useEffect(() => {
    controllerRef.current?.setViewElements(viewElements);
  }, [viewElements]);
  useEffect(() => {
    controllerRef.current?.setLongOperation(longOperation);
  }, [longOperation]);

  /**
   * Writes down the camera the viewport holds now, for the model it belongs to.
   * A gesture moves the camera frame by frame, so the write waits for the view to
   * come to rest instead of running on every step of a turn.
   */
  const writeCamera = useCallback(() => {
    cameraSaveTimer.current = null;
    const controller = controllerRef.current;
    const home = cameraHome.current;
    if (!controller || !home) return;
    // A sketch is drawn from a pose of its own, which the editor gives back on the
    // way out: it is not the view the model is kept at.
    if (useUiStore.getState().activeSketchId) return;
    // A camera on its way between two poses passes through poses nobody chose;
    // the step that ends the move brings the next write.
    if (controller.isCameraSettling()) return;
    cameraBook.current = withCamera(cameraBook.current, home, controller.getCameraState());
    saveCameraBook(cameraBook.current);
  }, []);

  const noteCamera = useCallback(() => {
    if (cameraSaveTimer.current !== null) clearTimeout(cameraSaveTimer.current);
    cameraSaveTimer.current = setTimeout(writeCamera, CAMERA_SAVE_DELAY_MS);
  }, [writeCamera]);

  const project = useViewModel();
  const resolvedProject = useFormulaStore((state) => state.resolution?.model ?? null);
  const formulaRevision = useFormulaStore((state) => state.resolution?.revision ?? 0);
  const editingFeatureId = useDocumentStore((state) => state.editingFeatureId);
  const editingPrimitive = useMemo(() => {
    const feature = resolvedProject?.features.find(
      (candidate) => candidate.id === editingFeatureId,
    );
    return feature?.type === 'primitive' ? (feature as Resolved<PrimitiveFeature>) : null;
  }, [resolvedProject, editingFeatureId]);
  // The delta mesh is generated here, in the same render as the handles, so
  // dragging a handle moves the object and the grip in one frame.
  const primitiveDelta = useMemo(
    () =>
      editingPrimitive && resolvedProject && primitiveParamsAreFinite(editingPrimitive)
        ? primitivePreview(editingPrimitive, resolvedProject)
        : null,
    [editingPrimitive, resolvedProject],
  );
  const sectionPlanes = project.view.sectionPlanes;
  const sectionEnabled = useUiStore((state) => state.sectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const activeSketchReady = useUiStore((state) => state.activeSketchReady);
  const sketchTool = useUiStore((state) => state.sketchTool);
  const sketchProjecting = Boolean(activeSketchId) && sketchTool === 'project';
  const pickingExtrude = useUiStore((state) => state.pickingExtrude);
  const pickingExtrudeBodies = useUiStore((state) => state.pickingExtrudeBodies);
  const pickingEdges = useUiStore((state) => state.pickingEdges);
  const pickingShellBodies = useUiStore((state) => state.pickingShellBodies);
  const pickingShellFaces = useUiStore((state) => state.pickingShellFaces);
  const pickingBooleanBodies = useUiStore((state) => state.pickingBooleanBodies);
  const pickingBooleanTools = useUiStore((state) => state.pickingBooleanTools);
  const pickingSketchPlane = useUiStore((state) => state.pickingSketchPlane);
  const pickingSectionFace = useUiStore((state) => state.pickingSectionFace);
  const pickingRevolveAxis = useUiStore((state) => state.pickingRevolveAxis);
  const pickingExtrudeToBody = useUiStore((state) => state.pickingExtrudeToBody);
  const pickingTransformTargets = useUiStore((state) => state.pickingTransformTargets);
  const pickingArrayBodies = useUiStore((state) => state.pickingArrayBodies);
  const pickingArrayOperations = useUiStore((state) => state.pickingArrayOperations);
  const pickingArrayFace = useUiStore((state) => state.pickingArrayFace);
  const pickingArrayPath = useUiStore((state) => state.pickingArrayPath);
  const sketchSectionEnabled = useUiStore((state) => state.sketchSectionEnabled);
  const sketchConstraintIds = useUiStore((state) => state.sketchConstraintIds);
  const sketchFrozenEntityIds = useUiStore((state) => state.sketchFrozenEntityIds);
  const sketchProblemConstraintIds = useUiStore((state) => state.sketchProblemConstraintIds);
  const sketchAutoHighlightIds = useUiStore((state) => state.sketchAutoHighlightIds);
  const sketchHoverIds = useUiStore((state) => state.sketchHoverIds);
  const sketchSelectionIds = useUiStore((state) => state.sketchSelectionIds);
  const selection = useDocumentStore((state) => state.selection);
  // A selected sketch shows its regions in 3D, and selecting one of those
  // regions keeps the sketch open for the next click.
  const selectedSketchId =
    selection.length === 1 && selection[0]?.kind === 'sketch'
      ? selection[0].id
      : (selectedSketchDetailId(selection) ?? undefined);
  const meshes = useKernelStore((state) => state.meshes);
  const consumedBodies = useKernelStore((state) => state.consumedBodies);
  const preview = useKernelStore((state) => state.preview);
  const bodies = bodiesInHistory(project, consumedBodies);
  const sketchFrames = useKernelStore((state) => state.sketchFrames);
  const sketchOverrides = useKernelStore((state) => state.sketchOverrides);
  const featureBodyErrors = useKernelStore((state) => state.featureBodyErrors);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const status = useKernelStore((state) => state.status);
  const error = useKernelStore((state) => state.error);
  const theme = useThemeStore((state) => state.theme);
  const openMenu = useContextMenuStore((state) => state.open);

  // A selected face or sketch opens one quick extrude handle. The handle is
  // derived from the operation, never stored as its own state.
  const quickTarget = useMemo(
    () => quickTargetFromSelection(project, selection, meshes),
    [project, selection, meshes],
  );
  const quickBodies = useMemo(
    () =>
      bodies.flatMap((body) => {
        const mesh = meshes[body.id];
        return body.kind !== 'mesh' && mesh ? [{ id: body.id, mesh }] : [];
      }),
    [bodies, meshes],
  );
  // Bodies as they are before the edited operation: its own refs are read
  // against them, because the result no longer holds the edge it treated.
  const baseMeshes = useMemo(() => {
    const result: Record<string, TessellationResult> = {};
    for (const mark of preview?.bodies ?? []) {
      if (mark.baseMesh) result[mark.id] = mark.baseMesh;
    }
    return result;
  }, [preview]);
  const quickBlocked =
    Boolean(activeSketchId) ||
    Boolean(pickingExtrude) ||
    Boolean(pickingExtrudeBodies) ||
    Boolean(pickingEdges) ||
    Boolean(pickingShellBodies) ||
    Boolean(pickingShellFaces) ||
    Boolean(pickingBooleanBodies) ||
    Boolean(pickingBooleanTools) ||
    Boolean(pickingSketchPlane) ||
    Boolean(pickingSectionFace) ||
    Boolean(pickingRevolveAxis) ||
    Boolean(pickingExtrudeToBody) ||
    // The array's own grips are only meaningful once what it repeats is picked,
    // and while picking they would take the clicks aimed at the geometry.
    Boolean(pickingArrayBodies) ||
    Boolean(pickingArrayOperations) ||
    status !== 'ready';
  const boundExtrude = useMemo(
    () => (quickTarget ? findBoundExtrude(project, quickTarget) : undefined),
    [project, quickTarget],
  );
  // The line the edited revolve turns around, so the scene can mark it.
  const revolveAxisSelection = useMemo(() => {
    const focused =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const feature = (focused?.type === 'extrude' ? focused : undefined) ?? boundExtrude;
    return feature && feature.type === 'extrude' && feature.method === 'revolve'
      ? (feature.revolve?.axis ?? null)
      : null;
  }, [project, selection, boundExtrude]);
  const handleLabels = useMemo(
    () => ({
      extrude: t('features.extrude'),
      create: t('quick.createTooltip'),
      distance: t('quick.distanceTooltip'),
      secondDistance: t('quick.secondDistanceTooltip'),
      edgeTreatment: t('features.edgeTreatment'),
      edgeTreatmentTooltip: t('edgeTreatment.dragTooltip'),
      edgeTreatmentRadiusTooltip: t('edgeTreatment.radiusTooltip'),
      edgeTreatmentDistanceTooltip: t('edgeTreatment.distanceTooltip'),
      revolveStart: t('quick.revolveStartTooltip'),
      revolveEnd: t('quick.revolveEndTooltip'),
      move: t('handles.move'),
      moveLabel: t('handles.moveLabel'),
      moveX: t('handles.moveX'),
      moveY: t('handles.moveY'),
      moveZ: t('handles.moveZ'),
      width: t('inspector.width'),
      height: t('inspector.height'),
      depth: t('inspector.depth'),
      radius: t('inspector.radius'),
      diameter: t('inspector.diameter'),
      bottomRadius: t('inspector.bottomRadius'),
      topRadius: t('inspector.topRadius'),
      baseRadius: t('inspector.baseRadius'),
      ringDiameter: t('inspector.ringDiameter'),
      tubeDiameter: t('inspector.tubeDiameter'),
      ringRadius: t('inspector.ringRadius'),
      tubeRadius: t('inspector.tubeRadius'),
      sides: t('inspector.sides'),
      sidesTooltip: t('handles.sides'),
      arraySpacing: t('array.spacing'),
      arrayCount: t('array.count'),
      arrayAngle: t('array.angle'),
      sketchRotateX: t('handles.rotateX'),
      sketchRotateY: t('handles.rotateY'),
      sketchRotateZ: t('handles.rotateZ'),
      transformRotateX: t('handles.rotateX'),
      transformRotateY: t('handles.rotateY'),
      transformRotateZ: t('handles.rotateZ'),
      transformScale: t('handles.scale'),
    }),
    [t],
  );
  // The extrusion operation offers its handles; the viewport only draws them.
  const operationHandleList = useMemo(
    () =>
      quickBlocked
        ? []
        : operationHandles({
            project,
            resolvedProject,
            selection,
            meshes,
            baseMeshes,
            sketchFrames,
            bodies: quickBodies,
            labels: handleLabels,
            ...(preview?.arraySeed ? { arraySeed: preview.arraySeed } : {}),
            ...(preview?.transformPivot ? { transformPivot: preview.transformPivot } : {}),
          }),
    [
      quickBlocked,
      project,
      resolvedProject,
      selection,
      meshes,
      baseMeshes,
      sketchFrames,
      quickBodies,
      handleLabels,
      preview,
    ],
  );
  const handles = useMemo(
    () =>
      operationHandleList.map((handle) => ({
        id: handle.id,
        origin: handle.origin,
        direction: handle.direction,
        value: handle.value,
        enabled: handle.enabled,
        thickness: handle.thickness,
        tooltip: handle.tooltip,
        ...(handle.kind ? { kind: handle.kind } : {}),
        ...(handle.axis ? { axis: handle.axis } : {}),
        ...(handle.fixedLengthPx ? { fixedLengthPx: handle.fixedLengthPx } : {}),
        ...(handle.shaft ? { shaft: handle.shaft } : {}),
        ...(handle.tipOnly ? { tipOnly: handle.tipOnly } : {}),
        ...(handle.endGapPx ? { endGapPx: handle.endGapPx } : {}),
        ...(handle.arc ? { arc: handle.arc } : {}),
        ...(handle.orbit ? { orbit: handle.orbit } : {}),
        // The grip of a path rides inside the route of the copies: without it
        // the ball is drawn on a straight ray from the seed and misses the
        // first copy as soon as the path bends.
        ...(handle.trail ? { trail: handle.trail } : {}),
      })),
    [operationHandleList],
  );

  const activeSketch = activeSketchId
    ? project.features.find(
        (feature): feature is SketchFeature =>
          feature.type === 'sketch' && feature.id === activeSketchId,
      )
    : undefined;
  const sketchSection =
    activeSketch && activeSketchReady && sketchSectionEnabled && sketchPlaneReady(activeSketch)
      ? sketchSectionPlane(
          activeSketch,
          computeSketchFrame(
            resolvedFeatureFor(activeSketch) ?? activeSketch,
            activeSketch.plane.type === 'face'
              ? meshes[activeSketch.plane.bodyId ?? '']
              : undefined,
          ),
        )
      : null;
  const sketchSectionKey = sketchSection ? JSON.stringify(sketchSection) : '';

  const navLabels: Record<NavFace, string> = {
    front: t('nav.front'),
    back: t('nav.back'),
    left: t('nav.left'),
    right: t('nav.right'),
    top: t('nav.top'),
    bottom: t('nav.bottom'),
  };
  const labelsRef = useRef(navLabels);
  labelsRef.current = navLabels;
  const translationRef = useRef(t);
  translationRef.current = t;
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;
  const quickDragRef = useRef<OperationHandleDrag | null>(null);
  const handlesRef = useRef<OperationHandle[]>(operationHandleList);
  handlesRef.current = operationHandleList;
  const [quickChip, setQuickChip] = useState<{
    x: number;
    y: number;
    label: string;
    value: number;
    unit: 'length' | 'angle' | 'count' | 'number' | 'percent';
  } | null>(null);
  const [handleHover, setHandleHover] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const navCanvas = navCubeCanvasRef.current;
    if (!canvas || !container || !navCanvas) return;

    const controller = new SceneController(
      canvas,
      container,
      async (pick, additive) => {
        const ui = useUiStore.getState();
        if (ui.activeSketchId) {
          // Projecting is the only sketch tool that reaches into the 3D scene.
          if (ui.sketchTool === 'project') projectPickIntoSketch(ui.activeSketchId, pick);
          return;
        }
        const store = useDocumentStore.getState();
        // The scene in front of the edited operation is interactive as soon as
        // it is published; the operation's own preview does not hold this back.
        if (pick && !useKernelStore.getState().interactiveReady) {
          ui.showToast('toast.pickAfterRebuild');
          return;
        }
        if (ui.pickingExtrudeBodies) {
          if (pick?.kind === 'body') {
            store.select({ kind: 'body', id: pick.id });
          }
          return;
        }
        if (ui.pickingTransformTargets) {
          const featureId = ui.pickingTransformTargets;
          if (pick?.kind === 'body') {
            store.toggleTransformBody(featureId, pick.id);
          } else if (pick?.kind === 'face') {
            // A region of a sketch stands for the sketch the transform moves.
            store.toggleTransformSketch(featureId, pick.sketchId);
          }
          return;
        }
        if (ui.pickingShellBodies) {
          if (pick?.kind !== 'body') return;
          const body = activeModel(store.project).bodies.find(
            (candidate) => candidate.id === pick.id,
          );
          if (!body || body.kind === 'mesh') return;
          store.toggleShellBody(ui.pickingShellBodies, pick.id);
          return;
        }
        if (ui.pickingBooleanBodies || ui.pickingBooleanTools) {
          if (pick?.kind !== 'body') return;
          const featureId = ui.pickingBooleanBodies ?? ui.pickingBooleanTools;
          if (!featureId) return;
          const side = ui.pickingBooleanBodies ? 'bodies' : 'tools';
          store.toggleBooleanBody(featureId, side, pick.id);
          return;
        }
        if (ui.pickingShellFaces) {
          if (pick?.kind !== 'body-face') return;
          const body = activeModel(store.project).bodies.find(
            (candidate) => candidate.id === pick.bodyId,
          );
          if (!body || body.kind === 'mesh') return;
          // Picking runs against the input of the edited operation: its own
          // result has bodies and faces the document does not have yet.
          const kernelState = useKernelStore.getState();
          const mark = kernelState.preview?.bodies.find(
            (candidate) => candidate.id === pick.bodyId,
          );
          if (mark?.kind === 'added') return;
          const mesh = mark?.baseMesh ?? kernelState.meshes[pick.bodyId];
          if (!mesh) return;
          const ref = shellFaceRef(mesh, pick.bodyId, pick.faceId, {
            normal: pick.normal,
            origin: pick.origin,
          });
          if (ref) store.toggleShellFace(ui.pickingShellFaces, ref);
          return;
        }
        if (ui.pickingSketchPlane) {
          if (pick?.kind !== 'body-face') return;
          if (!pick.planar) {
            ui.showToast('errors.FACE_NOT_PLANAR', 'error');
            return;
          }
          const feature = activeModel(store.project).features.find(
            (candidate): candidate is SketchFeature =>
              candidate.id === ui.pickingSketchPlane && candidate.type === 'sketch',
          );
          if (!feature) return;
          const mesh = meshOfPick(pick.bodyId);
          const faceName = mesh?.faceNames?.[Number(pick.faceId)];
          if (!faceName) return;
          store.apply({
            type: 'feature/replace',
            feature: {
              ...feature,
              plane: {
                type: 'face',
                bodyId: pick.bodyId,
                name: faceName,
                offset: feature.plane.type === 'face' ? (feature.plane.offset ?? 0) : 0,
                // The middle of the face, the same frame the rebuild and the
                // editor place the sketch at; the click point would put the
                // sketch somewhere else the moment the history is rebuilt.
                frame: faceFrameByName(mesh, faceName) ?? faceFrame(pick.origin, pick.normal),
                ...(feature.plane.rotation ? { rotation: feature.plane.rotation } : {}),
              },
            },
          });
          const enterEdit = ui.sketchPlanePickThenEdit === feature.id;
          ui.setPickingSketchPlane(null);
          if (enterEdit) {
            // A valid planar face replaces the previous invalid plane, so the
            // editor must not close on the stale rebuild error.
            useKernelStore.getState().clearFeatureError(feature.id);
            ui.setActiveSketch(feature.id);
          }
          return;
        }
        if (ui.pickingSectionFace) {
          if (pick?.kind !== 'body-face') return;
          if (!pick.planar) {
            ui.showToast('errors.FACE_NOT_PLANAR', 'error');
            return;
          }
          const planes = activeModel(store.project).view.sectionPlanes;
          const plane = planes.find((candidate) => candidate.id === ui.pickingSectionFace);
          if (!plane) {
            ui.setPickingSectionFace(null);
            return;
          }
          // The face is remembered together with the pose it has right now, so a
          // face that later disappears still leaves the section where it was.
          const sectionMesh = meshOfPick(pick.bodyId);
          const faceName = sectionMesh?.faceNames?.[Number(pick.faceId)];
          if (!faceName) return;
          const frame = sectionFaceFrame(sectionMesh, faceName) ?? {
            origin: pick.origin,
            normal: pick.normal,
          };
          store.setSectionPlanes(
            planes.map((candidate) =>
              candidate.id === plane.id
                ? {
                    ...candidate,
                    face: { bodyId: pick.bodyId, name: faceName },
                    origin: frame.origin,
                    // The material behind the face is what stays, so the plane
                    // looks into the body and the offset cuts deeper.
                    normal: flipNormal(frame.normal),
                    offset: 0,
                  }
                : candidate,
            ),
          );
          ui.setPickingSectionFace(null);
          return;
        }
        const edgePicking = ui.pickingEdges;
        if (ui.pickingRevolveAxis) {
          if (!pick) return;
          const featureId = ui.pickingRevolveAxis;
          if (pick.kind === 'body-edge') {
            // The axis is read from the input the operation works on, which is
            // the base mesh while a preview shows its result.
            const kernelState = useKernelStore.getState();
            const mark = kernelState.preview?.bodies.find(
              (candidate) => candidate.id === pick.bodyId,
            );
            const mesh = mark?.baseMesh ?? kernelState.meshes[pick.bodyId];
            const ref = mesh ? bodyEdgeAxisRef(mesh, pick.bodyId, pick.edgeId) : null;
            if (!ref) {
              ui.showToast('errors.REVOLVE_EDGE_NOT_STRAIGHT', 'error');
              return;
            }
            store.setRevolveAxis(featureId, ref);
            ui.setPickingRevolveAxis(null);
            return;
          }
          if (pick.kind === 'sketch-edge') {
            store.setRevolveAxis(featureId, {
              kind: 'sketch-edge',
              sketchId: pick.sketchId,
              entityId: pick.entityId,
            });
            ui.setPickingRevolveAxis(null);
          }
          return;
        }
        if (edgePicking) {
          if (!pick) return;
          if (pick.kind !== 'body-edge' && pick.kind !== 'body-face') return;
          // Picking runs against the input of the edited operation, so the
          // reference has to be measured on that same mesh. Its own result has
          // renumbered faces and edges that no longer match the input. This
          // callback outlives a render, so the preview is read from the store.
          const mesh = meshOfPick(pick.bodyId);
          if (pick.kind === 'body-edge') {
            const ref = mesh ? edgeTreatmentEdgeRef(mesh, pick.bodyId, pick.edgeId) : null;
            if (!ref) return;
            store.toggleEdgeTreatmentEdge(edgePicking, ref);
            return;
          }
          if (pick.kind === 'body-face') {
            if (!pick.planar) {
              ui.showToast('errors.FACE_NOT_PLANAR', 'error');
              return;
            }
            if (!mesh) return;
            const ref = edgeTreatmentFaceRef(mesh, pick.bodyId, pick.faceId, {
              centroid: pick.origin,
              normal: pick.normal,
            });
            if (ref) store.toggleEdgeTreatmentFace(edgePicking, ref);
          }
          return;
        }
        if (ui.pickingArrayFace) {
          const picker = ui.pickingArrayFace;
          // A face of a body or a region of a sketch: both are a plane, and the
          // copies turn around the normal of that plane through its centre.
          if (pick?.kind === 'face') {
            const sketch = activeModel(store.project).features.find(
              (candidate): candidate is SketchFeature =>
                candidate.id === pick.sketchId && candidate.type === 'sketch',
            );
            const plane = sketch
              ? sketchRegionPlane(
                  sketch,
                  pick.faceId,
                  useKernelStore.getState().sketchFrames[pick.sketchId],
                )
              : null;
            if (!plane) return;
            store.setArrayAxisFace(picker.featureId, picker.index, {
              kind: 'sketch-face',
              sketchId: pick.sketchId,
              faceId: pick.faceId,
              origin: plane.origin,
              normal: plane.normal,
            });
            ui.setPickingArrayFace(null);
            return;
          }
          if (pick?.kind !== 'body-face') return;
          if (!pick.planar) {
            ui.showToast('errors.FACE_NOT_PLANAR', 'error');
            return;
          }
          // The face is read from the input the operation works on, which is
          // the base mesh while a preview shows its result.
          const kernelState = useKernelStore.getState();
          const mark = kernelState.preview?.bodies.find(
            (candidate) => candidate.id === pick.bodyId,
          );
          const mesh = mark?.baseMesh ?? kernelState.meshes[pick.bodyId];
          const face = mesh ? outwardNormal(mesh, Number(pick.faceId)) : null;
          if (!face) {
            ui.showToast('errors.FACE_NOT_PLANAR', 'error');
            return;
          }
          // The turn goes around the same middle the sketch tool uses when it
          // lands on a face: the area-weighted centroid of the tessellation.
          // It needs no kernel round trip, so arming the picker costs nothing.
          const faceName = meshOfPick(pick.bodyId)?.faceNames?.[Number(pick.faceId)];
          if (!faceName) return;
          store.setArrayAxisFace(picker.featureId, picker.index, {
            kind: 'face',
            bodyId: pick.bodyId,
            name: faceName,
            origin: face.centroid,
            normal: face.normal,
          });
          ui.setPickingArrayFace(null);
          return;
        }
        if (ui.pickingArrayPath) {
          const picker = ui.pickingArrayPath;
          if (!pick) return;
          if (pick.kind === 'body-edge') {
            const edge = meshOfPick(pick.bodyId)?.edges?.find(
              (candidate) => candidate.id === pick.edgeId,
            );
            if (!edge?.name) return;
            store.toggleArrayPath(picker.featureId, picker.index, {
              kind: 'body-edge',
              bodyId: pick.bodyId,
              name: edge.name,
            });
          } else if (pick.kind === 'sketch-edge') {
            store.toggleArrayPath(picker.featureId, picker.index, {
              kind: 'sketch-edge',
              sketchId: pick.sketchId,
              entityId: pick.entityId,
            });
          }
          return;
        }
        const picking = ui.pickingExtrude;
        if (picking) {
          if (!pick) return;
          if (pick.kind === 'body' || pick.kind === 'mesh') return;
          if (pick.kind === 'face') {
            store.select({ kind: 'face', id: `${pick.sketchId}#${pick.faceId}` });
          } else if (pick.kind === 'body-face') {
            if (!pick.planar) {
              ui.showToast('errors.FACE_NOT_PLANAR', 'error');
              return;
            }
            const name = meshOfPick(pick.bodyId)?.faceNames?.[Number(pick.faceId)];
            if (!name) return;
            store.toggleExtrudeBodyFace(picking, pick.bodyId, name, pick.normal, pick.origin);
          }
          return;
        }
        const toBodyPicker = ui.pickingExtrudeToBody;
        if (toBodyPicker) {
          if (!pick) return;
          // A body, its face or its edge all name the same body: the extent
          // stops at the whole body's surface, not at one face of it.
          const bodyId =
            pick.kind === 'body'
              ? pick.id
              : pick.kind === 'body-face' ||
                  pick.kind === 'body-edge' ||
                  pick.kind === 'body-vertex'
                ? pick.bodyId
                : undefined;
          if (!bodyId) return;
          const body = activeModel(store.project).bodies.find(
            (candidate) => candidate.id === bodyId,
          );
          if (!body || body.kind === 'mesh') return;
          const feature = activeModel(store.project).features.find(
            (candidate): candidate is ExtrudeFeature =>
              candidate.id === toBodyPicker && candidate.type === 'extrude',
          );
          store.setExtrudeToBody(toBodyPicker, {
            ...feature?.toBody,
            kind: feature?.toBody?.kind ?? 'first',
            bodyId,
          });
          ui.setPickingExtrudeToBody(null);
          return;
        }
        if (!pick) {
          store.select(null);
          return;
        }
        if (pick.kind === 'mesh') {
          store.select({ kind: 'mesh', id: pick.id }, { additive });
          return;
        }
        if (
          pick.kind === 'body' ||
          pick.kind === 'body-face' ||
          pick.kind === 'body-edge' ||
          pick.kind === 'body-vertex'
        ) {
          store.select(
            { kind: 'body', id: pick.kind === 'body' ? pick.id : pick.bodyId },
            {
              additive,
            },
          );
          return;
        }
        if (pick.kind === 'face') {
          store.select({ kind: 'face', id: `${pick.sketchId}#${pick.faceId}` }, { additive });
        }
      },
      (object, x, y) => {
        if (!object || useUiStore.getState().activeSketchId) return;
        const store = useDocumentStore.getState();
        const exists =
          object.kind === 'sketch'
            ? activeModel(store.project).features.some(
                (feature) => feature.id === object.id && feature.type === 'sketch',
              )
            : activeModel(store.project).bodies.some((candidate) => candidate.id === object.id);
        if (!exists) return;
        // Opening a menu never changes the selection: the menu acts on the
        // clicked object, or on the whole selection when it includes that object.
        const targets = objectMenuTargets(activeModel(store.project), store.selection, object);
        const labels = translationRef.current;
        const items: ContextMenuItem[] = [];
        const color = colorMenuItem(targets, labels('context.color'));
        if (color) items.push(color);
        const visibility = visibilityMenuItem(targets, {
          hide: labels('tree.hide'),
          show: labels('tree.show'),
        });
        if (visibility) items.push(visibility);
        const transform = transformMenuItem(targets, labels('features.transform'));
        if (transform) items.push(transform);
        const exportItem = exportMenuItem(targets, {
          export: labels('project.export'),
          stl: labels('project.exportStl'),
          step: labels('project.exportStep'),
        });
        if (exportItem) items.push(exportItem);
        const remove = deleteMenuItem(
          targets,
          targets.length > 1
            ? labels('context.deleteSelected', { count: targets.length })
            : labels('context.deleteObject'),
        );
        if (remove) items.push(remove);
        showContextMenu({ clientX: x, clientY: y, preventDefault: () => undefined }, items);
      },
      (azimuth, polar, distance) => {
        navCubeRef.current?.sync(azimuth, polar);
        if (navCubeCanvasRef.current) {
          navCubeCanvasRef.current.dataset.azimuth = String(azimuth);
          navCubeCanvasRef.current.dataset.polar = String(polar);
          navCubeCanvasRef.current.dataset.distance = String(distance);
        }
        noteCamera();
      },
      // A double click on a face opens the operation that produced it: the
      // shape a body currently has comes from the operation that last built it,
      // and a sketch face comes from the sketch operation itself.
      (pick, pointerType) => {
        const ui = useUiStore.getState();
        // Selection controls own the mouse while they are active.
        if (
          ui.activeSketchId ||
          ui.pickingExtrude ||
          ui.pickingExtrudeBodies ||
          ui.pickingSketchPlane ||
          ui.pickingSectionFace ||
          ui.pickingRevolveAxis ||
          ui.pickingExtrudeToBody
        ) {
          return;
        }
        if (!useKernelStore.getState().interactiveReady) return;
        const store = useDocumentStore.getState();
        // A second tap on empty space is the only way a finger drops a set it
        // built: two or more picked objects are too easy to lose otherwise.
        if (!pick) {
          if (isKeylessPointer(pointerType)) store.select(null);
          return;
        }
        const project = activeModel(store.project);
        const kernel = useKernelStore.getState();
        const featureId =
          pick.kind === 'body-face'
            ? // The face itself knows which operation made it: a boolean keeps
              // the faces it does not touch, so an untouched face still leads to
              // the operation that first created it.
              (kernel.faceOperations[pick.bodyId]?.[Number(pick.faceId)] ??
              kernel.bodyOperations[pick.bodyId] ??
              project.bodies.find((body) => body.id === pick.bodyId)?.createdBy)
            : pick.kind === 'face'
              ? pick.sketchId
              : undefined;
        if (!featureId) return;
        if (!project.features.some((feature) => feature.id === featureId)) return;
        store.select({ kind: 'feature', id: featureId });
      },
      {
        // Normal selection: the first click selects an object, the next one
        // drills into the face or edge under the cursor.
        onSelectPick: (hit, additive, pointerType) => {
          if (useUiStore.getState().activeSketchId) return;
          const store = useDocumentStore.getState();
          const ui = useUiStore.getState();
          // An array asks for operations: the geometry the pointer is on is the
          // operation it stands for, so a click takes that operation instead of
          // selecting the body it belongs to.
          if (ui.pickingArrayOperations) {
            const featureId = hit
              ? featureOfHit(hit, useKernelStore.getState(), activeModel(store.project))
              : null;
            if (featureId) store.toggleArrayOperation(ui.pickingArrayOperations, featureId);
            return;
          }
          const resolution = resolveSelectionHit(hit, store.selection, { additive });
          if (!resolution) {
            if (emptyTapClearsSelection(store.selection, pointerType, additive)) {
              store.select(null);
            }
            return;
          }
          store.select(resolution.item, { additive: resolution.additive });
        },
        onHandleDrag: (event: {
          id: string;
          value: number;
          phase: 'start' | 'move' | 'end' | 'cancel';
          x: number;
          y: number;
          shift: boolean;
          move?: Vec3;
        }) => {
          if (event.phase === 'start') {
            const handle = handlesRef.current.find((candidate) => candidate.id === event.id);
            if (!handle) return;
            const drag = handle.beginDrag();
            quickDragRef.current = drag;
            setQuickChip({
              x: event.x,
              y: event.y,
              label: chipLabel(drag, translationRef.current),
              value: drag.value,
              unit: drag.unit ?? 'length',
            });
            return;
          }
          const drag = quickDragRef.current;
          if (!drag) return;
          if (event.phase === 'move') {
            drag.update(event.value, event.shift, event.move);
            setQuickChip({
              x: event.x,
              y: event.y,
              label: chipLabel(drag, translationRef.current),
              value: drag.value,
              unit: drag.unit ?? 'length',
            });
            return;
          }
          if (event.phase === 'end') drag.end();
          else drag.cancel();
          quickDragRef.current = null;
          setQuickChip(null);
        },
        onHandleHover: (event) =>
          setHandleHover(event ? { x: event.x, y: event.y, text: event.text } : null),
        // The geometry under the pointer names the operation that made it, but
        // only while operations are being picked: the tip answers what a click
        // there would take, which is the question the picking mode asks.
        onGeometryHover: (event) => {
          const ui = useUiStore.getState();
          if (!event || !ui.pickingArrayOperations) {
            ui.setHoveredFeature(null);
            return;
          }
          const project = activeModel(useDocumentStore.getState().project);
          const featureId = featureOfPick(event.pick, useKernelStore.getState(), project);
          ui.setHoveredFeature(featureId ? { featureId, x: event.x, y: event.y } : null);
        },
        onProjectionHover: (pick) => {
          controllerRef.current?.setProjectionPreview(
            pick ? projectionPreviewFor(pick) : null,
          );
        },
      },
    );
    controllerRef.current = controller;
    controller.setTheme(useThemeStore.getState().theme);
    // The view settings outlive the controller, so the scene starts with them.
    controller.setViewElements(useUiStore.getState().viewElements);

    // The nav cube menu both drives the view and chooses how the pointer drives
    // it. It is rebuilt on every opening and after a change, so the ticks follow
    // the scheme the camera is actually using.
    const navMenuItems = (): ContextMenuItem[] => {
      const labels = translationRef.current;
      const scheme = cameraScheme(useUiStore.getState().cameraScheme);
      const inputPreference = useUiStore.getState().inputPreference;
      const orbitStyle = useUiStore.getState().orbitStyle;
      // What "automatic" means right now, so the choice is not a guess.
      const detectedProfile = primaryInputProfile();
      const pointerKind = resolvedPointerKind(inputPreference);
      const automaticLabel = `${labels('nav.inputAuto')} · ${labels(
        (detectedProfile === 'touch'
          ? 'nav.inputTouch'
          : pointerKind === 'trackpad'
            ? 'nav.inputTrackpad'
            : 'nav.inputMouse') as never,
      )}`;
      const sketchId = useUiStore.getState().activeSketchId;
      const sketchFeature = sketchId
        ? activeModel(useDocumentStore.getState().project).features.find(
            (feature): feature is SketchFeature =>
              feature.type === 'sketch' && feature.id === sketchId,
          )
        : undefined;
      return [
        ...(sketchFeature
          ? [
              {
                id: 'orient-sketch',
                label: labels('nav.orientToSketch'),
                icon: <ScanSquare size={14} />,
                onSelect: () =>
                  controller.alignSketch(
                    computeSketchFrame(
                      resolvedFeatureFor(sketchFeature) ?? sketchFeature,
                      sketchFeature.plane.type === 'face'
                        ? useKernelStore.getState().meshes[sketchFeature.plane.bodyId ?? '']
                        : undefined,
                    ),
                    sketchFeature.entities,
                  ),
              },
            ]
          : []),
        {
          id: 'fit',
          label: labels('project.fit'),
          icon: <ScanBox size={14} />,
          onSelect: () => controller.fit(),
        },
        {
          id: 'iso',
          label: labels('nav.iso'),
          icon: <House size={14} />,
          // Home: the usual orientation and the whole model in view at once.
          onSelect: () => controller.fit('iso'),
        },
        { id: 'iso-separator', separator: true },
        {
          id: 'camera-controls',
          label: labels('nav.controls'),
          icon: <Rotate3d size={14} />,
          submenu: [
            ...CAMERA_SCHEMES.map((option) => ({
              id: `camera-scheme-${option.id}`,
              label: labels(option.label as never),
              tooltip: <CameraHint scheme={option} />,
              checked: option.id === scheme.id,
              // Trying the schemes is a back and forth, so the menu stays open.
              keepOpen: true,
              onSelect: () => {
                useUiStore.getState().setCameraScheme(option.id);
                useContextMenuStore.getState().updateItems(navMenuItems());
              },
            })),
            { id: 'orbit-separator', separator: true },
            { id: 'orbit-heading', heading: labels('nav.rotation') },
            ...ORBIT_STYLES.map((style) => ({
              id: `orbit-${style}`,
              label: labels(
                (style === 'trackball'
                  ? 'nav.rotationTrackball'
                  : 'nav.rotationTurntable') as never,
              ),
              tooltip: labels(
                (style === 'trackball'
                  ? 'nav.rotationTrackballHint'
                  : 'nav.rotationTurntableHint') as never,
              ),
              checked: orbitStyle === style,
              keepOpen: true,
              onSelect: () => {
                useUiStore.getState().setOrbitStyle(style);
                useContextMenuStore.getState().updateItems(navMenuItems());
              },
            })),
            { id: 'input-separator', separator: true },
            { id: 'input-heading', heading: labels('nav.input') },
            ...INPUT_PREFERENCES.map((option) => ({
              id: `input-${option}`,
              label:
                option === 'auto'
                  ? automaticLabel
                  : labels(
                      (option === 'touch'
                        ? 'nav.inputTouch'
                        : option === 'trackpad'
                          ? 'nav.inputTrackpad'
                          : 'nav.inputMouse') as never,
                    ),
              checked: inputPreference === option,
              keepOpen: true,
              onSelect: () => {
                useUiStore.getState().setInputPreference(option);
                useContextMenuStore.getState().updateItems(navMenuItems());
              },
            })),
          ],
        },
        {
          id: 'view-elements',
          label: labels('elements.title'),
          icon: <Eye size={14} />,
          // A tick list of what the view draws besides the model. The settings
          // are the user's, kept outside the project.
          submenu: VIEW_ELEMENTS.map((option) => ({
            id: `element-${option.id}`,
            label: labels(option.label as never),
            tooltip: labels(option.hint as never),
            checked: useUiStore.getState().viewElements[option.id],
            keepOpen: true,
            onSelect: () => {
              const ui = useUiStore.getState();
              ui.setViewElement(option.id, !ui.viewElements[option.id]);
              useContextMenuStore.getState().updateItems(navMenuItems());
            },
          })),
        },
        { id: 'views-separator', separator: true },
        ...(['front', 'back', 'left', 'right', 'top', 'bottom'] as const).map((view) => {
          const hint = AXIS_HINTS[view];
          return {
            id: view,
            label: labels(`nav.${view}`),
            hint: hint ? <span style={{ color: hint.color }}>{hint.text}</span> : undefined,
            onSelect: () => controller.setView(view),
          };
        }),
      ];
    };

    const navCube = new NavCube(navCanvas, labelsRef.current, useThemeStore.getState().theme, {
      onView: (view) => controller.setView(view),
      onOrientation: (azimuth, polar) => controller.setOrientation(azimuth, polar),
      onOrbit: (deltaX, deltaY) => controller.orbitBy(deltaX, deltaY),
      onContextMenu: (x, y) => openMenuRef.current(x, y, navMenuItems()),
    });
    navCubeRef.current = navCube;
    const orientation = controller.getOrientation();
    navCube.sync(orientation.azimuth, orientation.polar);

    registerViewport({
      fit: () => controller.fit(),
      setView: (name) => controller.setView(name),
      setSketches: (sketches) => controller.setSketches(sketches),
      setSketchOverlay: (preview, draftPoints, highlight, marker, guides, cursor, replaced) =>
        controller.setSketchOverlay(preview, draftPoints, highlight, marker, guides, cursor, replaced),
      alignSketch: (frame, entities, extraPoints) =>
        controller.alignSketch(frame, entities, extraPoints),
      getCameraState: () => controller.getCameraState(),
      setCameraState: (state) => controller.setCameraState(state),
      pickSketch: (x, y) => controller.pickSketch(x, y),
      snapSketch: (x, y, tolerance) => controller.snapSketch(x, y, tolerance),
      projectSketchPoint: (frame, point) => controller.projectSketchPoint(frame, point),
      sketchPointAt: (x, y) => controller.sketchPointAt(x, y),
      getHandles: () => controller.getHandles(),
      getGhosts: () => controller.getGhosts(),
    });

    return () => {
      registerViewport(null);
      navCube.dispose();
      navCubeRef.current = null;
      // The model on screen keeps the camera it was left with, so a reload opens
      // where the page was closed even if the view was still settling.
      if (cameraSaveTimer.current !== null) {
        clearTimeout(cameraSaveTimer.current);
        writeCamera();
      }
      controller.dispose();
      controllerRef.current = null;
    };
  }, [noteCamera, writeCamera]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    // A controller built after another one — a remount, a replaced canvas — has
    // seen nothing, so the model has to arrive there as well.
    const replaced = arrivedIn.current !== controller;
    if (replaced) {
      arrivedIn.current = controller;
      lastModelId.current = null;
    }

    // A model opens at the camera it was left with, position and direction alike:
    // switching models moves between two remembered views. One never seen before
    // starts at the default pose and is fitted to its content once the build has
    // finished.
    if (lastModelId.current !== activeModelId) {
      // The model that is leaving hands its camera over before the next one takes
      // the view. A replaced controller holds a pose of its own, so writing it
      // would put the default pose in place of what the previous one had.
      if (cameraSaveTimer.current !== null) {
        clearTimeout(cameraSaveTimer.current);
        cameraSaveTimer.current = null;
      }
      if (!replaced) writeCamera();
      cameraHome.current = { projectId, modelId: activeModelId };
      lastModelId.current = activeModelId;
      const remembered = cameraOf(cameraBook.current, cameraHome.current);
      controller.setCameraState(remembered ?? controller.defaultCameraPose());
      restoredPose.current = Boolean(remembered);
      modelHasSavedPose.current = Boolean(remembered);
      firstBuildPending.current = true;
      modelSceneStart.current = useKernelStore.getState().sceneVersion;
      // The new model's bodies are all new bodies: the fit waits for its own
      // build, not for the model that was open a moment ago.
      previousCount.current = 0;
      seenBodyIds.current.clear();
      fitPending.current = false;
    }

    const marks = new Map((preview?.bodies ?? []).map((mark) => [mark.id, mark]));
    const sceneBodies: SceneBody[] = [];
    // The order of this list is the order of the tree, and the scene uses it to
    // decide which of two bodies owns a surface they share.
    for (const [order, body] of bodies.entries()) {
      const mesh = meshes[body.id];
      if (!mesh) continue;
      const mark = marks.get(body.id);
      // A join shows the original body exactly as it was; only the translucent
      // delta ghost above represents the material being added.
      const renderBase = mark?.renderBase && mark.baseMesh;
      sceneBodies.push({
        id: body.id,
        kind: body.kind,
        mesh: renderBase ? mark!.baseMesh! : mesh,
        color: body.color,
        visible: mark?.hidden ? false : body.visible,
        order,
        ...(mark
          ? {
              ghost: mark.kind,
              translucent: mark.translucent !== false,
              // Interaction stays on the input model while the preview is drawn.
              ...(mark.baseMesh ? { hitMesh: mark.baseMesh } : {}),
            }
          : {}),
      });
    }
    // A long operation publishes bodies the document has not recorded yet:
    // `syncCreatedBodies` waits for the finished build, so the interim scene
    // draws them here. Interaction stays blocked while the rebuild runs.
    if (longOperation) {
      const documented = new Set(bodies.map((body) => body.id));
      let order = sceneBodies.length;
      for (const [id, mesh] of Object.entries(meshes)) {
        if (documented.has(id)) continue;
        sceneBodies.push({
          id,
          kind: 'solid',
          mesh,
          color: BODY_COLORS[order % BODY_COLORS.length] ?? '#6ea8fe',
          visible: true,
          order,
          interactive: false,
        });
        order += 1;
      }
    }
    // Bodies the edited operation will create are shown translucent and cannot
    // be picked: they are not part of the document yet. They come last, where
    // the object they will become will sit in the tree.
    for (const mark of preview?.bodies ?? []) {
      if (mark.kind !== 'added' || mark.ghostOnly) continue;
      if (bodies.some((body) => body.id === mark.id)) continue;
      const mesh = meshes[mark.id];
      if (!mesh) continue;
      const ref = project.bodies.find((body) => body.id === mark.id);
      const resolved = ref ? resolveBody(project, ref) : undefined;
      sceneBodies.push({
        id: mark.id,
        kind: resolved?.kind ?? 'solid',
        mesh,
        color: resolved?.color ?? mark.color,
        visible: resolved?.visible ?? true,
        order: sceneBodies.length,
        ghost: 'added',
        interactive: false,
      });
    }

    const selectedFeature =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const extrude = selectedFeature?.type === 'extrude' ? selectedFeature : undefined;
    const boolean = selectedFeature?.type === 'boolean' ? selectedFeature : undefined;
    const errorBodyIds = extrude
      ? Object.keys(featureBodyErrors[extrude.id] ?? {})
      : boolean
        ? Object.keys(featureBodyErrors[boolean.id] ?? {})
        : [];
    // A boolean highlights both lists: every body the operation reads.
    const targetBodyIds = extrude
      ? extrude.op !== 'new'
        ? extrude.bodyIds
        : []
      : boolean
        ? [...boolean.bodyIds, ...boolean.toolIds]
        : [];
    controller.setBodies(
      sceneBodies,
      directBodyIds(selection),
      [...new Set([...linkedBodyIds(selection, project), ...targetBodyIds])],
      errorBodyIds,
    );
    controller.setGhosts(primitiveDelta ? primitiveDelta.ghosts : (preview?.ghosts ?? []));
    controller.setTreatmentMarks(preview?.faceMarks ?? []);
    // A sketch is edited with the timeline rolled in front of it, so bodies
    // created later vanish from the scene and reappear on exit. A body that
    // has been seen before is coming back, not appearing: fitting would
    // interrupt the camera restore that returns the user to the view they had
    // before entering the sketch (the same goes for rolling the timeline).
    const unseenBody = sceneBodies.some((body) => !seenBodyIds.current.has(body.id));
    for (const body of sceneBodies) seenBodyIds.current.add(body.id);
    if (!activeSketchId && previousCount.current === 0 && unseenBody) {
      // A model that opened at a remembered camera is framed already; only a
      // first opening, which starts at the default pose, is fitted. The arrival
      // is consumed here, so bodies that come later are new ones again.
      if (!restoredPose.current) {
        // The camera is fitted below, once the build that produced these bodies
        // has finished: fitting the first of them frames a corner of the model.
        fitPending.current = true;
      }
      restoredPose.current = false;
    }
    previousCount.current = sceneBodies.length;
  }, [
    activeModelId,
    activeSketchId,
    bodies,
    meshes,
    preview,
    primitiveDelta,
    project,
    projectId,
    selection,
    featureBodyErrors,
    longOperation,
    writeCamera,
  ]);

  // The fit a model asks for on arrival. It runs when the kernel is idle again,
  // so the whole build is in the scene before the camera measures it. It is
  // checked after every render: the bodies that ask for it arrive with their own
  // updates, and a dependency list here would wait for one of its own entries.
  // A long rebuild swaps bodies under the skeleton, and each swap is framed the
  // same way, unless the model opened at a camera the user already chose.
  useEffect(() => {
    if (rebuilding) return;
    if (sceneVersion > modelSceneStart.current) firstBuildPending.current = false;
  }, [rebuilding, sceneVersion]);

  useEffect(() => {
    if (interimSceneVersion === 0 || modelHasSavedPose.current || !firstBuildPending.current) {
      return;
    }
    fitPending.current = true;
  }, [interimSceneVersion]);

  useEffect(() => {
    if (!fitPending.current || (rebuilding && !longOperation)) return;
    if (activeSketchId) {
      fitPending.current = false;
      return;
    }
    fitPending.current = false;
    controllerRef.current?.fit();
  });

  // Which bodies are open for detail picking, and which sketch shows regions.
  useEffect(() => {
    controllerRef.current?.setSelectionDetail({
      bodyIds: drilledBodyIds(selection),
      sketchId: selectedSketchId ?? null,
      // An array picks operations from the geometry, so every body offers its
      // faces while it is asking: the face under the pointer is the operation.
      geometrySelected:
        Boolean(pickingArrayOperations) ||
        Boolean(pickingArrayFace) ||
        selection.some((item) => item.kind === 'body-face' || item.kind === 'edge'),
    });
  }, [selection, selectedSketchId, pickingArrayOperations, pickingArrayFace]);

  useEffect(() => {
    controllerRef.current?.setHandles(handles);
  }, [handles]);

  // Faces of the edited operation are highlighted in 3D, and the one under the
  // cursor is highlighted while objects are being picked.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const selectedFeature =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const extrude = selectedFeature?.type === 'extrude' ? selectedFeature : undefined;
    const treatment = selectedFeature?.type === 'edge-treatment' ? selectedFeature : undefined;
    const shell = selectedFeature?.type === 'shell' ? selectedFeature : undefined;
    const errors = extrude
      ? (featureBodyErrors[extrude.id] ?? {})
      : treatment
        ? (featureBodyErrors[treatment.id] ?? {})
        : shell
          ? (featureBodyErrors[shell.id] ?? {})
          : {};
    const selected: string[] = [];
    const invalid: string[] = [];
    // Faces picked in the tree or inspector stay highlighted even without an
    // active operation.
    for (const item of selection) {
      if (item.kind === 'face') selected.push(`s:${item.id}`);
      // A face with an existing operation is marked by its handle instead:
      // the boolean renumbers faces, so the stored id may point elsewhere.
      if (item.kind === 'body-face' && !boundExtrude) {
        const parsed = parseBodyFaceId(item.id);
        if (parsed) selected.push(`b:${parsed.bodyId}#${parsed.faceId}`);
      }
    }
    if (extrude) {
      if (extrude.scope === 'selected' && extrude.sketchId) {
        for (const region of extrude.regions) selected.push(`s:${extrude.sketchId}#${region}`);
      }
      for (const ref of extrude.faceRefs ?? []) {
        const faceId = faceIdByName(meshes[ref.bodyId], ref.name);
        if (faceId === null) continue;
        const key = `b:${ref.bodyId}#${faceId}`;
        if (errors[ref.bodyId]) invalid.push(key);
        else selected.push(key);
      }
    }
    for (const ref of treatment?.faceRefs ?? []) {
      const faceId = faceIdByName(meshes[ref.bodyId], ref.name);
      if (faceId === null) continue;
      const key = `b:${ref.bodyId}#${faceId}`;
      if (errors[ref.bodyId]) invalid.push(key);
      else selected.push(key);
    }
    for (const ref of shell?.removeFaces ?? []) {
      const faceId = faceIdByName(meshes[ref.bodyId], ref.name);
      if (faceId === null) continue;
      const key = `b:${ref.bodyId}#${faceId}`;
      if (errors[ref.bodyId]) invalid.push(key);
      else selected.push(key);
    }
    const planeSketch = selectedFeature?.type === 'sketch' ? selectedFeature : undefined;
    // While the sketch is being edited its plane is context, not a selected
    // target, so the reference face is not highlighted.
    if (
      planeSketch &&
      planeSketch.id !== activeSketchId &&
      planeSketch.plane.type === 'face' &&
      planeSketch.plane.bodyId &&
      planeSketch.plane.name
    ) {
      const faceId = faceIdByName(meshes[planeSketch.plane.bodyId], planeSketch.plane.name);
      if (faceId !== null) selected.push(`b:${planeSketch.plane.bodyId}#${faceId}`);
    }
    controller.setFaceHighlights({
      selected,
      invalid,
      picking:
        Boolean(pickingExtrude) ||
        Boolean(pickingEdges) ||
        Boolean(pickingShellFaces) ||
        Boolean(pickingSketchPlane) ||
        Boolean(pickingSectionFace) ||
        Boolean(pickingRevolveAxis) ||
        Boolean(pickingExtrudeToBody) ||
        Boolean(pickingArrayFace) ||
        Boolean(pickingArrayPath) ||
        sketchProjecting,
      bodyPicking:
        Boolean(pickingTransformTargets) ||
        Boolean(pickingExtrudeBodies) ||
        Boolean(pickingShellBodies) ||
        Boolean(pickingBooleanBodies) ||
        Boolean(pickingBooleanTools) ||
        Boolean(pickingExtrudeToBody),
      edgePicking:
        Boolean(pickingEdges) ||
        Boolean(pickingRevolveAxis) ||
        Boolean(pickingArrayPath) ||
        sketchProjecting,
      vertexPicking: false,
      projecting: sketchProjecting,
      // A section plane needs a face of a body; a rotation axis also takes a
      // region of a sketch, which is drawn over the face it lies on.
      bodyFacesOnly: Boolean(pickingSketchPlane) || Boolean(pickingSectionFace),
    });
  }, [
    selection,
    project,
    featureBodyErrors,
    pickingExtrude,
    pickingExtrudeBodies,
    pickingTransformTargets,
    pickingSketchPlane,
    pickingSectionFace,
    pickingEdges,
    pickingShellBodies,
    pickingShellFaces,
    pickingBooleanBodies,
    pickingBooleanTools,
    pickingRevolveAxis,
    pickingExtrudeToBody,
    pickingArrayFace,
    pickingArrayPath,
    sketchProjecting,
    activeSketchId,
    boundExtrude,
  ]);

  useEffect(() => {
    const selectedFeature =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const treatment = selectedFeature?.type === 'edge-treatment' ? selectedFeature : undefined;
    // A stored edge ref names the edge as it was picked; the highlight needs the
    // edge that exists in the mesh the scene shows, which is the input of the
    // operation.
    const picked = { ...meshes, ...baseMeshes };
    const treated = (treatment?.edgeRefs ?? []).flatMap((ref) => {
      const resolved = resolveEdgeRef(
        { bodyShapes: new Map([[ref.bodyId, ref.bodyId]]), meshes: picked },
        ref,
      );
      return resolved ? [`${resolved.bodyId}#${resolved.edgeId}`] : [];
    });
    const axis = revolveAxisSelection;
    const axisEdge =
      axis?.kind === 'body-edge'
        ? resolveEdgeRef(
            { bodyShapes: new Map([[axis.bodyId, axis.bodyId]]), meshes: picked },
            {
              bodyId: axis.bodyId,
              name: axis.name,
              start: axis.start,
              mid: [
                (axis.start[0] + axis.end[0]) / 2,
                (axis.start[1] + axis.end[1]) / 2,
                (axis.start[2] + axis.end[2]) / 2,
              ],
              end: axis.end,
              bisector: [0, 0, 1],
            },
          )
        : null;
    controllerRef.current?.setEdgeHighlights([
      ...selection.filter((item) => item.kind === 'edge').map((item) => item.id),
      ...treated,
      ...(axisEdge ? [`${axisEdge.bodyId}#${axisEdge.edgeId}`] : []),
    ]);
  }, [selection, meshes, baseMeshes, project, revolveAxisSelection]);

  useEffect(() => {
    controllerRef.current?.setTheme(theme);
    navCubeRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    // A plane bound to a face follows the current tessellation, so the sections
    // are resolved against the rebuilt meshes; a plane still waiting for its
    // face cuts nothing. The sketch plane joins the set while a sketch is being
    // edited, and the serialized key keeps the effect from re-running on every
    // render.
    const resolved = sectionPlanes
      .filter(sectionPlaneActive)
      .map((plane) => resolveSectionPlane(plane, meshes));
    // Projecting aims at the whole model, so the sketch's own section plane
    // stops cutting it: a clipped face cannot be clicked.
    const planes = sketchSection && !sketchProjecting ? [sketchSection, ...resolved] : resolved;
    controllerRef.current?.setSection(sectionEnabled ? planes : []);
  }, [sketchSectionKey, sectionEnabled, sectionPlanes, meshes, sketchProjecting]);

  useEffect(() => {
    const ids = activeFeatureIds(project);
    // The edited operation is previewed on top of the cursor state, so a sketch
    // that is being configured or edited is drawn from that preview.
    const previewedId = preview?.featureId ?? null;
    const sketchSource = sketchProjectionSources(
      project.features.filter((feature): feature is SketchFeature => feature.type === 'sketch'),
      (feature) => sketchFrameOf(resolvedFeatureFor(feature) ?? feature, sketchFrames[feature.id]),
    );
    const sketches = project.features
      .filter(
        (feature): feature is SketchFeature =>
          feature.type === 'sketch' &&
          (ids.has(feature.id) || feature.id === previewedId || feature.id === activeSketchId) &&
          sketchPlaneReady(feature) &&
          (!featureErrors[feature.id] ||
            (feature.id === activeSketchId && featureErrors[feature.id] === 'EXPRESSION_ERROR')) &&
          (feature.id !== activeSketchId || activeSketchReady) &&
          (objectVisible(project, sketchObjectId(feature.id)) || feature.id === activeSketchId),
      )
      .map((feature) => {
        // The frozen frame from the rebuild at the sketch's place in the
        // history. A live face frame would follow the sketch's own cut and move
        // the sketch while it is being edited.
        const frame = sketchFrameOf(
          resolvedFeatureFor(feature) ?? feature,
          sketchFrames[feature.id],
        );
        // Projected geometry follows the bodies as the rebuild sees them; the
        // stored entities are the snapshot used when a link is gone. A sketch
        // an operation moved is drawn from that operation's own geometry.
        const override = sketchOverrides[feature.id];
        const resolved = override
          ? { entities: override, lostEntityIds: [] }
          : resolveSketchProjections(feature, frame, (bodyId) => meshes[bodyId], sketchSource);
        const dimmed = (() => {
          if (feature.id !== activeSketchId) return [];
          const constraints = feature.constraints.filter((candidate) =>
            sketchConstraintIds.includes(candidate.id),
          );
          if (constraints.length === 0) return [];
          const related = new Set(constraintsGeometryIds(constraints));
          return resolved.entities
            .filter((entity) => !related.has(entity.id))
            .map((entity) => entity.id);
        })();
        const selectedEdgeKeys = selectedSketchEdges(selection)
          .filter((edge) => edge.sketchId === feature.id)
          .map((edge) => edge.entityId);
        // Regions of a sketch are offered while a tool picks faces: a rotation
        // axis can be the plane of a sketch region, and the fill has to sit
        // above the body face it lies on for the pick to reach it.
        const facesPicking =
          Boolean(pickingExtrude) || Boolean(pickingArrayFace) || feature.id === selectedSketchId;
        const operationSelected = selection.some(
          (item) => item.kind === 'feature' && item.id === feature.id,
        );
        return {
          id: feature.id,
          color: objectColor(project, sketchObjectId(feature.id), SKETCH_COLOR),
          error: feature.id === activeSketchId && sketchHasFormulaError(feature.id),
          showConstruction: objectShowConstruction(project, sketchObjectId(feature.id)),
          faces: sketchTopology(resolved.entities).faces.map((face) => ({
            id: face.id,
            outline: face.outline,
            holes: face.holeOutlines,
          })),
          facesPicking,
          frame,
          entities: resolved.entities,
          selectionKeys: feature.id === activeSketchId ? sketchSelectionIds : selectedEdgeKeys,
          dimmedEntityIds: dimmed,
          frozenEntityIds: feature.id === activeSketchId ? sketchFrozenEntityIds : [],
          fixedPointIds: fixedPointIds(feature),
          problemEntityIds:
            feature.id === activeSketchId
              ? problemGeometryIds(feature, sketchProblemConstraintIds)
              : [],
          projectedEntityIds: [...projectionEntityIds(feature)],
          lostEntityIds: resolved.lostEntityIds,
          highlightIds: [
            ...(feature.id === activeSketchId ? sketchAutoHighlightIds : []),
            ...(revolveAxisSelection?.kind === 'sketch-edge' &&
            revolveAxisSelection.sketchId === feature.id
              ? [revolveAxisSelection.entityId]
              : []),
          ],
          hoverIds: feature.id === activeSketchId ? sketchHoverIds : [],
          active: feature.id === activeSketchId,
          // A projection takes the state before this sketch, so the sketch
          // itself is greyed while the tool runs: it cannot be picked.
          greyed: sketchProjecting && feature.id === activeSketchId,
          onTop:
            feature.id === activeSketchId ||
            feature.id === selectedSketchId ||
            operationSelected ||
            facesPicking,
        };
      });
    getViewport()?.setSketches(sketches);
  }, [
    activeSketchId,
    project,
    formulaRevision,
    sketchSelectionIds,
    sketchConstraintIds,
    sketchFrozenEntityIds,
    sketchProblemConstraintIds,
    sketchAutoHighlightIds,
    sketchHoverIds,
    sketchProjecting,
    pickingExtrude,
    pickingArrayFace,
    featureErrors,
    sketchFrames,
    sketchOverrides,
    activeSketchReady,
    meshes,
    preview,
    selection,
    selectedSketchId,
    revolveAxisSelection,
  ]);

  useEffect(() => {
    navCubeRef.current?.setLabels(navLabels);
  }, [t]);

  const formulaStatus = useFormulaStore((state) => state.status);
  const formulaError = useFormulaStore((state) => state.error);
  const startup = useStartupProgress();
  const showStartup = startup.stage !== 'ready';
  const showError = status === 'error';

  return (
    <div className="viewport-wrap" ref={containerRef}>
      <canvas ref={canvasRef} className="viewport-canvas" data-testid="viewport-canvas" />

      {quickChip && (
        <div
          className="quick-chip"
          data-testid="quick-chip"
          style={{ left: quickChip.x + 16, top: quickChip.y + 16 }}
        >
          <span>{quickChip.label}</span>
          <span className="quick-chip-value">
            {formatNumber(
              Math.abs(quickChip.value),
              i18n.language,
              quickChip.unit === 'count'
                ? 0
                : quickChip.unit === 'number' || quickChip.unit === 'percent'
                  ? 2
                  : 1,
            )}
            {quickChip.unit === 'angle'
              ? '°'
              : quickChip.unit === 'percent'
                ? '%'
                : quickChip.unit === 'count' || quickChip.unit === 'number'
                  ? ''
                  : ' mm'}
          </span>
        </div>
      )}

      {!quickChip && handleHover && handleHover.text && (
        <div
          className="handle-tooltip"
          data-testid="handle-tooltip"
          style={{ left: handleHover.x + 14, top: handleHover.y + 18 }}
        >
          {handleHover.text}
        </div>
      )}

      <GeometryTooltip />

      <div className="viewport-nav" ref={navRef}>
        <Tooltip content={<CameraHint intro />}>
          <canvas
            ref={navCubeCanvasRef}
            className="nav-cube-canvas"
            aria-label={t('nav.cube')}
            data-testid="nav-cube"
          />
        </Tooltip>
      </div>

      {showStartup && (
        <SkeletonStage
          action={startup.message}
          testId="viewport-skeleton"
          progress={startup.progress}
          busy={startup.busy}
        />
      )}

      {showError && (
        <div className="empty-card">
          <h2>{t('empty.errorTitle')}</h2>
          <p className="error">{error ?? t('errors.KERNEL_LOAD_FAILED')}</p>
          <Button variant="primary" onClick={() => void retryKernel()}>
            {t('empty.retry')}
          </Button>
        </div>
      )}

      {/* Without Python no formula can resolve, so the failure is not silent. */}
      {formulaStatus === 'error' && (
        <div className="empty-card">
          <h2>{t('empty.errorTitle')}</h2>
          <p className="error">{formulaError ?? t('errors.FORMULA_LOAD_FAILED')}</p>
          <Button
            variant="primary"
            onClick={() => {
              resetFormulaEngine();
              void bootFormulaEngine().catch(() => undefined);
            }}
          >
            {t('empty.retry')}
          </Button>
        </div>
      )}

      <SketchAnnotations />
      <SketchEditor />
    </div>
  );
}
