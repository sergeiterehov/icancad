import { activeModel, type PrimitiveFeature, type Project, type Vec3 } from '@icancad/model';
import { useDocumentStore } from '../stores/documentStore';
import {
  PYRAMID_MAX_SIDES,
  PYRAMID_MIN_SIDES,
  primitiveGizmoOrigin,
  primitiveParamValue,
  withPrimitiveParam,
  type PrimitiveSizeKey,
} from '../primitive/params';
import { snapLength } from './handleDrag';
import type {
  OperationHandle,
  OperationHandleContext,
  OperationHandleDrag,
} from './operationHandles';

const AXIS_DIRECTIONS: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** How long the translation arrows are, in screen pixels. */
const MOVE_ARROW_PX = 96;

type PrimitiveDragTarget =
  | { kind: 'position-axis'; axis: 0 | 1 | 2; label: string }
  | { kind: 'position-plane'; label: string }
  | { kind: 'sides'; label: string }
  | {
      kind: 'size';
      key: PrimitiveSizeKey;
      paramScale: number;
      displayScale: number;
      label: string;
    };

interface PrimitiveSizeSpec {
  key: PrimitiveSizeKey;
  origin: Vec3;
  direction: Vec3;
  /** Length the arrow draws, in model units. */
  drawValue: number;
  /** Stored parameter is the dragged value multiplied by this. */
  paramScale: number;
  /** Shown value is the parameter multiplied by this (diameters show 2). */
  displayScale: number;
  tooltip: string;
}

function selectedPrimitive(context: OperationHandleContext): PrimitiveFeature | undefined {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return undefined;
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  return feature?.type === 'primitive' && !feature.suppressed ? feature : undefined;
}

function primitiveSizeSpecs(
  feature: PrimitiveFeature,
  labels: OperationHandleContext['labels'],
): PrimitiveSizeSpec[] {
  const [x, y, z] = feature.transform.translation;
  switch (feature.kind) {
    case 'box':
      return [
        {
          key: 'dx',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.dx,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.width,
        },
        {
          key: 'dy',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.y,
          drawValue: feature.params.dy,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.depth,
        },
        {
          key: 'dz',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.dz,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.height,
        },
      ];
    case 'sphere':
      return [
        {
          key: 'radius',
          origin: [x - feature.params.radius, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.radius * 2,
          paramScale: 0.5,
          displayScale: 2,
          tooltip: labels.diameter,
        },
      ];
    case 'cylinder':
      return [
        {
          key: 'radius',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.radius,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.radius,
        },
        {
          key: 'height',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.height,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.height,
        },
      ];
    case 'cone':
      return [
        {
          key: 'bottomRadius',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.bottomRadius,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.bottomRadius,
        },
        {
          key: 'height',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.height,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.height,
        },
        {
          key: 'topRadius',
          origin: [x, y, z + feature.params.height],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.topRadius,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.topRadius,
        },
      ];
    case 'torus':
      return [
        {
          key: 'majorRadius',
          origin: [x - feature.params.majorRadius, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.majorRadius * 2,
          paramScale: 0.5,
          displayScale: 2,
          tooltip: labels.ringDiameter,
        },
        {
          key: 'tubeRadius',
          origin: [x + feature.params.majorRadius, y, z - feature.params.tubeRadius],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.tubeRadius * 2,
          paramScale: 0.5,
          displayScale: 2,
          tooltip: labels.tubeDiameter,
        },
      ];
    case 'pyramid': {
      // +X points at an edge centre, so the radius arrow goes to the other
      // adjacent vertex; the first vertex near +X carries the side-count grip.
      const radiusAngle = -Math.PI / feature.params.sides;
      return [
        {
          key: 'radius',
          origin: [x, y, z],
          direction: [Math.cos(radiusAngle), Math.sin(radiusAngle), 0],
          drawValue: feature.params.radius,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.baseRadius,
        },
        {
          key: 'height',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.height,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.height,
        },
      ];
    }
    case 'capsule':
      return [
        {
          key: 'radius',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.x,
          drawValue: feature.params.radius,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.radius,
        },
        {
          key: 'height',
          origin: [x, y, z],
          direction: AXIS_DIRECTIONS.z,
          drawValue: feature.params.height,
          paramScale: 1,
          displayScale: 1,
          tooltip: labels.height,
        },
      ];
  }
}

/** Handles of one selected primitive: a move gizmo plus its size arrows. */
export function primitiveHandles(context: OperationHandleContext): OperationHandle[] {
  const feature = selectedPrimitive(context);
  if (!feature) return [];
  const origin = primitiveGizmoOrigin(feature);
  const handles: OperationHandle[] = primitiveSizeSpecs(feature, context.labels).map((spec) => ({
    id: `primitive:${feature.id}:${spec.key}`,
    origin: spec.origin,
    direction: spec.direction,
    value: spec.drawValue,
    enabled: true,
    thickness: 1.2,
    tooltip: spec.tooltip,
    shaft: 'dashed',
    tipOnly: true,
    beginDrag: () => {
      const drag = new PrimitiveDrag(feature.id, {
        kind: 'size',
        key: spec.key,
        paramScale: spec.paramScale,
        displayScale: spec.displayScale,
        label: spec.tooltip,
      });
      drag.start();
      return drag;
    },
  }));

  const axisLabels = [context.labels.moveX, context.labels.moveY, context.labels.moveZ] as const;
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    handles.push({
      id: `primitive:${feature.id}:move:${axis}`,
      origin,
      direction: AXIS_DIRECTIONS[axis],
      value: 0,
      enabled: true,
      thickness: 1,
      axis,
      fixedLengthPx: MOVE_ARROW_PX,
      tooltip: axisLabels[index]!,
      beginDrag: () => {
        const drag = new PrimitiveDrag(feature.id, {
          kind: 'position-axis',
          axis: index as 0 | 1 | 2,
          label: `${context.labels.moveLabel} ${axis.toUpperCase()}`,
        });
        drag.start();
        return drag;
      },
    });
  });

  handles.push({
    id: `primitive:${feature.id}:move:plane`,
    origin,
    direction: AXIS_DIRECTIONS.z,
    value: 0,
    enabled: true,
    kind: 'move',
    tooltip: context.labels.move,
    beginDrag: () => {
      const drag = new PrimitiveDrag(feature.id, {
        kind: 'position-plane',
        label: context.labels.moveLabel,
      });
      drag.start();
      return drag;
    },
  });

  if (feature.kind === 'pyramid') {
    const sides = feature.params.sides;
    handles.push({
      id: `primitive:${feature.id}:sides`,
      origin: feature.transform.translation,
      direction: AXIS_DIRECTIONS.x,
      value: 180 / sides,
      enabled: true,
      thickness: 1,
      tooltip: context.labels.sidesTooltip,
      orbit: {
        axis: AXIS_DIRECTIONS.z,
        center: feature.transform.translation,
        reference: AXIS_DIRECTIONS.x,
        angle: Math.PI / sides,
        radius: feature.params.radius,
      },
      beginDrag: () => {
        const drag = new PrimitiveDrag(feature.id, {
          kind: 'sides',
          label: context.labels.sides,
        });
        drag.start();
        return drag;
      },
    });
  }

  return handles;
}

