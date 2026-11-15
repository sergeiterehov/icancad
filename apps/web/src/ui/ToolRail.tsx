import { activeModel, type PrimitiveKind, type SketchFeature } from '@icancad/model';
import {
  Box,
  Circle,
  Cone,
  Cylinder,
  Torus,
  Hexagon,
  Pill,
  Pyramid,
  Shapes,
  Square,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { edgeTreatmentTargetFromSelection } from '../quick/edgeTreatment';
import { shellInputFromSelection } from '../quick/shell';
import { sketchPlaneFromSelection } from '../sketch/facePlane';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { useContextMenuStore } from './ContextMenu';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { EdgeToolIcon } from './edgeIcons';
import { ShellIcon, SketchIcon } from './featureIcons';
import { SectionTool } from './SectionTool';

// Extrude works on a whole sketch or on the faces selected inside one sketch.
function extrudeInput(
  selection: ReturnType<typeof useDocumentStore.getState>['selection'],
  project: ReturnType<typeof useDocumentStore.getState>['project'],
): { sketchId: string; regions: string[] } | null {
  if (selection.length === 0) return null;
  if (selection.every((item) => item.kind === 'sketch')) {
    return selection.length === 1 ? { sketchId: selection[0]!.id, regions: [] } : null;
  }
  if (selection.every((item) => item.kind === 'face')) {
    const [sketchId] = selection[0]!.id.split('#');
    if (!sketchId) return null;
    if (selection.some((item) => item.id.split('#')[0] !== sketchId)) return null;
    const regions = selection.map((item) => item.id.split('#')[1] ?? '').filter(Boolean);
    return regions.length > 0 ? { sketchId, regions } : null;
  }
  void project;
  return null;
}

export function ToolRail() {
  const { t } = useTranslation();
  const activeSketchId = useUiStore((state) => state.activeSketchId);
  const setActiveSketch = useUiStore((state) => state.setActiveSketch);
  const startSketchPlanePicking = useUiStore((state) => state.startSketchPlanePicking);
  const addSketch = useDocumentStore((state) => state.addSketch);
  const addSketchOnFace = useDocumentStore((state) => state.addSketchOnFace);
  const addExtrude = useDocumentStore((state) => state.addExtrude);
  const addEdgeTreatment = useDocumentStore((state) => state.addEdgeTreatment);
  const addShell = useDocumentStore((state) => state.addShell);
  const addPrimitive = useDocumentStore((state) => state.addPrimitive);
  const project = useDocumentStore((state) => state.project);
  const selection = useDocumentStore((state) => state.selection);
  const sketchSelection = extrudeInput(selection, project);
  const openMenu = useContextMenuStore((state) => state.open);

  const openSketchMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sideHint = { XY: 'sideTop', XZ: 'sideFront', YZ: 'sideRight' } as const;
    openMenu(rect.left, rect.bottom + 6, [
      {
        id: 'face',
        label: t('sketch.chooseFace'),
        icon: <Hexagon size={14} />,
        onSelect: () => {
          // The new sketch takes over the selection, so read the selected face
          // first: it becomes the plane without another pick.
          const plane = sketchPlaneFromSelection(
            useDocumentStore.getState().selection,
            useKernelStore.getState().meshes,
          );
          const sketchId = addSketchOnFace(t('features.sketch'));
          if (!sketchId) return;
          const store = useDocumentStore.getState();
          const sketch = activeModel(store.project).features.find(
            (feature): feature is SketchFeature =>
              feature.type === 'sketch' && feature.id === sketchId,
          );
          if (
            !sketch ||
            !plane ||
            !store.apply({
              type: 'feature/replace',
              feature: {
                ...sketch,
                plane: {
                  type: 'face',
                  bodyId: plane.bodyId,
                  topoId: plane.faceId,
                  offset: 0,
                  frame: plane.frame,
                },
              },
            })
          ) {
            startSketchPlanePicking(sketchId, true);
            return;
          }
          useKernelStore.getState().clearFeatureError(sketchId);
          useUiStore.getState().setActiveSketch(sketchId);
        },
      },
      ...(['XY', 'XZ', 'YZ'] as const).map((plane) => ({
        id: plane,
        label: t(`sketch.${sideHint[plane]}`),
        hint: plane,
        ariaLabel: `${t(`sketch.${sideHint[plane]}`)} · ${t(`sketch.plane${plane}`)}`,
        icon: <Square size={14} />,
        onSelect: () => {
          const sketchId = addSketch(t('features.sketch'), plane);
          if (sketchId) setActiveSketch(sketchId);
        },
      })),
    ]);
  };

  const openPrimitiveMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const create = (
      kind: PrimitiveKind,
      labelKey:
        | 'features.cube'
        | 'features.sphere'
        | 'features.cylinder'
        | 'features.cone'
        | 'features.torus'
        | 'features.pyramid'
        | 'features.capsule',
    ) => {
      addPrimitive(t(labelKey), kind);
    };
    openMenu(rect.left, rect.bottom + 6, [
      {
        id: 'box',
        label: t('features.cube'),
        icon: <Box size={14} />,
        onSelect: () => create('box', 'features.cube'),
      },
      {
        id: 'sphere',
        label: t('features.sphere'),
        icon: <Circle size={14} />,
        onSelect: () => create('sphere', 'features.sphere'),
      },
      {
        id: 'cylinder',
        label: t('features.cylinder'),
        icon: <Cylinder size={14} />,
        onSelect: () => create('cylinder', 'features.cylinder'),
      },
      {
        id: 'cone',
        label: t('features.cone'),
        icon: <Cone size={14} />,
        onSelect: () => create('cone', 'features.cone'),
      },
      {
        id: 'torus',
        label: t('features.torus'),
        icon: <Torus size={14} />,
        onSelect: () => create('torus', 'features.torus'),
      },
      {
        id: 'pyramid',
        label: t('features.pyramid'),
        icon: <Pyramid size={14} />,
        onSelect: () => create('pyramid', 'features.pyramid'),
      },
      {
        id: 'capsule',
        label: t('features.capsule'),
        icon: <Pill size={14} />,
        onSelect: () => create('capsule', 'features.capsule'),
      },
    ]);
  };

  return (
    <nav className="tool-rail" aria-label={t('panels.tools')}>
      <IconButton
        label={t('tools.sketch')}
        active={Boolean(activeSketchId)}
        onClick={openSketchMenu}
      >
        <SketchIcon size={17} />
      </IconButton>

      <div className="tool-separator" />

      <IconButton
        label={t('tools.extrude')}
        tooltip={t('tools.extrude')}
        onClick={() => addExtrude(t('features.extrude'), sketchSelection ?? undefined)}
      >
        <Box size={17} />
      </IconButton>

      <IconButton
        label={t('tools.shell')}
        tooltip={t('tools.shell')}
        onClick={() => {
          const store = useDocumentStore.getState();
          const input = shellInputFromSelection(
            activeModel(store.project),
            store.selection,
            useKernelStore.getState().meshes,
          );
          const id = addShell(t('features.shell'), input ?? undefined);
          if (id && !input) useUiStore.getState().setPickingShellBodies(id);
        }}
      >
        <ShellIcon size={17} />
      </IconButton>

      <IconButton
        label={t('tools.edgeTreatment')}
        tooltip={t('tools.edgeTreatment')}
        onClick={() => {
          const store = useDocumentStore.getState();
          const input = edgeTreatmentTargetFromSelection(
            activeModel(store.project),
            store.selection,
            useKernelStore.getState().meshes,
          );
          const id = addEdgeTreatment(t('features.edgeTreatment'), input ?? undefined);
          if (id && !input) useUiStore.getState().setPickingEdges(id);
        }}
      >
        <EdgeToolIcon size={17} />
      </IconButton>

      <IconButton
        label={t('tools.primitives')}
        tooltip={t('tools.primitives')}
        onClick={openPrimitiveMenu}
      >
        <Shapes size={17} />
      </IconButton>

      <div className="tool-separator" />

      <SectionTool />
    </nav>
  );
}
