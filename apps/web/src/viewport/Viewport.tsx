import { ScanBox, ScanSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { retryKernel } from '../kernel/client';
import {
  activeFeatureIds,
  bodiesInHistory,
  objectColor,
  objectShowConstruction,
  objectVisible,
  resolveBody,
  SKETCH_COLOR,
  sketchObjectId,
  type SketchFeature,
} from '@icancad/model';
import { faceFrame, sketchTopology } from '@icancad/sketch';
import {
  computeSketchFrame,
  flipNormal,
  resolveSectionPlane,
  sectionFaceFrame,
  sectionPlaneActive,
  sketchFrameOf,
  sketchPlaneReady,
  sketchSectionPlane,
} from '../sketch/sectionPlane';
import { useDocumentStore, useViewProject } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { isModelRebuilding, useKernelStore } from '../stores/kernelStore';
import { directBodyIds, drilledBodyIds, linkedBodyIds, parseBodyFaceId } from '../stores/selection';
import { useThemeStore } from '../stores/themeStore';
import { Button } from '../ui/Controls';
import {
  showContextMenu,
  useContextMenuStore,
  type ContextMenuItem,
} from '../ui/ContextMenu';
import {
  colorMenuItem,
  deleteMenuItem,
  objectTargets,
  visibilityMenuItem,
} from '../ui/objectMenu';
import { SkeletonStage } from '../ui/Skeleton';
import { Tooltip } from '../ui/Tooltip';
import { NavCube, type NavFace } from './NavCube';
import {
  operationHandles,
  type OperationHandle,
  type OperationHandleDrag,
} from '../quick/operationHandles';
import { findBoundExtrude, quickTargetFromSelection } from '../quick/target';
import { formatNumber } from '../ui/format';
import { SceneController, type SceneBody } from './SceneController';
import { edgeBisector, edgePose } from '../kernel/edgeTreatment';
import { resolveSelectionHit } from './selectionPick';
import { SketchAnnotations } from './SketchAnnotations';
import { SketchEditor } from './SketchEditor';
import { getViewport, registerViewport } from './handle';

const AXIS_HINTS: Record<string, { text: string; color: string }> = {
  right: { text: '+X', color: '#d48282' },
  left: { text: '−X', color: '#d48282' },
  back: { text: '+Y', color: '#82b482' },
  front: { text: '−Y', color: '#82b482' },
  top: { text: '+Z', color: '#84a4e4' },
  bottom: { text: '−Z', color: '#84a4e4' },
};

/** What the drag chip says: the extrude method or the edge treatment side. */
function chipLabel(drag: OperationHandleDrag, translate: (key: never) => string): string {
  if (drag.op) return translate(`quick.${drag.op}` as never);
  if (drag.kind) return translate(`edgeTreatment.${drag.kind}` as never);
  return '';
}

export function Viewport() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navCubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const navCubeRef = useRef<NavCube | null>(null);
  const previousCount = useRef(0);

  const project = useViewProject();
  const bodies = bodiesInHistory(project);
  const sectionPlanes = project.view.sectionPlanes;
  const sectionEnabled = useUiStore((state) => state.sectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const activeSketchReady = useUiStore((state) => state.activeSketchReady);
  const pickingExtrude = useUiStore((state) => state.pickingExtrude);
  const pickingExtrudeBodies = useUiStore((state) => state.pickingExtrudeBodies);
  const pickingEdges = useUiStore((state) => state.pickingEdges);
  const pickingSketchPlane = useUiStore((state) => state.pickingSketchPlane);
  const pickingSectionFace = useUiStore((state) => state.pickingSectionFace);
  const sketchSectionEnabled = useUiStore((state) => state.sketchSectionEnabled);
  const sketchConstraintId = useUiStore((state) => state.sketchConstraintId);
  const sketchFrozenEntityIds = useUiStore((state) => state.sketchFrozenEntityIds);
  const sketchAutoHighlightIds = useUiStore((state) => state.sketchAutoHighlightIds);
  const sketchSelectionIds = useUiStore((state) => state.sketchSelectionIds);
  const selection = useDocumentStore((state) => state.selection);
  // A selected sketch shows its regions in 3D, and selecting one of those
  // regions keeps the sketch open for the next click.
  const selectedSketchId =
    selection.length === 1 && selection[0]?.kind === 'sketch'
      ? selection[0].id
      : selection.length > 0 && selection.every((item) => item.kind === 'face')
        ? selection[0]!.id.split('#')[0]
        : undefined;
  const meshes = useKernelStore((state) => state.meshes);
  const preview = useKernelStore((state) => state.preview);
  const sketchFrames = useKernelStore((state) => state.sketchFrames);
  const featureBodyErrors = useKernelStore((state) => state.featureBodyErrors);
  const featureErrors = useKernelStore((state) => state.featureErrors);
  const featureLimits = useKernelStore((state) => state.featureLimits);
  const status = useKernelStore((state) => state.status);
  const error = useKernelStore((state) => state.error);
  const theme = useThemeStore((state) => state.theme);
  const openMenu = useContextMenuStore((state) => state.open);

  // A selected face or sketch opens one quick extrude handle. The handle is
  // derived from the operation, never stored as its own state.
  const quickTarget = useMemo(
    () => quickTargetFromSelection(project, selection),
    [project, selection],
  );
  const quickBodies = useMemo(
    () =>
      bodies.flatMap((body) => {
        const mesh = meshes[body.id];
        return body.kind !== 'mesh' && mesh ? [{ id: body.id, mesh }] : [];
      }),
    [bodies, meshes],
  );
  const quickBlocked =
    Boolean(activeSketchId) ||
    Boolean(pickingExtrude) ||
    Boolean(pickingExtrudeBodies) ||
    Boolean(pickingEdges) ||
    Boolean(pickingSketchPlane) ||
    Boolean(pickingSectionFace) ||
    status !== 'ready';
  const boundExtrude = useMemo(
    () => (quickTarget ? findBoundExtrude(project, quickTarget) : undefined),
    [project, quickTarget],
  );
  const handleLabels = useMemo(
    () => ({
      extrude: t('features.extrude'),
      create: t('quick.createTooltip'),
      distance: t('quick.distanceTooltip'),
      secondDistance: t('quick.secondDistanceTooltip'),
      edgeTreatment: t('features.edgeTreatment'),
      edgeTreatmentTooltip: t('edgeTreatment.tooltip'),
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
            selection,
            meshes,
            sketchFrames,
            bodies: quickBodies,
            limits: featureLimits,
            labels: handleLabels,
          }),
    [
      quickBlocked,
      project,
      selection,
      meshes,
      sketchFrames,
      quickBodies,
      featureLimits,
      handleLabels,
    ],
  );
  const handles = useMemo(
    () =>
      operationHandleList.map((handle) => ({
        id: handle.id,
        kind: handle.kind === 'track' ? ('track' as const) : ('arrow' as const),
        origin: handle.origin,
        direction: handle.direction,
        value: handle.value,
        limit: handle.limit,
        leader: handle.leader,
        enabled: handle.enabled,
        tooltip: handle.tooltip,
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
    activeSketch &&
    activeSketchReady &&
    sketchSectionEnabled &&
    sketchPlaneReady(activeSketch)
      ? sketchSectionPlane(
          activeSketch,
          computeSketchFrame(
            activeSketch,
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
      (pick, additive) => {
        if (useUiStore.getState().activeSketchId) return;
        const store = useDocumentStore.getState();
        const ui = useUiStore.getState();
        if (pick && isModelRebuilding(useKernelStore.getState())) {
          ui.showToast('toast.pickAfterRebuild');
          return;
        }
        if (ui.pickingExtrudeBodies) {
          if (pick?.kind === 'body') {
            store.select({ kind: 'body', id: pick.id });
          }
          return;
        }
        if (ui.pickingSketchPlane) {
          if (pick?.kind !== 'body-face') return;
          if (!pick.planar) {
            ui.showToast('errors.FACE_NOT_PLANAR', 'error');
            return;
          }
          const feature = store.project.features.find(
            (candidate): candidate is SketchFeature =>
              candidate.id === ui.pickingSketchPlane &&
              candidate.type === 'sketch',
          );
          if (!feature) return;
          store.apply({
            type: 'feature/replace',
            feature: {
              ...feature,
              plane: {
                type: 'face',
                bodyId: pick.bodyId,
                topoId: pick.faceId,
                offset: feature.plane.type === 'face' ? (feature.plane.offset ?? 0) : 0,
                frame: faceFrame(pick.origin, pick.normal),
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
          const planes = store.project.view.sectionPlanes;
          const plane = planes.find((candidate) => candidate.id === ui.pickingSectionFace);
          if (!plane) {
            ui.setPickingSectionFace(null);
            return;
          }
          // The face is remembered together with the pose it has right now, so a
          // face that later disappears still leaves the section where it was.
          const frame = sectionFaceFrame(
            useKernelStore.getState().meshes[pick.bodyId],
            pick.faceId,
          ) ?? {
            origin: pick.origin,
            normal: pick.normal,
          };
          store.setSectionPlanes(
            planes.map((candidate) =>
              candidate.id === plane.id
                ? {
                    ...candidate,
                    face: { bodyId: pick.bodyId, topoId: pick.faceId },
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
        if (edgePicking) {
          if (!pick) return;
          if (pick.kind === 'body-edge') {
            const mesh = useKernelStore.getState().meshes[pick.bodyId];
            const edge = mesh?.edges?.find((candidate) => candidate.id === pick.edgeId);
            const bisector = mesh && edge ? edgeBisector(mesh, edge.faceIds) : null;
            if (!mesh || !edge || !bisector) return;
            store.toggleEdgeTreatmentEdge(edgePicking, {
              bodyId: pick.bodyId,
              edgeId: pick.edgeId,
              faceIds: [...edge.faceIds],
              ...edgePose(edge.points),
              bisector,
            });
            return;
          }
          if (pick.kind === 'body-face') {
            if (!pick.planar) {
              ui.showToast('errors.FACE_NOT_PLANAR', 'error');
              return;
            }
            store.toggleEdgeTreatmentFace(edgePicking, {
              bodyId: pick.bodyId,
              faceId: pick.faceId,
              normal: pick.normal,
              origin: pick.origin,
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
            store.toggleExtrudeBodyFace(
              picking,
              pick.bodyId,
              pick.faceId,
              pick.normal,
              pick.origin,
            );
          }
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
        if (pick.kind === 'body' || pick.kind === 'body-face' || pick.kind === 'body-edge') {
          store.select({ kind: 'body', id: pick.kind === 'body' ? pick.id : pick.bodyId }, {
            additive,
          });
          return;
        }
        store.select(
          { kind: 'face', id: `${pick.sketchId}#${pick.faceId}` },
          { additive },
        );
      },
      (bodyId, x, y) => {
        if (!bodyId || useUiStore.getState().activeSketchId) return;
        const store = useDocumentStore.getState();
        const ref = store.project.bodies.find((candidate) => candidate.id === bodyId);
        if (!ref) return;
        // The menu acts on the selection when the body is part of it, and on the
        // clicked body otherwise.
        const selected = store.selection.some(
          (item) => (item.kind === 'body' || item.kind === 'mesh') && item.id === bodyId,
        );
        if (!selected) store.select({ kind: resolveBody(store.project, ref).kind === 'mesh' ? 'mesh' : 'body', id: bodyId });
        const targets = objectTargets(
          store.project,
          useDocumentStore.getState().selection,
        );
        const labels = translationRef.current;
        const items: ContextMenuItem[] = [];
        const color = colorMenuItem(targets, labels('context.color'));
        if (color) items.push(color);
        const visibility = visibilityMenuItem(targets, {
          hide: labels('tree.hide'),
          show: labels('tree.show'),
        });
        if (visibility) items.push(visibility);
        const remove = deleteMenuItem(
          targets,
          targets.length > 1
            ? labels('context.deleteSelected')
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
      },
      // A double click on a face opens the operation that produced it: the
      // shape a body currently has comes from the operation that last built it,
      // and a sketch face comes from the sketch operation itself.
      (pick) => {
        const ui = useUiStore.getState();
        // Selection controls own the mouse while they are active.
        if (
          ui.activeSketchId ||
          ui.pickingExtrude ||
          ui.pickingExtrudeBodies ||
          ui.pickingSketchPlane ||
          ui.pickingSectionFace
        ) {
          return;
        }
        if (isModelRebuilding(useKernelStore.getState())) return;
        const store = useDocumentStore.getState();
        const project = store.project;
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
        onSelectPick: (hit, additive) => {
          if (useUiStore.getState().activeSketchId) return;
          const store = useDocumentStore.getState();
          const resolution = resolveSelectionHit(hit, store.selection, { additive });
          if (!resolution) {
            store.select(null);
            return;
          }
          store.select(resolution.item, { additive: resolution.additive });
        },
        onHandleDrag: (event) => {
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
            });
            return;
          }
          const drag = quickDragRef.current;
          if (!drag) return;
          if (event.phase === 'move') {
            drag.update(event.value);
            setQuickChip({
              x: event.x,
              y: event.y,
              label: chipLabel(drag, translationRef.current),
              value: event.value,
            });
            return;
          }
          if (event.phase === 'end') drag.end();
          else drag.cancel();
          quickDragRef.current = null;
          setQuickChip(null);
        },
        onHandleHover: (event) =>
          setHandleHover(
            event ? { x: event.x, y: event.y, text: event.text } : null,
          ),
      },
    );
    controllerRef.current = controller;
    controller.setTheme(useThemeStore.getState().theme);

    const navCube = new NavCube(navCanvas, labelsRef.current, useThemeStore.getState().theme, {
      onView: (view) => controller.setView(view),
      onOrientation: (azimuth, polar) => controller.setOrientation(azimuth, polar),
      onOrbit: (deltaX, deltaY) => controller.orbitBy(deltaX, deltaY),
      onContextMenu: (x, y) => {
        const labels = translationRef.current;
        const sketchId = useUiStore.getState().activeSketchId;
        const sketchFeature = sketchId
          ? useDocumentStore
              .getState()
              .project.features.find(
                (feature): feature is SketchFeature =>
                  feature.type === 'sketch' && feature.id === sketchId,
              )
          : undefined;
        openMenuRef.current(x, y, [
          ...(sketchFeature
            ? [
                {
                  id: 'orient-sketch',
                  label: labels('nav.orientToSketch'),
                  icon: <ScanSquare size={14} />,
                  onSelect: () =>
                    controller.alignSketch(
                      computeSketchFrame(
                        sketchFeature,
                        sketchFeature.plane.type === 'face'
                          ? useKernelStore.getState().meshes[
                              sketchFeature.plane.bodyId ?? ''
                            ]
                          : undefined,
                      ),
                      sketchFeature.entities,
                    ),
                },
              ]
            : []),
          {
            id: 'fit',
            label: labels('topbar.fit'),
            icon: <ScanBox size={14} />,
            onSelect: () => controller.fit(),
          },
          {
            id: 'iso',
            label: labels('nav.iso'),
            onSelect: () => controller.setView('iso'),
          },
          ...(['front', 'back', 'left', 'right', 'top', 'bottom'] as const).map((view) => {
            const hint = AXIS_HINTS[view];
            return {
              id: view,
              label: labels(`nav.${view}`),
              hint: hint ? <span style={{ color: hint.color }}>{hint.text}</span> : undefined,
              onSelect: () => controller.setView(view),
            };
          }),
        ]);
      },
    });
    navCubeRef.current = navCube;
    const orientation = controller.getOrientation();
    navCube.sync(orientation.azimuth, orientation.polar);

    registerViewport({
      fit: () => controller.fit(),
      setView: (name) => controller.setView(name),
      setSketches: (sketches) => controller.setSketches(sketches),
      setSketchOverlay: (preview, draftPoints, highlight, marker) =>
        controller.setSketchOverlay(preview, draftPoints, highlight, marker),
      alignSketch: (frame, entities) => controller.alignSketch(frame, entities),
      getCameraState: () => controller.getCameraState(),
      setCameraState: (state) => controller.setCameraState(state),
      pickSketch: (x, y) => controller.pickSketch(x, y),
      snapSketch: (x, y, tolerance) => controller.snapSketch(x, y, tolerance),
      projectSketchPoint: (frame, point) => controller.projectSketchPoint(frame, point),
      getHandles: () => controller.getHandles(),
      getGhosts: () => controller.getGhosts(),
    });

    return () => {
      registerViewport(null);
      navCube.dispose();
      navCubeRef.current = null;
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    const marks = new Map((preview?.bodies ?? []).map((mark) => [mark.id, mark]));
    const sceneBodies: SceneBody[] = [];
    for (const body of bodies) {
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
        visible: body.visible,
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
    // Bodies the edited operation will create are shown translucent and cannot
    // be picked: they are not part of the document yet.
    for (const mark of preview?.bodies ?? []) {
      if (mark.kind !== 'added') continue;
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
        ghost: 'added',
        interactive: false,
      });
    }

    const selectedFeature =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const extrude = selectedFeature?.type === 'extrude' ? selectedFeature : undefined;
    const errorBodyIds = extrude ? Object.keys(featureBodyErrors[extrude.id] ?? {}) : [];
    const targetBodyIds = extrude && extrude.op !== 'new' ? extrude.bodyIds : [];
    controller.setBodies(
      sceneBodies,
      directBodyIds(selection),
      [...new Set([...linkedBodyIds(selection, project), ...targetBodyIds])],
      errorBodyIds,
    );
    controller.setGhosts(preview?.ghosts ?? []);
    controller.setTreatmentMarks(preview?.faceMarks ?? []);
    if (!activeSketchId && previousCount.current === 0 && sceneBodies.length > 0) {
      controller.fit();
    }
    previousCount.current = sceneBodies.length;
  }, [activeSketchId, bodies, meshes, preview, project, selection, featureBodyErrors]);

  // Which bodies are open for detail picking, and which sketch shows regions.
  useEffect(() => {
    controllerRef.current?.setSelectionDetail({
      bodyIds: drilledBodyIds(selection),
      sketchId: selectedSketchId ?? null,
    });
  }, [selection, selectedSketchId]);

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
    const treatment =
      selectedFeature?.type === 'edge-treatment' ? selectedFeature : undefined;
    const errors = extrude
      ? (featureBodyErrors[extrude.id] ?? {})
      : treatment
        ? (featureBodyErrors[treatment.id] ?? {})
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
        const key = `b:${ref.bodyId}#${ref.faceId}`;
        if (errors[ref.bodyId]) invalid.push(key);
        else selected.push(key);
      }
    }
    for (const ref of treatment?.faceRefs ?? []) {
      const key = `b:${ref.bodyId}#${ref.faceId}`;
      if (errors[ref.bodyId]) invalid.push(key);
      else selected.push(key);
    }
    const planeSketch = selectedFeature?.type === 'sketch' ? selectedFeature : undefined;
    if (planeSketch?.plane.type === 'face' && planeSketch.plane.bodyId && planeSketch.plane.topoId) {
      selected.push(`b:${planeSketch.plane.bodyId}#${planeSketch.plane.topoId}`);
    }
    controller.setFaceHighlights({
      selected,
      invalid,
      picking:
        Boolean(pickingExtrude) ||
        Boolean(pickingEdges) ||
        Boolean(pickingSketchPlane) ||
        Boolean(pickingSectionFace),
      bodyPicking: Boolean(pickingExtrudeBodies),
      edgePicking: Boolean(pickingEdges),
      bodyFacesOnly: Boolean(pickingSketchPlane) || Boolean(pickingSectionFace),
    });
  }, [
    selection,
    project,
    featureBodyErrors,
    pickingExtrude,
    pickingExtrudeBodies,
    pickingSketchPlane,
    pickingSectionFace,
    pickingEdges,
    boundExtrude,
  ]);

  useEffect(() => {
    const selectedFeature =
      selection.length === 1 && selection[0]?.kind === 'feature'
        ? project.features.find((feature) => feature.id === selection[0]?.id)
        : undefined;
    const treatment =
      selectedFeature?.type === 'edge-treatment' ? selectedFeature : undefined;
    controllerRef.current?.setEdgeHighlights([
      ...selection.filter((item) => item.kind === 'edge').map((item) => item.id),
      ...(treatment?.edgeRefs ?? []).map((ref) => `${ref.bodyId}#${ref.edgeId}`),
    ]);
  }, [selection, meshes, project]);

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
    const planes = sketchSection ? [sketchSection, ...resolved] : resolved;
    controllerRef.current?.setSection(sectionEnabled ? planes : []);
  }, [sketchSectionKey, sectionEnabled, sectionPlanes, meshes]);

  useEffect(() => {
    const ids = activeFeatureIds(project);
    // The edited operation is previewed on top of the cursor state, so a sketch
    // that is being configured or edited is drawn from that preview.
    const previewedId = preview?.featureId ?? null;
    const sketches = project.features
      .filter(
        (feature): feature is SketchFeature =>
          feature.type === 'sketch' &&
          (ids.has(feature.id) || feature.id === previewedId) &&
          sketchPlaneReady(feature) &&
          !featureErrors[feature.id] &&
          (feature.id !== activeSketchId || activeSketchReady) &&
          (objectVisible(project, sketchObjectId(feature.id)) || feature.id === activeSketchId),
      )
      .map((feature) => ({
        id: feature.id,
        color: objectColor(project, sketchObjectId(feature.id), SKETCH_COLOR),
        showConstruction: objectShowConstruction(project, sketchObjectId(feature.id)),
        faces: sketchTopology(feature.entities).faces.map((face) => ({
          id: face.id,
          outline: face.outline,
          holes: face.holeOutlines,
        })),
        facesPicking: Boolean(pickingExtrude) || feature.id === selectedSketchId,
        frame:
          feature.id === activeSketchId && activeSketchReady
            ? computeSketchFrame(
                feature,
                feature.plane.type === 'face' ? meshes[feature.plane.bodyId ?? ''] : undefined,
              )
            : sketchFrameOf(feature, sketchFrames[feature.id]),
        entities: feature.entities,
        selectionKeys: feature.id === activeSketchId ? sketchSelectionIds : [],
        dimmedEntityIds:
          feature.id === activeSketchId
            ? (() => {
                const constraint = feature.constraints.find(
                  (candidate) => candidate.id === sketchConstraintId,
                );
                if (!constraint) return [];
                const related = new Set(constraint.refs.map((ref) => ref.entityId));
                return feature.entities
                  .filter((entity) => !related.has(entity.id))
                  .map((entity) => entity.id);
              })()
            : [],
        frozenEntityIds: feature.id === activeSketchId ? sketchFrozenEntityIds : [],
        highlightIds: feature.id === activeSketchId ? sketchAutoHighlightIds : [],
        active: feature.id === activeSketchId,
      }));
    getViewport()?.setSketches(sketches);
  }, [
    activeSketchId,
    project,
    sketchSelectionIds,
    sketchConstraintId,
    sketchFrozenEntityIds,
    sketchAutoHighlightIds,
    pickingExtrude,
    featureErrors,
    sketchFrames,
    activeSketchReady,
    meshes,
    preview,
    selectedSketchId,
  ]);

  useEffect(() => {
    navCubeRef.current?.setLabels(navLabels);
  }, [t]);

  const showLoading = status === 'idle' || status === 'loading';
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
            {formatNumber(Math.abs(quickChip.value), i18n.language, 1)} mm
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

      <div className="viewport-nav">
        <Tooltip content={t('nav.hint')}>
          <canvas
            ref={navCubeCanvasRef}
            className="nav-cube-canvas"
            aria-label={t('nav.cube')}
            data-testid="nav-cube"
          />
        </Tooltip>
      </div>

      {/* The kernel reports its own progress in the status bar. */}
      {showLoading && (
        <SkeletonStage action={t('status.kernelLoading')} testId="viewport-skeleton" />
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

      <SketchAnnotations />
      <SketchEditor />
    </div>
  );
}