/** One handle gesture: a size change or a translation, as a single undo step. */
class PrimitiveDrag implements OperationHandleDrag {
  private before: Project | null = null;
  private original: PrimitiveFeature | null = null;
  private changed = false;
  private currentValue = 0;

  constructor(
    private readonly featureId: string,
    private readonly target: PrimitiveDragTarget,
  ) {}

  get op(): null {
    return null;
  }

  get kind(): null {
    return null;
  }

  get value(): number {
    return this.currentValue;
  }

  get label(): string {
    return this.target.label;
  }

  get unit(): 'count' | undefined {
    return this.target.kind === 'sides' ? 'count' : undefined;
  }

  start(): void {
    const state = useDocumentStore.getState();
    this.before = state.project;
    const feature = activeModel(state.project).features.find(
      (candidate): candidate is PrimitiveFeature =>
        candidate.id === this.featureId && candidate.type === 'primitive',
    );
    this.original = feature ?? null;
    this.changed = false;
    this.currentValue =
      feature && this.target.kind === 'size'
        ? snapLength(primitiveParamValue(feature, this.target.key) * this.target.displayScale)
        : feature && this.target.kind === 'sides' && feature.kind === 'pyramid'
          ? feature.params.sides
          : 0;
  }

  update(value: number, _shift?: boolean, move?: Vec3): void {
    if (!this.before || !this.original) return;
    const state = useDocumentStore.getState();
    const feature = activeModel(state.project).features.find(
      (candidate): candidate is PrimitiveFeature =>
        candidate.id === this.featureId && candidate.type === 'primitive',
    );
    if (!feature) return;

    if (this.target.kind === 'position-axis') {
      const translation: Vec3 = [...this.original.transform.translation];
      translation[this.target.axis] = snapLength(translation[this.target.axis] + value);
      state.preview({
        type: 'feature/replace',
        feature: { ...feature, transform: { ...feature.transform, translation } },
      });
      this.currentValue = snapLength(Math.abs(value));
    } else if (this.target.kind === 'position-plane') {
      if (!move) return;
      const base = this.original.transform.translation;
      const translation: Vec3 = [
        snapLength(base[0] + move[0]),
        snapLength(base[1] + move[1]),
        snapLength(base[2] + move[2]),
      ];
      state.preview({
        type: 'feature/replace',
        feature: { ...feature, transform: { ...feature.transform, translation } },
      });
      this.currentValue = snapLength(Math.hypot(move[0], move[1], move[2]));
    } else if (this.target.kind === 'sides') {
      // The grip is dragged around the base circle: a small angle from +X
      // means a dense polygon, a large angle near the edge midpoint means few
      // sides. Snapping N makes the grip move discretely.
      const angle = Math.max(
        180 / PYRAMID_MAX_SIDES,
        Math.min(180 / PYRAMID_MIN_SIDES, Math.abs(value)),
      );
      const sides = Math.min(
        PYRAMID_MAX_SIDES,
        Math.max(PYRAMID_MIN_SIDES, Math.round(180 / angle)),
      );
      const next = withPrimitiveParam(feature, 'sides', sides);
      state.preview({ type: 'feature/replace', feature: next });
      this.currentValue = primitiveParamValue(next, 'sides');
    } else {
      const next = withPrimitiveParam(
        feature,
        this.target.key,
        snapLength(value) * this.target.paramScale,
      );
      state.preview({ type: 'feature/replace', feature: next });
      this.currentValue = snapLength(
        primitiveParamValue(next, this.target.key) * this.target.displayScale,
      );
    }
    this.changed = true;
  }

  end(): void {
    if (this.changed && this.before) {
      useDocumentStore.getState().commitPreview(this.before);
    }
    this.reset();
  }

  cancel(): void {
    if (this.original) {
      useDocumentStore.getState().preview({
        type: 'feature/replace',
        feature: this.original,
      });
    }
    this.reset();
  }

  private reset(): void {
    this.before = null;
    this.original = null;
    this.changed = false;
    this.currentValue = 0;
  }
}
