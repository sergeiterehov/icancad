import {
  activeModel,
  isDriven,
  type ParamVec3,
  type Project,
  type Resolved,
  type Transform,
  type SketchEntity,
  type SketchFeature,
  type SketchFrame,
  type TransformFeature,
  type Vec3,
} from '@icancad/model';
import type { TessellationResult } from '@icancad/kernel';
import type { Matrix3x4 } from '../kernel/array';
import {
  axisRotation,
  multiplyRotation,
  rotatePoint,
  rotationAngles,
  transformMatrix,
  transformPoint,
  transformRotation,
  transformSketchGeometry,
  transposeRotation,
  unrotatePoint,
  type Matrix3x3,
} from '../kernel/transformPlacement';
import { placementDelta, transformMesh } from '../kernel/transformPreview';
import { useDocumentStore } from '../stores/documentStore';
import { resolvedFeatureFor } from '../stores/formulaStore';
import { useKernelStore } from '../stores/kernelStore';
import { snapAngle, snapLength } from './handleDrag';
import { scalePercent } from './transform';
import {
  resolvedFeature,
  type OperationHandle,
  type OperationHandleContext,
  type OperationHandleDrag,
} from './operationHandles';

const AXES: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** How long the translation arrows are, in screen pixels. */
const MOVE_ARROW_PX = 96;
/**
 * The rotation rings ride further out than the move arrows: 150% of their
 * length, so a ring is never in the way of a translation arrow.
 */
const RING_RADIUS_PX = MOVE_ARROW_PX * 1.5;
/** The scale grip never gets closer to the pivot than this. */
const MIN_SCALE = 0.01;

type TransformDragTarget =
  | { kind: 'position-axis'; axis: 0 | 1 | 2; label: string }
  | { kind: 'position-plane'; label: string }
  /** `direction` is the local axis the ring shows, captured when it was drawn. */
  | { kind: 'rotation'; axis: 0 | 1 | 2; direction: Vec3; label: string }
  | { kind: 'scale'; label: string; radius: number };

function selectedTransform(context: OperationHandleContext): TransformFeature | undefined {
  if (context.selection.length !== 1 || context.selection[0]?.kind !== 'feature') return undefined;
  const feature = context.project.features.find(
    (candidate) => candidate.id === context.selection[0]?.id,
  );
  return feature?.type === 'transform' && !feature.suppressed ? feature : undefined;
}

function transformOf(project: Project, featureId: string): TransformFeature | undefined {
  const feature = activeModel(project).features.find(
    (candidate): candidate is TransformFeature =>
      candidate.id === featureId && candidate.type === 'transform',
  );
  return feature;
}

/**
 * Handles of the transform operation: a move gizmo and a uniform scale grip at
 * the pivot, and one rotation ring around each world axis. The move gizmo turns
 * with the operation, so its arrows show the axes the position fields are
 * measured along. The pivot is the one the rebuild measured on the state before
 * the operation; the handles are drawn where the operation carries it, so they
 * ride along with the geometry while it is dragged.
 */
