import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { retryKernel } from '../kernel/client';
import { activeFeatureIds, type SketchFeature } from '@icancad/model';
import { datumFrame } from '@icancad/sketch';
import { useDocumentStore } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { useKernelStore } from '../stores/kernelStore';
import { directBodyIds, linkedBodyIds } from '../stores/selection';
import { useThemeStore } from '../stores/themeStore';
import { Button } from '../ui/Controls';
import { showContextMenu, useContextMenuStore } from '../ui/ContextMenu';
import { Tooltip } from '../ui/Tooltip';
import { NavCube, type NavFace } from './NavCube';
import { SceneController, type SceneBody } from './SceneController';
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

export function Viewport() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navCubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const navCubeRef = useRef<NavCube | null>(null);
  const previousCount = useRef(0);

  const project = useDocumentStore((state) => state.project);
  const bodies = project.bodies;
  const sectionPlanes = project.view.sectionPlanes;
  const sectionEnabled = useUiStore((state) => state.sectionEnabled);
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const sketchConstraintId = useUiStore((state) => state.sketchConstraintId);
  const sketchFrozenEntityIds = useUiStore((state) => state.sketchFrozenEntityIds);
  const sketchAutoHighlightIds = useUiStore((state) => state.sketchAutoHighlightIds);
  const sketchSelectionIds = useUiStore((state) => state.sketchSelectionIds);
  const selection = useDocumentStore((state) => state.selection);
  const meshes = useKernelStore((state) => state.meshes);
  const status = useKernelStore((state) => state.status);
  const ratio = useKernelStore((state) => state.ratio);
  const error = useKernelStore((state) => state.error);
  const theme = useThemeStore((state) => state.theme);
  const openMenu = useContextMenuStore((state) => state.open);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const navCanvas = navCubeCanvasRef.current;
    if (!canvas || !container || !navCanvas) return;

    const controller = new SceneController(
      canvas,
      container,
      (bodyId, additive) => {
        if (useUiStore.getState().activeSketchId) return;
        const store = useDocumentStore.getState();
        if (!bodyId) store.select(null);
        else store.select({ kind: 'body', id: bodyId }, { additive });
      },
      (bodyId, x, y) => {
        if (!bodyId || useUiStore.getState().activeSketchId) return;
        const store = useDocumentStore.getState();
        const body = store.project.bodies.find((candidate) => candidate.id === bodyId);
        if (!body) return;
        const labels = translationRef.current;
        showContextMenu({ clientX: x, clientY: y, preventDefault: () => undefined }, [
          {
            id: 'visibility',
            label: body.visible ? labels('tree.hide') : labels('tree.show'),
            icon: body.visible ? <EyeOff size={14} /> : <Eye size={14} />,
            onSelect: () => store.toggleBodyVisibility(body.id),
          },
          {
            id: 'delete',
            label: labels('context.deleteOperation'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => store.removeFeature(body.createdBy),
          },
        ]);
      },
      (azimuth, polar) => {
        navCubeRef.current?.sync(azimuth, polar);
        if (navCubeCanvasRef.current) {
          navCubeCanvasRef.current.dataset.azimuth = String(azimuth);
          navCubeCanvasRef.current.dataset.polar = String(polar);
        }
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
        openMenuRef.current(x, y, [
          {
            id: 'fit',
            label: labels('topbar.fit'),
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
      setSketchOverlay: (preview, draftPoints, highlight) =>
        controller.setSketchOverlay(preview, draftPoints, highlight),
      alignSketch: (frame) => controller.alignSketch(frame),
      getCameraState: () => controller.getCameraState(),
      setCameraState: (state) => controller.setCameraState(state),
      pickSketch: (x, y) => controller.pickSketch(x, y),
      snapSketch: (x, y, tolerance) => controller.snapSketch(x, y, tolerance),
      projectSketchPoint: (frame, point) => controller.projectSketchPoint(frame, point),
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

    const sceneBodies: SceneBody[] = [];
    for (const body of bodies) {
      const mesh = meshes[body.id];
      if (!mesh) continue;
      sceneBodies.push({
        id: body.id,
        mesh,
        color: body.color,
        visible: body.visible,
      });
    }

    controller.setBodies(sceneBodies, directBodyIds(selection), linkedBodyIds(selection, project));
    if (previousCount.current === 0 && sceneBodies.length > 0) {
      controller.fit();
    }
    previousCount.current = sceneBodies.length;
  }, [bodies, meshes, project, selection]);

  useEffect(() => {
    controllerRef.current?.setTheme(theme);
    navCubeRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    controllerRef.current?.setSection(sectionEnabled ? sectionPlanes : []);
  }, [activeSketchId, sectionEnabled, sectionPlanes]);

  useEffect(() => {
    const ids = activeFeatureIds(project);
    const sketches = project.features
      .filter(
        (feature): feature is SketchFeature =>
          feature.type === 'sketch' &&
          ids.has(feature.id) &&
          (feature.visible !== false || feature.id === activeSketchId),
      )
      .map((feature) => ({
        id: feature.id,
        frame:
          feature.plane.type === 'datum'
            ? datumFrame(feature.plane.plane, feature.plane.offset)
            : (feature.plane.frame ?? datumFrame('XY', 0)),
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
  ]);

  useEffect(() => {
    navCubeRef.current?.setLabels(navLabels);
  }, [t]);

  const meshCount = Object.keys(meshes).length;
  const showLoading = status === 'idle' || status === 'loading';
  const showError = status === 'error';
  const hasActiveSketches = project.features.some(
    (feature) => feature.type === 'sketch' && activeFeatureIds(project).has(feature.id),
  );
  const showEmpty = status === 'ready' && meshCount === 0 && !activeSketchId && !hasActiveSketches;

  return (
    <div className="viewport-wrap" ref={containerRef}>
      <canvas ref={canvasRef} className="viewport-canvas" data-testid="viewport-canvas" />

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

      {showLoading && (
        <div className="empty-card">
          <h2>{t('empty.loadingTitle')}</h2>
          <p>{t('empty.loadingDescription')}</p>
          <div className="progress">
            <div
              className="progress-fill"
              data-indeterminate={ratio === undefined}
              style={ratio !== undefined ? { width: `${Math.round(ratio * 100)}%` } : undefined}
            />
          </div>
          {ratio !== undefined && (
            <span className="progress-label">{Math.round(ratio * 100)}%</span>
          )}
        </div>
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

      {showEmpty && (
        <div className="empty-card">
          <h2>{t('empty.title')}</h2>
          <p>{t('empty.description')}</p>
        </div>
      )}

      <SketchAnnotations />
      <SketchEditor />
    </div>
  );
}
