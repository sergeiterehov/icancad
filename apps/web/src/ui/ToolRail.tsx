import { activeModel, type PrimitiveKind, type SketchFeature } from '@icancad/model';
import {
  Blend,
  Circle,
  Cone,
  Cuboid,
  Cylinder,
  Torus,
  LayersArrowUp,
  Hexagon,
  Pill,
  Pyramid,
  Shapes,
  Square,
  SquareStack,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { arrayInputFromSelection } from '../quick/array';
import { booleanInputFromSelection } from '../quick/boolean';
import { edgeTreatmentTargetFromSelection } from '../quick/edgeTreatment';
import { extrudeInputFromSelection } from '../quick/extrude';
import { shellInputFromSelection } from '../quick/shell';
import { sketchPlaneFromSelection } from '../sketch/facePlane';
import { useDocumentStore } from '../stores/documentStore';
import { useKernelStore } from '../stores/kernelStore';
import { toggleContextMenu } from './ContextMenu';
import { useUiStore } from '../stores/uiStore';
import { IconButton } from './Controls';
import { EdgeToolIcon } from './edgeIcons';
import { ShellIcon, SketchIcon } from './featureIcons';
import { SectionTool } from './SectionTool';

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
  const addBoolean = useDocumentStore((state) => state.addBoolean);
  const addArray = useDocumentStore((state) => state.addArray);
  const addPrimitive = useDocumentStore((state) => state.addPrimitive);
  const openSketchMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sideHint = { XY: 'sideTop', XZ: 'sideFront', YZ: 'sideRight' } as const;
    toggleContextMenu('sketch-menu', rect.left, rect.bottom + 6, [
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
                  name: plane.name,
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
    toggleContextMenu('primitive-menu', rect.left, rect.bottom + 6, [
      {
        id: 'box',
        label: t('features.cube'),
        icon: <Cuboid size={14} />,
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
      {/* What is drawn first, then what is built from it, then what is done to
          the result (ADR 0030). */}
      <IconButton
        label={t('tools.sketch')}
        active={Boolean(activeSketchId)}
        data-menu-trigger="sketch-menu"
        onClick={openSketchMenu}
      >
        <SketchIcon size={17} />
      </IconButton>

      <div className="tool-separator" />

      <IconButton
        label={t('tools.primitives')}
        tooltip={t('tools.primitives')}
        data-menu-trigger="primitive-menu"
        onClick={openPrimitiveMenu}
      >
        <Shapes size={17} />
      </IconButton>

      <IconButton
        label={t('tools.extrude')}
        tooltip={t('tools.extrude')}
        onClick={() => {
          const store = useDocumentStore.getState();
          const input = extrudeInputFromSelection(
            activeModel(store.project),
            store.selection,
            useKernelStore.getState().meshes,
          );
          addExtrude(t('features.extrude'), input ?? undefined);
        }}
      >
        <LayersArrowUp size={17} />
      </IconButton>

      <IconButton
        label={t('tools.array')}
        tooltip={t('tools.array')}
        onClick={() => {
          const store = useDocumentStore.getState();
          const input = arrayInputFromSelection(activeModel(store.project), store.selection);
          // A picked body or operation is what the array repeats, so it opens
          // configured; only an empty one has to ask for its input.
          addArray(t('features.array'), input ?? undefined);
        }}
      >
        <SquareStack size={17} />
      </IconButton>

      <div className="tool-separator" />

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
        label={t('tools.boolean')}
        tooltip={t('tools.boolean')}
        onClick={() => {
          // The first picked body starts the first list and every later one goes
          // to the second: a two-body selection creates a ready operation.
          const store = useDocumentStore.getState();
          const input = booleanInputFromSelection(activeModel(store.project), store.selection);
          addBoolean(t('features.boolean'), input);
        }}
      >
        <Blend size={17} />
      </IconButton>

      <div className="tool-separator" />

      <SectionTool />
    </nav>
  );
}