export function transformHandles(context: OperationHandleContext): OperationHandle[] {
  const feature = selectedTransform(context);
  const geometry = feature ? resolvedFeature(feature) : undefined;
  const pivot = context.transformPivot;
  if (!feature || !geometry || !pivot || pivot.featureId !== feature.id) return [];
  // The operation maps its pivot to a new place, and the handles belong there:
  // a drag would otherwise leave the gizmo behind at the pivot it started from.
  const anchor = pivot.origin;
  const origin = transformPoint(transformMatrix(geometry.transform, anchor), anchor);
  const handles: OperationHandle[] = [];
  const rotation = transformRotation(geometry.transform.rotation);
  const turned = (axis: Vec3) => rotatePoint(rotation, axis);

  const axisLabels = [context.labels.moveX, context.labels.moveY, context.labels.moveZ] as const;
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    handles.push({
      id: `transform:${feature.id}:move:${axis}`,
      origin,
      direction: turned(AXES[axis]),
      value: 0,
      enabled: !isDriven(feature, `transform.translation.${index}`),
      thickness: 1,
      axis,
      fixedLengthPx: MOVE_ARROW_PX,
      tooltip: axisLabels[index]!,
      beginDrag: () =>
        beginTransformDrag(
          feature.id,
          {
            kind: 'position-axis',
            axis: index as 0 | 1 | 2,
            label: `${context.labels.moveLabel} ${axis.toUpperCase()}`,
          },
          anchor,
        ),
    });
  });

  handles.push({
    id: `transform:${feature.id}:move:plane`,
    origin,
    direction: turned(AXES.z),
    value: 0,
    kind: 'move',
    tooltip: context.labels.move,
    enabled: !(
      isDriven(feature, 'transform.translation.0') ||
      isDriven(feature, 'transform.translation.1') ||
      isDriven(feature, 'transform.translation.2')
    ),
    beginDrag: () =>
      beginTransformDrag(
        feature.id,
        {
          kind: 'position-plane',
          label: context.labels.moveLabel,
        },
        anchor,
      ),
  });

  const rotateLabels = [
    context.labels.transformRotateX,
    context.labels.transformRotateY,
    context.labels.transformRotateZ,
  ];
  // A ring rides the object's own axis, so the three of them turn with it; a
  // drag then turns the object around the ring the pointer is on. The stored
  // angles are Euler, so the grip has no absolute angle to show and the whole
  // circle is the grip.
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    const direction = turned(AXES[axis]);
    const reference = turned(AXES[['y', 'z', 'x'][index] as 'x' | 'y' | 'z']);
    const label = rotateLabels[index]!;
    handles.push({
      id: `transform:${feature.id}:rotate:${index}`,
      origin,
      direction,
      value: 0,
      enabled: !isDriven(feature, `transform.rotation.${index}`),
      thickness: 1.2,
      axis,
      tooltip: label,
      arc: {
        axis: direction,
        center: origin,
        reference,
        angle: 0,
        radius: 0,
        radiusPx: RING_RADIUS_PX,
        fullCircle: true,
      },
      beginDrag: () =>
        beginTransformDrag(
          feature.id,
          {
            kind: 'rotation',
            axis: index as 0 | 1 | 2,
            direction,
            label,
          },
          anchor,
        ),
    });
  });

  handles.push({
    id: `transform:${feature.id}:scale`,
    origin,
    direction: turned(AXES.x),
    // The grip travels with the size the operation asks for, so it starts on
    // the edge of the moved volume and the pointer follows the scale factor.
    value: Math.max(pivot.radius * geometry.transform.scale, 0.01),
    enabled: !isDriven(feature, 'transform.scale'),
    kind: 'square',
    thickness: 1.2,
    tooltip: context.labels.transformScale,
    beginDrag: () =>
      beginTransformDrag(
        feature.id,
        {
          kind: 'scale',
          label: context.labels.transformScale,
          radius: pivot.radius,
        },
        anchor,
      ),
  });

  return handles.filter((handle) => handle.enabled);
}

function beginTransformDrag(
  featureId: string,
  target: TransformDragTarget,
  pivot: Vec3,
): OperationHandleDrag {
  const drag = new TransformDrag(featureId, target, pivot);
  drag.start();
  return drag;
}

/**
 * One handle gesture over a transform. Every value is applied to the parameters
 * the operation had when the grab started, so dragging never accumulates
 * rounding, and the whole gesture is one undo step.
 */
class TransformDrag implements OperationHandleDrag {
  private before: Project | null = null;
  private original: TransformFeature | null = null;
  private resolved: Resolved<Transform> | null = null;
  private changed = false;
  private currentValue = 0;
  /** Meshes and sketches as the grab found them, moved without the kernel. */
  private startMeshes: Record<string, TessellationResult> = {};
  private startSketches: Record<string, { frame: SketchFrame; entities: SketchEntity[] }> = {};
  private startMatrix: Matrix3x4 | null = null;
  private startRotation: Matrix3x3 | null = null;

  constructor(
    private readonly featureId: string,
    private readonly target: TransformDragTarget,
    private readonly pivot: Vec3,
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

  get unit(): 'length' | 'angle' | 'percent' {
    if (this.target.kind === 'rotation') return 'angle';
    if (this.target.kind === 'scale') return 'percent';
    return 'length';
  }

  start(): void {
    const state = useDocumentStore.getState();
    this.before = state.project;
    const feature = transformOf(state.project, this.featureId);
    this.original = feature ?? null;
    this.resolved = feature ? (resolvedFeatureFor(feature)?.transform ?? null) : null;
    this.changed = false;
    if (this.target.kind === 'rotation') {
      // The grip reads the turn from the grab, so it starts at nothing.
      this.currentValue = 0;
    } else if (this.target.kind === 'scale') {
      // The chip speaks percent, like the field the scale is written into.
      this.currentValue = scalePercent(this.resolved?.scale ?? 1);
    } else {
      this.currentValue = 0;
    }
    this.capturePlacement(feature);
  }

  /**
   * What the scene already draws for the operation. A drag moves these meshes
   * and sketch curves by the difference between two placements, so the preview
   * follows the pointer without asking the kernel for every step.
   */
  private capturePlacement(feature: TransformFeature | undefined): void {
    this.startMeshes = {};
    this.startSketches = {};
    this.startMatrix = null;
    this.startRotation = null;
    if (!feature || !this.resolved) return;
    const kernel = useKernelStore.getState();
    for (const bodyId of new Set(feature.bodyIds)) {
      const mesh = kernel.meshes[bodyId];
      if (mesh) this.startMeshes[bodyId] = mesh;
    }
    const project = activeModel(useDocumentStore.getState().project);
    for (const sketchId of new Set(feature.sketchIds)) {
      const frame = kernel.sketchFrames[sketchId];
      const authored = project.features.find(
        (candidate): candidate is SketchFeature =>
          candidate.id === sketchId && candidate.type === 'sketch',
      );
      const entities = kernel.sketchOverrides[sketchId] ?? authored?.entities;
      if (frame && entities) this.startSketches[sketchId] = { frame, entities };
    }
    this.startMatrix = transformMatrix(this.resolved, this.pivot);
    this.startRotation = transformRotation(this.resolved.rotation);
  }

  update(value: number, _shift?: boolean, move?: Vec3): void {
    if (!this.before || !this.original || !this.resolved) return;
    const state = useDocumentStore.getState();
    const feature = transformOf(state.project, this.featureId);
    if (!feature) return;

    if (this.target.kind === 'position-axis') {
      const axis = this.target.axis;
      const translation: ParamVec3 = [0, 1, 2].map((index) =>
        index === axis
          ? snapLength(this.resolved!.translation[axis] + value)
          : feature.transform.translation[index]!,
      ) as ParamVec3;
      this.preview(
        feature,
        { ...feature.transform, translation },
        { ...this.resolved, translation: translation as Vec3 },
      );
      this.currentValue = snapLength(Math.abs(value));
      return;
    }
    if (this.target.kind === 'position-plane') {
      if (!move) return;
      // The pointer moves in the view, the offset is measured in the turned
      // frame of the operation, so the drag is read back through the turn.
      const local = unrotatePoint(transformRotation(this.resolved.rotation), move);
      const base = this.resolved.translation;
      const translation: ParamVec3 = [0, 1, 2].map((axis) =>
        snapLength(base[axis]! + local[axis]!),
      ) as ParamVec3;
      this.preview(
        feature,
        { ...feature.transform, translation },
        { ...this.resolved, translation: translation as Vec3 },
      );
      this.currentValue = snapLength(Math.hypot(move[0], move[1], move[2]));
      return;
    }
    if (this.target.kind === 'rotation') {
      // The grip reports the turn from the grab, not an absolute angle: the
      // object turns around the axis the ring shows, on top of what it already
      // was, and the result is written back as the Euler angles the field holds.
      const degrees = snapAngle(value);
      const turned =
        degrees === 0
          ? transformRotation(this.resolved.rotation)
          : multiplyRotation(
              axisRotation(this.target.direction, degrees),
              transformRotation(this.resolved.rotation),
            );
      const rotation = rotationAngles(turned);
      this.preview(feature, { ...feature.transform, rotation }, { ...this.resolved, rotation });
      this.currentValue = degrees;
      return;
    }
    const scale = Math.max(
      MIN_SCALE,
      Math.round((Math.abs(value) / this.target.radius) * 100) / 100,
    );
    this.preview(feature, { ...feature.transform, scale }, { ...this.resolved, scale });
    this.currentValue = scalePercent(scale);
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
    // The scene goes back to what the grab found, without waiting for a rebuild.
    useKernelStore.getState().setPreviewPlacement(this.startMeshes, this.startSketches);
    this.reset();
  }

  private preview(
    feature: TransformFeature,
    authored: Transform,
    resolved: Resolved<Transform>,
  ): void {
    useDocumentStore.getState().preview({
      type: 'feature/replace',
      feature: { ...feature, transform: authored },
    });
    this.placeFast(resolved);
    this.changed = true;
  }

  /**
   * Applies the difference between the grabbed placement and this one to the
   * meshes and sketches on screen. The rebuild that follows publishes the exact
   * result; until then the preview keeps up with the pointer.
   */
  private placeFast(transform: Resolved<Transform>): void {
    if (!this.startMatrix || !this.resolved || !this.startRotation) return;
    const delta = placementDelta(transformMatrix(transform, this.pivot), this.startMatrix);
    if (!delta) return;

    const meshes: Record<string, TessellationResult> = {};
    for (const [bodyId, mesh] of Object.entries(this.startMeshes)) {
      meshes[bodyId] = transformMesh(mesh, delta);
    }

    const sketches: Record<string, { frame: SketchFrame; entities: SketchEntity[] }> = {};
    const factor = this.resolved.scale > 0 ? transform.scale / this.resolved.scale : 1;
    const rotation = multiplyRotation(
      transformRotation(transform.rotation),
      transposeRotation(this.startRotation),
    );
    for (const [sketchId, start] of Object.entries(this.startSketches)) {
      sketches[sketchId] = transformSketchGeometry(
        start.frame,
        start.entities,
        factor,
        rotation,
        delta,
      );
    }

    useKernelStore.getState().setPreviewPlacement(meshes, sketches);
  }

  private reset(): void {
    this.before = null;
    this.original = null;
    this.resolved = null;
    this.changed = false;
    this.currentValue = 0;
    this.startMeshes = {};
    this.startSketches = {};
    this.startMatrix = null;
    this.startRotation = null;
  }
}
